import { onSnapshot, type DocumentReference, type FirestoreError, type Query } from 'firebase/firestore';
import { useEffect, useState, useSyncExternalStore } from 'react';

type Raw = Record<string, unknown>;

const RETRYABLE = new Set(['permission-denied', 'unavailable', 'internal']);
const MAX_RETRIES = 4;

/** Nasłuch z ponawianiem – odrzucony listener Firestore nie wznawia się sam. */
function subscribeWithRetry(start: (onError: (e: FirestoreError) => void) => () => void, onGiveUp: () => void): () => void {
  let unsub: (() => void) | null = null;
  let timer = 0;
  let tries = 0;
  let stopped = false;
  const run = () => {
    unsub = start((e) => {
      console.warn(`Firestore: ${e.code}`, e.message);
      if (!stopped && RETRYABLE.has(e.code) && tries < MAX_RETRIES) {
        tries++;
        timer = window.setTimeout(run, 500 * 2 ** tries);
      } else onGiveUp();
    });
  };
  run();
  return () => {
    stopped = true;
    clearTimeout(timer);
    unsub?.();
  };
}

/** Zapytanie na żywo. `null` = jeszcze się ładuje. */
export function useLiveQuery<T>(make: () => Query | null, norm: (id: string, d: Raw) => T, key: string): T[] | null {
  const [data, setData] = useState<T[] | null>(null);
  useEffect(() => {
    setData(null);
    const q = make();
    if (!q) return;
    return subscribeWithRetry(
      (onError) => onSnapshot(q, (s) => setData(s.docs.map((d) => norm(d.id, d.data()))), onError),
      () => setData((d) => d ?? []),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return data;
}

/** Pojedynczy dokument na żywo. `undefined` = ładuje się, `null` = nie istnieje. */
export function useLiveDoc<T>(make: () => DocumentReference | null, norm: (id: string, d: Raw) => T, key: string): T | null | undefined {
  const [data, setData] = useState<T | null | undefined>(undefined);
  useEffect(() => {
    setData(undefined);
    const ref = make();
    if (!ref) return;
    return subscribeWithRetry(
      (onError) => onSnapshot(ref, (s) => setData(s.exists() ? norm(s.id, s.data()) : null), onError),
      () => setData((d) => d ?? null),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return data;
}

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

export const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine);

/** Bieżąca data (RRRR-MM-DD) – zmienia się o północy, także gdy aplikacja jest otwarta całą noc. */
export function useToday(): string {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 60_000);
    const onVisible = () => tick((n) => n + 1);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Bieżąca chwila (ms), odświeżana co minutę – np. linia „teraz” w planie dnia. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = window.setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [intervalMs]);
  return now;
}

// ---- instalacja PWA ----
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let installEvent: BeforeInstallPromptEvent | null = null;
const installListeners = new Set<() => void>();
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e as BeforeInstallPromptEvent;
  installListeners.forEach((l) => l());
});
window.addEventListener('appinstalled', () => {
  installEvent = null;
  installListeners.forEach((l) => l());
});

export function useInstallPrompt(): (() => Promise<void>) | null {
  const ev = useSyncExternalStore(
    (cb) => {
      installListeners.add(cb);
      return () => installListeners.delete(cb);
    },
    () => installEvent,
  );
  if (!ev) return null;
  return async () => {
    await ev.prompt();
    await ev.userChoice;
    installEvent = null;
    installListeners.forEach((l) => l());
  };
}

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
