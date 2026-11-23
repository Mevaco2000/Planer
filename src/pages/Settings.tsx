import { useEffect, useState } from 'react';
import { logout } from '../auth';
import { Icon } from '../components/Icon';
import { confirmAction } from '../components/Sheet';
import { errorMessage, run, toast } from '../components/Toast';
import { PageHead } from '../components/ui';
import { useData } from '../data';
import { isIos, isStandalone, useInstallPrompt } from '../hooks';
import { deleteDoneBefore, exportAll, saveSettings } from '../lib/db';
import { plural } from '../lib/format';
import { currentSubscription, disablePush, enablePush, pushSupport, sendTestPush } from '../lib/push';
import { REMIND_TIMED } from '../lib/tasks';

function Reminders() {
  const { uid, settings } = useData();
  const support = pushSupport();
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const denied = support === 'ok' && Notification.permission === 'denied';

  useEffect(() => {
    void currentSubscription().then((s) => setSubscribed(Boolean(s)));
  }, []);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const enable = () =>
    act(async () => {
      await enablePush();
      run(saveSettings(uid, { remindersOn: true }));
      setSubscribed(true);
      toast('Powiadomienia włączone na tym urządzeniu');
    });

  const disable = () =>
    act(async () => {
      await disablePush();
      setSubscribed(false);
      toast('Powiadomienia wyłączone na tym urządzeniu');
    });

  const test = () =>
    act(async () => {
      const r = await sendTestPush();
      toast(r.sent ? 'Wysłano – powiadomienie pojawi się za chwilę' : 'Nie udało się dostarczyć powiadomienia – spróbuj za chwilę', r.sent ? 'info' : 'error');
    });

  return (
    <section className="card">
      <h2 className="card-title">
        <Icon name="bell" size={18} /> Przypomnienia
      </h2>
      {support === 'no-worker' && (
        <p className="hint">
          Powiadomienia push wysyła darmowy Worker Cloudflare. Po jego wdrożeniu wpisz adres w <code>VITE_WORKER_URL</code> (instrukcja w README) – do tego czasu
          przypomnienia widać tylko na liście zadań.
        </p>
      )}
      {support === 'ios-install' && (
        <p className="hint">Na iPhonie powiadomienia działają w aplikacji dodanej do ekranu głównego: Udostępnij → „Do ekranu początkowego”, potem otwórz Planer z ikony.</p>
      )}
      {support === 'unsupported' && <p className="hint">Ta przeglądarka nie obsługuje powiadomień push.</p>}
      {support === 'ok' && (
        <>
          <p className="row">
            <span className={`status-dot ${subscribed ? 's-done' : 's-todo'}`} />
            <span className="grow">{subscribed === null ? 'Sprawdzam…' : subscribed ? 'Włączone na tym urządzeniu' : 'Wyłączone na tym urządzeniu'}</span>
          </p>
          {denied && <p className="error-text small">Powiadomienia są zablokowane w ustawieniach przeglądarki dla tej strony – odblokuj je, a potem włącz tutaj.</p>}
          <div className="actions-row">
            {subscribed ? (
              <>
                <button type="button" className="btn btn-soft btn-sm" disabled={busy} onClick={() => void test()}>
                  <Icon name="send" size={16} /> Wyślij próbne
                </button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void disable()}>
                  Wyłącz na tym urządzeniu
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-primary btn-sm" disabled={busy || denied} onClick={() => void enable()}>
                <Icon name="bell" size={16} /> Włącz powiadomienia
              </button>
            )}
          </div>
        </>
      )}
      <div className="grid-2">
        <label className="field">
          <span>Domyślnie dla zadań z godziną</span>
          <select
            value={settings.defaultRemind ?? ''}
            onChange={(e) => run(saveSettings(uid, { defaultRemind: e.target.value === '' ? null : Number(e.target.value) }))}
          >
            <option value="">Bez przypomnienia</option>
            {REMIND_TIMED.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Zadania bez godziny – przypomnij o</span>
          <select value={settings.morningHour} onChange={(e) => run(saveSettings(uid, { morningHour: Number(e.target.value) }))}>
            {Array.from({ length: 17 }, (_, i) => i + 5).map((h) => (
              <option key={h} value={h}>
                {h}:00
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

function DataCard() {
  const { uid } = useData();
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const data = await exportAll(uid);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `planer-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const clean = async () => {
    if (!confirmAction('Usunąć zadania zrobione ponad 30 dni temu? Tego nie da się cofnąć – możesz najpierw pobrać kopię.')) return;
    setBusy(true);
    try {
      const n = await deleteDoneBefore(uid, Date.now() - 30 * 86_400_000);
      toast(n ? `Usunięto ${n} ${plural(n, 'zadanie', 'zadania', 'zadań')}` : 'Nie ma starych zrobionych zadań');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2 className="card-title">Dane</h2>
      <p className="hint">Zadania są zapisane w Twoim koncie Firebase i synchronizują się między urządzeniami – także offline (zapiszą się po odzyskaniu sieci).</p>
      <div className="actions-row">
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void download()}>
          <Icon name="download" size={16} /> Pobierz kopię (JSON)
        </button>
        <button type="button" className="btn btn-danger-ghost btn-sm" disabled={busy} onClick={() => void clean()}>
          <Icon name="trash" size={16} /> Usuń zrobione starsze niż 30 dni
        </button>
      </div>
    </section>
  );
}

export function Settings() {
  const { user } = useData();
  const install = useInstallPrompt();

  return (
    <div className="page">
      <PageHead title="Ustawienia" />

      <section className="card">
        <h2 className="card-title">Konto</h2>
        <p className="row">
          <span className="avatar">{(user.displayName || user.email || '?').slice(0, 1).toUpperCase()}</span>
          <span className="grow">
            <b>{user.displayName || 'Bez nazwy'}</b>
            <span className="muted small block">{user.email}</span>
          </span>
        </p>
        <div className="actions-row">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void logout()}>
            <Icon name="logout" size={16} /> Wyloguj
          </button>
        </div>
      </section>

      <Reminders />

      {!isStandalone() && (
        <section className="card">
          <h2 className="card-title">Aplikacja na telefonie</h2>
          {install ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void install()}>
              <Icon name="download" size={16} /> Zainstaluj Planer
            </button>
          ) : (
            <p className="hint">
              {isIos() ? 'Safari: Udostępnij → „Do ekranu początkowego”.' : 'W menu przeglądarki wybierz „Zainstaluj aplikację” albo „Dodaj do ekranu głównego”.'} Działa
              offline i otwiera się jak zwykła aplikacja.
            </p>
          )}
        </section>
      )}

      <section className="card">
        <h2 className="card-title">Szybkie dodawanie</h2>
        <ul className="help-list">
          <li>
            <code>jutro</code>, <code>w piątek</code>, <code>15.12</code>, <code>3 grudnia</code>, <code>za tydzień</code> – termin
          </li>
          <li>
            <code>o 18</code>, <code>9:30</code>, <code>rano</code>, <code>wieczorem</code> – godzina
          </li>
          <li>
            <code>przez 2h</code>, <code>1,5 h</code>, <code>45 min</code> – czas trwania (blok w planie dnia)
          </li>
          <li>
            <code>!1</code> pilne, <code>!2</code> wysoki, <code>!3</code> średni – priorytet
          </li>
          <li>
            <code>#praca</code> – projekt (wystarczy początek nazwy)
          </li>
          <li>
            <code>codziennie</code>, <code>co 2 dni</code>, <code>co 2 tygodnie</code>, <code>w poniedziałki i czwartki</code>, <code>w weekendy</code>,{' '}
            <code>co miesiąc</code> – powtarzanie (rutyny)
          </li>
          <li>
            Klawisz <kbd>N</kbd> otwiera dodawanie, <kbd>/</kbd> – wyszukiwanie (na komputerze). Rozpoznany fragment można odrzucić krzyżykiem na podglądzie.
          </li>
        </ul>
      </section>

      <DataCard />
    </div>
  );
}
