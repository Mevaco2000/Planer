// Logika zadań bez dostępu do bazy: kolejność, zaległe, powtarzanie, przypomnienia, plan dnia, kroki projektu.
import type { Group, Priority, Project, Settings, Status, Task } from '../types';
import { atTime, fmtDue } from './dates';
import { PRIORITY_LABEL } from './quickAdd';
import { nextDue, REPEAT_LABEL } from './repeat';

export { alignDue, nextDue, occursOn, repeatLabel, ruleOf, taskRepeatLabel, unitLabel } from './repeat';

export const PRIORITIES: { value: Priority; label: string }[] = ([1, 2, 3, 4] as Priority[]).map((value) => ({ value, label: PRIORITY_LABEL[value] }));

export const STATUSES: { value: Status; label: string }[] = [
  { value: 'todo', label: 'Do zrobienia' },
  { value: 'doing', label: 'W trakcie' },
  { value: 'done', label: 'Zrobione' },
];

export const REPEATS = (['daily', 'weekdays', 'weekly', 'monthly', 'yearly'] as const).map((value) => ({ value, label: REPEAT_LABEL[value] }));

/** Przypomnienia dla zadań z godziną (minuty przed terminem). */
export const REMIND_TIMED: { value: number; label: string }[] = [
  { value: 0, label: 'W momencie terminu' },
  { value: 10, label: '10 min wcześniej' },
  { value: 30, label: '30 min wcześniej' },
  { value: 60, label: '1 godz. wcześniej' },
  { value: 1440, label: 'Dzień wcześniej' },
];

/** Przypomnienia dla zadań na cały dzień – o porannej godzinie z ustawień. */
export const remindAllDay = (morningHour: number): { value: number; label: string }[] => [
  { value: 0, label: `W dniu terminu, ${morningHour}:00` },
  { value: 1440, label: `Dzień wcześniej, ${morningHour}:00` },
];

/** Czas trwania do wyboru (minuty). */
export const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];

/** Tyle zajmuje w planie dnia zadanie z godziną, ale bez podanego czasu trwania. */
export const DEFAULT_DURATION = 30;

export const DEFAULT_SETTINGS: Settings = { morningHour: 9, defaultRemind: 0, remindersOn: false, distinct: [] };

export const PROJECT_COLORS = ['#4656d6', '#0e9f6e', '#d97706', '#dc2626', '#9333ea', '#0891b2', '#db2777', '#65a30d', '#64748b'];

/** Nowe zadanie z wartościami domyślnymi. */
export function blankTask(id: string, now: number, patch: Partial<Task> = {}): Task {
  return {
    id,
    title: '',
    notes: '',
    projectId: null,
    stageId: null,
    parentIds: [],
    status: 'todo',
    priority: 4,
    due: null,
    time: null,
    duration: null,
    remind: null,
    repeat: null,
    every: 1,
    repeatDays: [],
    repeatFrom: 'due',
    subtasks: [],
    order: now,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    lastDone: null,
    doneCount: 0,
    ...patch,
  };
}

export const isDone = (t: Pick<Task, 'completedAt'>): boolean => t.completedAt !== null;

export const isOverdue = (t: Pick<Task, 'due' | 'completedAt'>, today: string): boolean => !isDone(t) && t.due !== null && t.due < today;

/**
 * Kolejność na listach: najpierw z terminem (wcześniejszy wyżej), w tym samym dniu – z godziną wg godziny,
 * potem bez godziny; dalej priorytet i data dodania. Bez terminu na końcu.
 */
export function compareTasks(a: Task, b: Task): number {
  if (a.due !== b.due) {
    if (a.due === null) return 1;
    if (b.due === null) return -1;
    return a.due < b.due ? -1 : 1;
  }
  if (a.time !== b.time) {
    if (a.time === null) return 1;
    if (b.time === null) return -1;
    return a.time < b.time ? -1 : 1;
  }
  return a.priority - b.priority || a.createdAt - b.createdAt;
}

