// Planer – Worker przypomnień (Cloudflare Workers, darmowy plan).
// Aplikacja wysyła tu listę najbliższych przypomnień i subskrypcje push urządzeń; cron co minutę
// wysyła powiadomienia, których czas nadszedł. Dane zadań zostają w Firestore – tu jest tylko kopia terminów.
import { AuthError, verifyFirebaseToken } from './auth';
import type { D1Database, ExecutionContext, ScheduledController } from './types';
import { fromB64url } from './bytes';
import { sendPush, type PushMessage, type PushTarget, type Vapid } from './webpush';

export interface Env {
  DB: D1Database;
  FIREBASE_PROJECT_ID: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
  /** adresy aplikacji (oddzielone przecinkami), z których wolno wołać Workera */
  ALLOWED_ORIGINS: string;
  /** tylko do testów: inny adres kluczy publicznych Firebase */
  JWKS_URL?: string;
}

const MAX_REMINDERS = 500;
const MAX_DEVICES = 10;
/** przypomnienia spóźnione o więcej niż tyle (np. Worker nie działał) są pomijane */
const LATE_LIMIT = 6 * 3600_000;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('Origin');
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (data: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });

async function userId(req: Request, env: Env): Promise<string> {
  const token = /^Bearer (.+)$/.exec(req.headers.get('Authorization') ?? '')?.[1];
  if (!token) throw new HttpError(401, 'Brak logowania');
  try {
    return await verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID, { jwksUrl: env.JWKS_URL });
  } catch (e) {
    if (e instanceof AuthError) throw new HttpError(401, e.message);
    throw e;
  }
}

async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'Nieprawidłowe dane');
  }
}

const vapidOf = (env: Env): Vapid => ({ publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT });

function validSubscription(v: unknown): PushTarget {
  const s = v as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = typeof s?.endpoint === 'string' ? s.endpoint : '';
  const p256dh = typeof s?.keys?.p256dh === 'string' ? s.keys.p256dh : '';
  const auth = typeof s?.keys?.auth === 'string' ? s.keys.auth : '';
  let okKeys = false;
  try {
    okKeys = fromB64url(p256dh).length === 65 && fromB64url(auth).length === 16;
  } catch {
    okKeys = false;
  }
  if (!endpoint.startsWith('https://') || endpoint.length > 1000 || !okKeys) throw new HttpError(400, 'Nieprawidłowa subskrypcja');
  return { endpoint, p256dh, auth };
}

interface ReminderIn {
  taskId: string;
  at: number;
  title: string;
  body: string;
}

function validReminders(v: unknown): ReminderIn[] {
  const list = (v as { reminders?: unknown })?.reminders;
  if (!Array.isArray(list) || list.length > MAX_REMINDERS) throw new HttpError(400, 'Nieprawidłowa lista przypomnień');
  return list.map((r) => {
    const x = r as Partial<ReminderIn>;
    if (typeof x.taskId !== 'string' || !x.taskId || x.taskId.length > 200 || typeof x.at !== 'number' || !Number.isFinite(x.at) || typeof x.title !== 'string') {
      throw new HttpError(400, 'Nieprawidłowe przypomnienie');
    }
    return { taskId: x.taskId, at: Math.round(x.at), title: x.title.slice(0, 200), body: typeof x.body === 'string' ? x.body.slice(0, 300) : '' };
  });
}

/** Podmienia przypomnienia użytkownika; już wysłane zostają oznaczone, o ile ich czas się nie zmienił. */
async function replaceReminders(env: Env, uid: string, list: ReminderIn[]) {
  const ids = JSON.stringify(list.map((r) => r.taskId));
  await env.DB.batch([
    env.DB.prepare('DELETE FROM reminders WHERE uid = ?1 AND task_id NOT IN (SELECT value FROM json_each(?2))').bind(uid, ids),
    ...list.map((r) =>
      env.DB.prepare(
        `INSERT INTO reminders (uid, task_id, at, title, body, sent) VALUES (?1, ?2, ?3, ?4, ?5, 0)
         ON CONFLICT (uid, task_id) DO UPDATE SET
           title = excluded.title, body = excluded.body,
           sent = CASE WHEN reminders.at = excluded.at THEN reminders.sent ELSE 0 END,
           at = excluded.at`,
      ).bind(uid, r.taskId, r.at, r.title, r.body),
    ),
  ]);
}

async function devices(env: Env, uid: string): Promise<PushTarget[]> {
  const { results } = await env.DB.prepare('SELECT endpoint, p256dh, auth FROM subscriptions WHERE uid = ?1').bind(uid).all<PushTarget>();
  return results;
}

