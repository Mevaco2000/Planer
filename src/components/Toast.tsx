import { useEffect, useState } from 'react';

export interface ToastAction {
  label: string;
  run: () => void;
}

interface ToastItem {
  id: number;
  text: string;
  kind: 'info' | 'error';
  action?: ToastAction;
}

const listeners = new Set<(t: ToastItem) => void>();
let seq = 0;

export function toast(text: string, kind: 'info' | 'error' = 'info', action?: ToastAction) {
  const t = { id: ++seq, text, kind, action };
  listeners.forEach((l) => l(t));
}

const FS_ERRORS: Record<string, string> = {
  'permission-denied': 'Brak uprawnień – zaloguj się ponownie.',
  unavailable: 'Brak połączenia z serwerem. Zmiany zapiszą się później.',
  'not-found': 'Nie znaleziono (mogło zostać usunięte na innym urządzeniu).',
  'resource-exhausted': 'Przekroczono dzienny limit darmowego planu. Spróbuj jutro.',
};

export function errorMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  return FS_ERRORS[code] ?? (e instanceof Error ? e.message : String(e));
}

/** Zapis „w tle” – nie blokuje UI (offline obietnica kończy się dopiero po synchronizacji). */
export function run(p: Promise<unknown>, okText?: string): void {
  p.then(() => okText && toast(okText)).catch((e) => {
    console.error(e);
    toast(errorMessage(e), 'error');
  });
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    const l = (t: ToastItem) => {
      setItems((x) => [...x.slice(-2), t]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== t.id)), t.kind === 'error' || t.action ? 6000 : 3000);
    };
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind === 'error' ? 'toast-error' : ''} ${t.action ? 'toast-with-action' : ''}`}>
          <span className="grow">{t.text}</span>
          {t.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                setItems((x) => x.filter((i) => i.id !== t.id));
                t.action?.run();
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
