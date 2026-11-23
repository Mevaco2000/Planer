// Przypomnienia push: subskrypcja urządzenia i lista najbliższych przypomnień wysyłana do Workera Cloudflare.
import { auth } from '../firebase';
import { isIos, isStandalone } from '../hooks';
import type { ReminderItem } from './tasks';

const WORKER = ((import.meta.env.VITE_WORKER_URL as string | undefined) ?? '').trim().replace(/\/+$/, '');

export const workerConfigured = WORKER.length > 0;

export type PushSupport = 'ok' | 'no-worker' | 'ios-install' | 'unsupported';

export function pushSupport(): PushSupport {
  if (!workerConfigured) return 'no-worker';
  const ok = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (ok) return 'ok';
  // na iPhonie powiadomienia działają dopiero w aplikacji dodanej do ekranu głównego (iOS 16.4+)
  return isIos() && !isStandalone() ? 'ios-install' : 'unsupported';
}

async function api<T>(path: string, method: string, body?: unknown): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Zaloguj się ponownie.');
  const res = await fetch(`${WORKER}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(data?.error ?? `Serwer przypomnień odpowiedział błędem ${res.status}.`);
  return data as T;
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Rejestracja service workera – w trybie `npm run dev` jej nie ma (działa po zbudowaniu i wdrożeniu). */
async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
  if (!reg) throw new Error('Powiadomienia działają w zbudowanej aplikacji (npm run build, npm run preview) i po wdrożeniu.');
  return reg;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'ok') return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

const sameKey = (sub: PushSubscription, key: Uint8Array): boolean => {
  const k = sub.options.applicationServerKey;
  if (!k) return false;
  const a = new Uint8Array(k);
  return a.length === key.length && a.every((v, i) => v === key[i]);
};

/** Włącza powiadomienia na tym urządzeniu. */
export async function enablePush(): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(permission === 'denied' ? 'Powiadomienia są zablokowane w ustawieniach przeglądarki – odblokuj je dla tej strony.' : 'Nie zezwolono na powiadomienia.');
  }
  const reg = await registration();
  const { publicKey } = await api<{ publicKey: string }>('/vapid', 'GET');
  if (!publicKey) throw new Error('Worker nie ma klucza VAPID – uzupełnij konfigurację (README).');
  const key = fromB64url(publicKey);
  let sub = await reg.pushManager.getSubscription();
  // klucz serwera się zmienił – stara subskrypcja nie zadziała
  if (sub && !sameKey(sub, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api('/subscribe', 'POST', sub.toJSON());
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api('/subscribe', 'DELETE', { endpoint: sub.endpoint }).catch(() => undefined);
  await sub.unsubscribe();
}

export const sendTestPush = () => api<{ sent: number; failed: number }>('/test', 'POST');

const hashKey = (uid: string) => `planer.reminders.${uid}`;

/** Wysyła listę przypomnień, jeśli zmieniła się od ostatniego razu. */
export async function syncReminders(uid: string, list: ReminderItem[]): Promise<void> {
  const hash = JSON.stringify(list);
  let last: string | null = null;
  try {
    last = localStorage.getItem(hashKey(uid));
  } catch {
    /* tryb prywatny */
  }
  if (last === hash) return;
  await api('/reminders', 'PUT', { reminders: list });
  try {
    localStorage.setItem(hashKey(uid), hash);
  } catch {
    /* tryb prywatny – wyślemy ponownie przy następnej zmianie */
  }
}
