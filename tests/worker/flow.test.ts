// Pełny przepływ Workera na prawdziwym SQLite: subskrypcja → lista przypomnień → cron → zaszyfrowany push.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetJwksCache } from '../../worker/src/auth';
import worker, { processDue, type Env } from '../../worker/src/index';
import { browserSubscription, claimsFor, decryptPush, fakeD1, firebaseSigner, fromB64url, vapidKeys } from './helpers';

const PROJECT = 'planer-test';
const ORIGIN = 'https://planer-test.web.app';

interface Captured {
  url: string;
  headers: Headers;
  body: Uint8Array<ArrayBuffer>;
}

describe('Worker przypomnień', () => {
  let env: Env & { DB: ReturnType<typeof fakeD1> };
  let pushes: Captured[];
  let pushStatus: Record<string, number>;
  let token: (uid: string) => Promise<string>;

  beforeEach(async () => {
    resetJwksCache();
    const g = await firebaseSigner();
    const vapid = await vapidKeys();
    env = {
      DB: fakeD1(),
      FIREBASE_PROJECT_ID: PROJECT,
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
      VAPID_SUBJECT: ORIGIN,
      ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5173`,
      JWKS_URL: 'https://jwks.test/keys',
    };
    token = (uid) => g.sign(claimsFor(PROJECT, uid, Math.floor(Date.now() / 1000)));
    pushes = [];
    pushStatus = {};
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === env.JWKS_URL) return new Response(JSON.stringify(g.jwks));
      if (url.startsWith('https://push.test/')) {
        pushes.push({ url, headers: new Headers(init?.headers), body: new Uint8Array(init?.body as ArrayBuffer) });
        return new Response(null, { status: pushStatus[url] ?? 201 });
      }
      throw new Error(`nieoczekiwane zapytanie: ${url}`);
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  const call = async (method: string, path: string, uid: string | null, body?: unknown, origin = ORIGIN) =>
    worker.fetch(
      new Request(`https://planer-push.test${path}`, {
        method,
        headers: { Origin: origin, 'Content-Type': 'application/json', ...(uid ? { Authorization: `Bearer ${await token(uid)}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
    );

  it('klucz publiczny bez logowania, reszta tylko z tokenem; CORS tylko dla aplikacji', async () => {
    const v = await call('GET', '/vapid', null);
    expect(await v.json()).toEqual({ publicKey: env.VAPID_PUBLIC_KEY });
    expect(v.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect((await call('GET', '/vapid', null, undefined, 'https://obca.strona')).headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect((await call('PUT', '/reminders', null, { reminders: [] })).status).toBe(401);
    const bad = await worker.fetch(new Request('https://planer-push.test/reminders', { method: 'PUT', headers: { Authorization: 'Bearer zly.token.x' }, body: '{}' }), env);
    expect(bad.status).toBe(401);
    const pre = await worker.fetch(new Request('https://planer-push.test/reminders', { method: 'OPTIONS', headers: { Origin: ORIGIN } }), env);
    expect(pre.status).toBe(204);
    expect(pre.headers.get('Access-Control-Allow-Methods')).toContain('PUT');
  });

  it('wysyła przypomnienie, gdy nadejdzie jego czas – raz, zaszyfrowane, z podpisem VAPID', async () => {
    const phone = await browserSubscription('https://push.test/telefon');
    expect((await call('POST', '/subscribe', 'u1', phone.json)).status).toBe(200);

    const now = Date.now();
    const put = await call('PUT', '/reminders', 'u1', {
      reminders: [
        { taskId: 't1', at: now + 60_000, title: 'Raport', body: 'Dziś 18:00 · Praca' },
        { taskId: 't2', at: now + 86_400_000, title: 'Jutro', body: 'Jutro' },
      ],
    });
    expect(await put.json()).toEqual({ ok: true, count: 2 });

    // jeszcze za wcześnie
    expect((await processDue(env, now)).sent).toBe(0);
    // minutę później – jedno przypomnienie
    const s = await processDue(env, now + 61_000);
    expect(s).toMatchObject({ sent: 1, failed: 0, reminders: 1 });
    expect(pushes).toHaveLength(1);
    const p = pushes[0];
    expect(p.headers.get('Content-Encoding')).toBe('aes128gcm');
    expect(p.headers.get('Authorization')).toMatch(/^vapid t=.+, k=/);
    expect(JSON.parse(await decryptPush(p.body, phone.ua))).toEqual({ title: 'Raport', body: 'Dziś 18:00 · Praca', tag: 't1', url: '/zadanie/t1' });

    // drugi przebieg crona nie powtarza
    await processDue(env, now + 120_000);
    expect(pushes).toHaveLength(1);
  });

  it('zmiana godziny wysłanego przypomnienia – wyśle się znowu; usunięte z listy znika', async () => {
    const phone = await browserSubscription('https://push.test/telefon');
    await call('POST', '/subscribe', 'u1', phone.json);
    const now = Date.now();
    await call('PUT', '/reminders', 'u1', { reminders: [{ taskId: 't1', at: now, title: 'A', body: '' }, { taskId: 't2', at: now + 3_600_000, title: 'B', body: '' }] });
    await processDue(env, now);
    expect(pushes).toHaveLength(1);
    // ta sama lista jeszcze raz (np. synchronizacja z innego urządzenia) – bez powtórki
    await call('PUT', '/reminders', 'u1', { reminders: [{ taskId: 't1', at: now, title: 'A', body: '' }, { taskId: 't2', at: now + 3_600_000, title: 'B', body: '' }] });
    await processDue(env, now + 1000);
    expect(pushes).toHaveLength(1);
    // przełożone na później + t2 usunięte
    await call('PUT', '/reminders', 'u1', { reminders: [{ taskId: 't1', at: now + 600_000, title: 'A', body: '' }] });
    expect(env.DB.raw.prepare('SELECT task_id, sent FROM reminders').all()).toEqual([{ task_id: 't1', sent: 0 }]);
    await processDue(env, now + 600_000);
    expect(pushes).toHaveLength(2);
  });

  it('wiele urządzeń; wygasła subskrypcja (410) jest usuwana; dane innych użytkowników nietknięte', async () => {
    const phone = await browserSubscription('https://push.test/telefon');
    const laptop = await browserSubscription('https://push.test/laptop');
    const other = await browserSubscription('https://push.test/ktos-inny');
    await call('POST', '/subscribe', 'u1', phone.json);
    await call('POST', '/subscribe', 'u1', laptop.json);
    await call('POST', '/subscribe', 'u2', other.json);
    await call('PUT', '/reminders', 'u2', { reminders: [{ taskId: 'x', at: Date.now() + 3_600_000, title: 'Cudze', body: '' }] });
    pushStatus['https://push.test/laptop'] = 410;

    const test = await call('POST', '/test', 'u1');
    expect(await test.json()).toEqual({ sent: 1, failed: 0, removed: 1 });
    expect(pushes.map((p) => p.url).sort()).toEqual(['https://push.test/laptop', 'https://push.test/telefon']);
    expect(env.DB.raw.prepare('SELECT endpoint FROM subscriptions ORDER BY endpoint').all().map((r) => r.endpoint)).toEqual([
      'https://push.test/ktos-inny',
      'https://push.test/telefon',
    ]);
    // u1 czyści swoją listę – przypomnienie u2 zostaje
    await call('PUT', '/reminders', 'u1', { reminders: [] });
    expect(env.DB.raw.prepare('SELECT uid FROM reminders').all()).toEqual([{ uid: 'u2' }]);
    // wyłączenie powiadomień na telefonie
    await call('DELETE', '/subscribe', 'u1', { endpoint: phone.json.endpoint });
    expect((await call('POST', '/test', 'u1')).status).toBe(404);
  });

  it('chwilowy błąd usługi push – ponowna próba przy następnym przebiegu; bardzo spóźnione pomijane', async () => {
    const phone = await browserSubscription('https://push.test/telefon');
    await call('POST', '/subscribe', 'u1', phone.json);
    const now = Date.now();
    await call('PUT', '/reminders', 'u1', { reminders: [{ taskId: 't1', at: now, title: 'A', body: '' }, { taskId: 'stare', at: now - 7 * 3_600_000, title: 'B', body: '' }] });
    pushStatus['https://push.test/telefon'] = 503;
    expect(await processDue(env, now)).toMatchObject({ sent: 0, failed: 1, reminders: 1 });
    pushStatus['https://push.test/telefon'] = 201;
    expect(await processDue(env, now + 60_000)).toMatchObject({ sent: 1, reminders: 1 });
  });

  it('odrzuca złe dane', async () => {
    expect((await call('POST', '/subscribe', 'u1', { endpoint: 'http://niebezpieczny', keys: { p256dh: 'x', auth: 'y' } })).status).toBe(400);
    expect((await call('PUT', '/reminders', 'u1', { reminders: [{ taskId: '', at: 1, title: 'x' }] })).status).toBe(400);
    expect((await call('PUT', '/reminders', 'u1', { reminders: Array.from({ length: 501 }, (_, i) => ({ taskId: `t${i}`, at: 1, title: 'x' })) })).status).toBe(400);
    expect(fromB64url(env.VAPID_PUBLIC_KEY)).toHaveLength(65);
  });

  it('cron Workera uruchamia wysyłkę w tle', async () => {
    const waits: Promise<unknown>[] = [];
    await worker.scheduled({ scheduledTime: Date.now(), cron: '* * * * *' }, env, { waitUntil: (p) => waits.push(p) });
    expect(waits).toHaveLength(1);
    await expect(waits[0]).resolves.toMatchObject({ reminders: 0 });
  });
});