/** Zrobione: najnowsze na górze. */
export const compareDone = (a: Task, b: Task): number => (b.completedAt ?? 0) - (a.completedAt ?? 0);

export const sortTasks = (tasks: Task[]): Task[] => [...tasks].sort(compareTasks);

/** Kolejność kroków w planie projektu. */
export const compareOrder = (a: Pick<Task, 'order' | 'createdAt'>, b: Pick<Task, 'order' | 'createdAt'>): number => a.order - b.order || a.createdAt - b.createdAt;

/**
 * Zmiany przy odhaczeniu: zadanie powtarzane dostaje następny termin (podzadania od nowa),
 * zwykłe – staje się zrobione.
 */
export function completionPatch(t: Task, now: number, today: string): Partial<Task> {
  if (t.repeat && t.due) {
    return {
      due: nextDue(t.due, { ...t, repeat: t.repeat }, today),
      status: 'todo',
      completedAt: null,
      lastDone: now,
      doneCount: t.doneCount + 1,
      subtasks: t.subtasks.map((s) => ({ ...s, done: false })),
    };
  }
  return { status: 'done', completedAt: now, lastDone: now };
}

/** „Pomiń ten raz” – rutyna przechodzi na następny termin bez liczenia jako zrobiona. */
export function skipPatch(t: Task, today: string): Partial<Task> {
  if (!t.repeat || !t.due) return {};
  return { due: nextDue(t.due, { ...t, repeat: t.repeat }, today) };
}

/** Zmiana statusu (np. na tablicy): „Zrobione” = odhaczenie, cofnięcie ze „Zrobione” = otwarcie. */
export function statusPatch(t: Task, status: Status, now: number, today: string): Partial<Task> {
  if (status === 'done') return isDone(t) ? {} : completionPatch(t, now, today);
  return { status, completedAt: null };
}

/**
 * Ustawienie dnia i godziny (np. przeciągnięcie w planie dnia) – przypomnienie jak w edytorze:
 * nowa godzina dostaje domyślne przypomnienie, bez godziny – przypomnienie rano.
 */
export function timePatch(t: Task, due: string, time: string | null, settings: Pick<Settings, 'defaultRemind'>): Partial<Task> {
  if (time === null) return { due, time: null, remind: t.remind === null ? null : t.remind >= 1440 ? 1440 : 0 };
  return { due, time, remind: t.time ? t.remind : (t.remind ?? settings.defaultRemind) };
}

/** Chwila przypomnienia (ms) albo null. Zadania bez godziny przypominają o porannej godzinie z ustawień. */
export function reminderAt(t: Pick<Task, 'remind' | 'due' | 'time' | 'completedAt'>, settings: Pick<Settings, 'morningHour'>): number | null {
  if (t.remind === null || !t.due || isDone(t)) return null;
  const base = atTime(t.due, t.time ?? `${String(settings.morningHour).padStart(2, '0')}:00`);
  return base - t.remind * 60_000;
}

export interface ReminderItem {
  taskId: string;
  at: number;
  title: string;
  body: string;
}

/** Przypomnienia do wysłania przez Workera: od teraz (z 5-minutowym zapasem) do 60 dni naprzód. */
export function upcomingReminders(tasks: Task[], projects: Map<string, Project>, settings: Settings, now: number, today: string): ReminderItem[] {
  const out: ReminderItem[] = [];
  for (const t of tasks) {
    const at = reminderAt(t, settings);
    if (at === null || at < now - 5 * 60_000 || at > now + 60 * 86_400_000) continue;
    const project = t.projectId ? projects.get(t.projectId) : undefined;
    const when = `${fmtDue(t.due!, today)}${t.time ? ` ${t.time}` : ''}`;
    out.push({ taskId: t.id, at, title: t.title.slice(0, 120), body: `${when}${project ? ` · ${project.name}` : ''}`.slice(0, 200) });
  }
  return out.sort((a, b) => a.at - b.at || (a.taskId < b.taskId ? -1 : 1)).slice(0, 300);
}

