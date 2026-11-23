import { useRegisterSW } from 'virtual:pwa-register/react';

/** Pasek „Dostępna nowa wersja” – nie przeładowujemy strony bez pytania (ktoś może być w trakcie edycji). */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (reg) setInterval(() => void reg.update(), 60 * 60 * 1000);
    },
  });

  if (!needRefresh) return null;
  return (
    <div className="update-bar" role="status">
      <span>Dostępna nowa wersja aplikacji.</span>
      <button type="button" className="btn btn-sm btn-primary" onClick={() => void updateServiceWorker(true)}>
        Odśwież
      </button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setNeedRefresh(false)}>
        Później
      </button>
    </div>
  );
}
