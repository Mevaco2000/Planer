// Okna wspólne dla wszystkich ekranów: edycja zadania i szybkie dodawanie (przycisk „+” albo klawisz N).
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { useData } from '../data';
import { isISODate, todayISO } from '../lib/dates';
import type { Task } from '../types';
import { QuickAdd, type QuickDefaults } from './QuickAdd';
import { Sheet } from './Sheet';
import { TaskEditor } from './TaskEditor';

interface UIState {
  openTask: (id: string) => void;
  openDraft: (task: Task) => void;
  quickAdd: (defaults?: QuickDefaults) => void;
}

/**
 * Co podpowiada dodawanie (przycisk „+” i klawisz N) na danym ekranie: na „Dziś” termin dziś, w planie dnia – oglądany dzień,
 * w kalendarzu – zaznaczony dzień, w rutynach – powtarzanie, w projekcie – ten projekt (i wybrany etap).
 */
export function defaultsFor(pathname: string, today: string, search = ''): QuickDefaults {
  const params = new URLSearchParams(search);
  if (pathname === '/') return { due: today };
  if (pathname === '/plan') {
    const d = params.get('d');
    return { due: isISODate(d) ? d : today };
  }
  if (pathname === '/kalendarz') {
    const d = params.get('d');
    return isISODate(d) ? { due: d } : {};
  }
  if (pathname === '/rutyny') return { repeat: 'daily' };
  const project = /^\/projekty\/([^/]+)/.exec(pathname)?.[1];
  if (project) return { projectId: decodeURIComponent(project), stageId: params.get('etap') };
  return {};
}

const UICtx = createContext<UIState | null>(null);

type Editing = { id: string } | { draft: Task };

export function UIProvider({ children }: { children: ReactNode }) {
  const { taskMap } = useData();
  const { pathname, search } = useLocation();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [quick, setQuick] = useState<QuickDefaults | null>(null);

  const value = useMemo<UIState>(
    () => ({
      openTask: (id) => setEditing({ id }),
      openDraft: (draft) => setEditing({ draft }),
      quickAdd: (defaults = {}) => setQuick(defaults),
    }),
    [],
  );

  // N – nowe zadanie (gdy nie piszesz w polu tekstowym i nic nie jest otwarte)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key.toLowerCase() !== 'n' || e.ctrlKey || e.metaKey || e.altKey || editing || quick) return;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      setQuick(defaultsFor(pathname, todayISO(), search));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [editing, quick, pathname, search]);

  const task = editing ? ('draft' in editing ? editing.draft : taskMap.get(editing.id)) : undefined;
  const closeEditor = useCallback(() => setEditing(null), []);
  const closeQuick = useCallback(() => setQuick(null), []);

  return (
    <UICtx.Provider value={value}>
      {children}
      <Sheet open={Boolean(task)} onClose={closeEditor} title={editing && 'draft' in editing ? 'Nowe zadanie' : 'Zadanie'}>
        {task && editing && <TaskEditor key={task.id} initial={task} isNew={'draft' in editing} onDone={closeEditor} />}
      </Sheet>
      <Sheet open={quick !== null} onClose={closeQuick} title="Nowe zadanie">
        {quick && (
          <QuickAdd
            defaults={quick}
            onDetails={(draft) => {
              setQuick(null);
              setEditing({ draft });
            }}
            onOpen={(id) => {
              setQuick(null);
              setEditing({ id });
            }}
          />
        )}
      </Sheet>
    </UICtx.Provider>
  );
}

export function useUI(): UIState {
  const v = useContext(UICtx);
  if (!v) throw new Error('useUI poza UIProvider');
  return v;
}
