import { useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useData } from '../data';
import { useOnline, useToday } from '../hooks';
import { workerConfigured, syncReminders } from '../lib/push';
import { isDone, upcomingReminders } from '../lib/tasks';
import { Icon, Logo, type IconName } from './Icon';
import { defaultsFor, useUI } from './UIContext';

const TABS: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Dziś', icon: 'sun' },
  { to: '/plan', label: 'Plan', icon: 'timeline' },
  { to: '/kalendarz', label: 'Kalendarz', icon: 'calendar' },
  { to: '/skrzynka', label: 'Skrzynka', icon: 'inbox' },
  { to: '/projekty', label: 'Projekty', icon: 'folder' },
];

/** Lista najbliższych przypomnień trafia do Workera po każdej zmianie zadań (gdy przypomnienia są włączone). */
function useReminderSync() {
  const { uid, tasks, projectMap, settings, loaded } = useData();
  const online = useOnline();
  const today = useToday();
  useEffect(() => {
    if (!loaded || !settings.remindersOn || !workerConfigured || !online) return;
    const timer = window.setTimeout(() => {
      const list = upcomingReminders(
        tasks.filter((t) => !isDone(t)),
        projectMap,
        settings,
        Date.now(),
        today,
      );
      syncReminders(uid, list).catch((e) => console.warn('Przypomnienia:', e));
    }, 1500);
    return () => clearTimeout(timer);
  }, [uid, tasks, projectMap, settings, loaded, online, today]);
}

export function Layout() {
  const { tasks } = useData();
  const { quickAdd } = useUI();
  const online = useOnline();
  const today = useToday();
  const { pathname, search } = useLocation();
  const [params] = useSearchParams();
  const nav = useNavigate();
  useReminderSync();

  // skrót z ekranu głównego: „Nowe zadanie”
  useEffect(() => {
    if (params.get('dodaj') === '1') {
      quickAdd(defaultsFor(pathname, today));
      nav(pathname, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  // „/” – wyszukiwanie (gdy nie piszesz w polu tekstowym)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.sheet')) return;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      nav('/szukaj');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [nav]);

  const open = tasks.filter((t) => !isDone(t));
  const badge: Record<string, number> = {
    '/': open.filter((t) => t.due !== null && t.due <= today).length,
    '/skrzynka': open.filter((t) => t.projectId === null).length,
  };

  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/" className="brand">
          <Logo size={28} />
          <span className="brand-name">Planer</span>
        </NavLink>
        <span className="spacer" />
        <NavLink to="/szukaj" className="icon-btn" aria-label="Szukaj" title="Szukaj (/)">
          <Icon name="search" />
        </NavLink>
        <NavLink to="/ustawienia" className="icon-btn" aria-label="Ustawienia" title="Ustawienia">
          <Icon name="settings" />
        </NavLink>
      </header>
      {!online && (
        <div className="offline-bar" role="status">
          <Icon name="wifiOff" size={16} /> Offline – zmiany zapiszą się po odzyskaniu połączenia
        </div>
      )}
      <main className="content">
        <Outlet />
      </main>
      <button type="button" className="fab" onClick={() => quickAdd(defaultsFor(pathname, today, search))} aria-label="Nowe zadanie" title="Nowe zadanie (N)">
        <Icon name="plus" size={26} />
      </button>
      <nav className="tabbar" aria-label="Nawigacja główna">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.to === '/'} className="tab">
            <span className="tab-icon">
              <Icon name={t.icon} size={22} />
              {badge[t.to] > 0 && <b className="badge">{badge[t.to] > 99 ? '99+' : badge[t.to]}</b>}
            </span>
            <span className="tab-label">{t.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