/** Wysyła wiadomość na wszystkie urządzenia użytkownika; wygasłe subskrypcje usuwa. */
async function notifyUser(env: Env, uid: string, message: PushMessage, fetchImpl?: typeof fetch) {
  let sent = 0;
  let failed = 0;
  let removed = 0;
  for (const d of await devices(env, uid)) {
    const r = await sendPush(d, message, vapidOf(env), { fetchImpl });
    if (r.ok) sent++;
    else if (r.gone) {
      removed++;
      await env.DB.prepare('DELETE FROM subscriptions WHERE endpoint = ?1').bind(d.endpoint).run();
    } else failed++;
  }
  return { sent, failed, removed };
}

/** Cron: przypomnienia, których czas nadszedł (z 30-sekundowym wyprzedzeniem – cron chodzi co minutę). */
export async function processDue(env: Env, now: number, fetchImpl?: typeof fetch) {
  const { results } = await env.DB.prepare(
    'SELECT uid, task_id, at, title, body FROM reminders WHERE sent = 0 AND at <= ?1 AND at > ?2 ORDER BY at LIMIT 200',
  )
    .bind(now + 30_000, now - LATE_LIMIT)
    .all<{ uid: string; task_id: string; at: number; title: string; body: string }>();
  const stats = { sent: 0, failed: 0, removed: 0, reminders: results.length };
  for (const r of results) {
    const s = await notifyUser(env, r.uid, { title: r.title, body: r.body, tag: r.task_id, url: `/zadanie/${encodeURIComponent(r.task_id)}` }, fetchImpl);
    stats.sent += s.sent;
    stats.failed += s.failed;
    stats.removed += s.removed;
    // chwilowy błąd usługi push na wszystkich urządzeniach – spróbujemy przy następnym uruchomieniu
    if (s.sent === 0 && s.failed > 0) continue;
    await env.DB.prepare('UPDATE reminders SET sent = 1 WHERE uid = ?1 AND task_id = ?2 AND at = ?3').bind(r.uid, r.task_id, r.at).run();
  }
  // sprzątanie raz na godzinę
  if (new Date(now).getUTCMinutes() === 0) await env.DB.prepare('DELETE FROM reminders WHERE at < ?1').bind(now - 7 * 86_400_000).run();
  return stats;
}

async function route(req: Request, env: Env, url: URL, headers: Record<string, string>): Promise<Response> {
  if (url.pathname === '/vapid' && req.method === 'GET') return json({ publicKey: env.VAPID_PUBLIC_KEY }, 200, headers);
  if (url.pathname === '/health' && req.method === 'GET') return json({ ok: true }, 200, headers);

  const uid = await userId(req, env);

  if (url.pathname === '/subscribe' && req.method === 'POST') {
    const sub = validSubscription(await body(req));
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE uid = ?1 AND endpoint != ?2').bind(uid, sub.endpoint).first<{ n: number }>();
    if ((count?.n ?? 0) >= MAX_DEVICES) throw new HttpError(409, `Najwyżej ${MAX_DEVICES} urządzeń – wyłącz powiadomienia na którymś z nich`);
    await env.DB.prepare(
      `INSERT INTO subscriptions (endpoint, uid, p256dh, auth, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (endpoint) DO UPDATE SET uid = excluded.uid, p256dh = excluded.p256dh, auth = excluded.auth`,
    )
      .bind(sub.endpoint, uid, sub.p256dh, sub.auth, Date.now())
      .run();
    return json({ ok: true }, 200, headers);
  }

  if (url.pathname === '/subscribe' && req.method === 'DELETE') {
    const { endpoint } = await body<{ endpoint?: unknown }>(req);
    if (typeof endpoint !== 'string') throw new HttpError(400, 'Brak adresu subskrypcji');
    await env.DB.prepare('DELETE FROM subscriptions WHERE endpoint = ?1 AND uid = ?2').bind(endpoint, uid).run();
    return json({ ok: true }, 200, headers);
  }

  if (url.pathname === '/reminders' && req.method === 'PUT') {
    const list = validReminders(await body(req));
    await replaceReminders(env, uid, list);
    return json({ ok: true, count: list.length }, 200, headers);
  }

  if (url.pathname === '/test' && req.method === 'POST') {
    const s = await notifyUser(env, uid, { title: 'Planer', body: 'Przypomnienia działają na tym urządzeniu.', tag: 'test', url: '/ustawienia' });
    if (s.sent === 0 && s.failed === 0) throw new HttpError(404, 'Żadne urządzenie nie ma włączonych powiadomień');
    return json(s, 200, headers);
  }

  throw new HttpError(404, 'Nie ma takiej ścieżki');
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const headers = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    try {
      return await route(req, env, new URL(req.url), headers);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status, headers);
      console.error(e);
      return json({ error: 'Błąd serwera' }, 500, headers);
    }
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(processDue(env, controller.scheduledTime));
  },
};