/** Podzadania: „2/5” – lista kontrolna i powiązane mniejsze zadania (`children`). */
export function subtaskProgress(t: Pick<Task, 'subtasks'>, children: Pick<Task, 'completedAt'>[] = []): { done: number; total: number } {
  return {
    done: t.subtasks.filter((s) => s.done).length + children.filter(isDone).length,
    total: t.subtasks.length + children.length,
  };
}

// ---------- kroki projektu ----------

/**
 * Projekty „po kolei”: każdy otwarty krok poza pierwszym czeka na pierwszy otwarty.
 * Wynik: id zablokowanego zadania → krok, na który czeka.
 */
export function blockedSteps(tasks: Task[], projects: Pick<Project, 'id' | 'sequential'>[]): Map<string, Task> {
  const out = new Map<string, Task>();
  for (const p of projects) {
    if (!p.sequential) continue;
    const open = tasks.filter((t) => t.projectId === p.id && !isDone(t)).sort(compareOrder);
    for (const t of open.slice(1)) out.set(t.id, open[0]);
  }
  return out;
}

export interface OrderChange {
  id: string;
  order: number;
}

const ORDER_GAP = 1024;

/**
 * Przeniesienie kroku `id` przed albo za krok `targetId` (lista posortowana wg kolejności).
 * Zwykle zmienia się tylko przeniesiony krok (wartość pomiędzy sąsiadami); gdy brakuje miejsca – numeracja od nowa.
 */
export function reorder(list: Pick<Task, 'id' | 'order'>[], id: string, targetId: string, after: boolean): OrderChange[] {
  if (id === targetId) return [];
  const moved = list.find((t) => t.id === id);
  const rest = list.filter((t) => t.id !== id);
  const ti = rest.findIndex((t) => t.id === targetId);
  if (!moved || ti === -1) return [];
  const at = after ? ti + 1 : ti;
  const prev = rest[at - 1];
  const next = rest[at];
  let order: number;
  if (!prev) order = next.order - ORDER_GAP;
  else if (!next) order = prev.order + ORDER_GAP;
  else order = (prev.order + next.order) / 2;
  const roomy = (!prev || order - prev.order > 1e-3) && (!next || next.order - order > 1e-3);
  if (roomy) return order === moved.order ? [] : [{ id, order }];
  const all = [...rest.slice(0, at), moved, ...rest.slice(at)];
  return all.map((t, i) => ({ id: t.id, order: (i + 1) * ORDER_GAP })).filter((c, i) => c.order !== all[i].order);
}

// ---------- plan dnia ----------

/**
 * Bloki nachodzące na siebie stają obok siebie: kolumna bloku i liczba kolumn w jego grupie.
 * Wynik w tej samej kolejności co wejście.
 */
export function layoutDay(items: { start: number; end: number }[]): { col: number; cols: number }[] {
  const order = items.map((_, i) => i).sort((a, b) => items[a].start - items[b].start || items[b].end - items[a].end);
  const out = items.map(() => ({ col: 0, cols: 1 }));
  let cluster: number[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    for (const i of cluster) out[i].cols = colEnds.length;
    cluster = [];
    colEnds = [];
    clusterEnd = -Infinity;
  };
  for (const i of order) {
    const it = items[i];
    if (cluster.length && it.start >= clusterEnd) flush();
    let col = colEnds.findIndex((e) => e <= it.start);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(it.end);
    } else colEnds[col] = it.end;
    out[i].col = col;
    cluster.push(i);
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  flush();
  return out;
}

// ---------- grupy projektów ----------

export interface ProjectSection {
  group: Group | null;
  projects: Project[];
}

/** Projekty w grupach (w kolejności grup), na końcu – bez grupy (także te z usuniętej grupy). */
export function groupProjects(projects: Project[], groups: Group[]): ProjectSection[] {
  const known = new Set(groups.map((g) => g.id));
  return [
    ...groups.map((group) => ({ group, projects: projects.filter((p) => p.groupId === group.id) })),
    { group: null, projects: projects.filter((p) => !p.groupId || !known.has(p.groupId)) },
  ];
}
