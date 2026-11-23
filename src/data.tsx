// Dane zalogowanego użytkownika na żywo: ustawienia, grupy, projekty, otwarte zadania i zrobione w ostatnich 2 tygodniach.
import type { User } from 'firebase/auth';
import { collection, doc, query, where } from 'firebase/firestore';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useUser } from './auth';
import { db } from './firebase';
import { useLiveDoc, useLiveQuery, useToday } from './hooks';
import { addDays, fromISO } from './lib/dates';
import { childrenMap } from './lib/links';
import { normGroup, normProject, normSettings, normStage, normTask } from './lib/norm';
import { blockedSteps, DEFAULT_SETTINGS } from './lib/tasks';
import type { Group, Project, Settings, Stage, Task } from './types';

/** Ile dni wstecz trzymamy na żywo zadania zrobione (starsze – tylko eksport i wyszukiwanie w kopii). */
export const DONE_DAYS = 14;

interface DataState {
  uid: string;
  user: User;
  settings: Settings;
  groups: Group[];
  groupMap: Map<string, Group>;
  projects: Project[];
  projectMap: Map<string, Project>;
  /** etapy wszystkich projektów (w kolejności) */
  stages: Stage[];
  stageMap: Map<string, Stage>;
  /** otwarte + zrobione w ostatnich DONE_DAYS dniach */
  tasks: Task[];
  taskMap: Map<string, Task>;
  /** id zadania → mniejsze zadania, które na nie wpływają */
  children: Map<string, Task[]>;
  /** kroki projektów „po kolei”, które czekają na wcześniejszy krok: id → krok, na który czekają */
  blocked: Map<string, Task>;
  loaded: boolean;
}

const DataCtx = createContext<DataState | null>(null);

const byOrder = <T extends { order: number; name: string }>(a: T, b: T) => a.order - b.order || a.name.localeCompare(b.name, 'pl');

export function DataProvider({ children }: { children: ReactNode }) {
  const user = useUser();
  const uid = user.uid;
  const today = useToday();
  const since = fromISO(addDays(today, -DONE_DAYS)).getTime();

  const settings = useLiveDoc(() => doc(db, 'users', uid), (_id, d) => normSettings(d), `settings:${uid}`);
  const groups = useLiveQuery(() => collection(db, 'users', uid, 'groups'), normGroup, `groups:${uid}`);
  const projects = useLiveQuery(() => collection(db, 'users', uid, 'projects'), normProject, `projects:${uid}`);
  const stages = useLiveQuery(() => collection(db, 'users', uid, 'stages'), normStage, `stages:${uid}`);
  const open = useLiveQuery(() => query(collection(db, 'users', uid, 'tasks'), where('completedAt', '==', null)), normTask, `open:${uid}`);
  const done = useLiveQuery(() => query(collection(db, 'users', uid, 'tasks'), where('completedAt', '>=', since)), normTask, `done:${uid}:${since}`);

  const value = useMemo<DataState>(() => {
    const sortedGroups = [...(groups ?? [])].sort(byOrder);
    const sortedProjects = [...(projects ?? [])].sort(byOrder);
    // to samo zadanie bywa chwilę w obu zapytaniach (tuż po odhaczeniu) – wygrywa nowsza wersja
    const byId = new Map<string, Task>();
    for (const t of [...(open ?? []), ...(done ?? [])]) {
      const prev = byId.get(t.id);
      if (!prev || t.updatedAt >= prev.updatedAt) byId.set(t.id, t);
    }
    const tasks = [...byId.values()];
    const sortedStages = [...(stages ?? [])].sort(byOrder);
    return {
      uid,
      user,
      settings: settings ?? DEFAULT_SETTINGS,
      groups: sortedGroups,
      groupMap: new Map(sortedGroups.map((g) => [g.id, g])),
      projects: sortedProjects,
      projectMap: new Map(sortedProjects.map((p) => [p.id, p])),
      stages: sortedStages,
      stageMap: new Map(sortedStages.map((s) => [s.id, s])),
      tasks,
      taskMap: byId,
      children: childrenMap(tasks),
      blocked: blockedSteps(tasks, sortedProjects),
      loaded: open !== null && projects !== null,
    };
  }, [uid, user, settings, groups, projects, stages, open, done]);

  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}

export function useData(): DataState {
  const v = useContext(DataCtx);
  if (!v) throw new Error('useData poza DataProvider');
  return v;
}
