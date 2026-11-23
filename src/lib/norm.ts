// Normalizacja dokumentów z Firestore – brakujące lub złe pola dostają wartości domyślne.
import type { Group, Priority, Project, Repeat, Settings, Stage, Status, Subtask, Task } from '../types';
import { isISODate, isTime } from './dates';
import { ruleOf } from './repeat';
import { DEFAULT_SETTINGS, PROJECT_COLORS } from './tasks';

type Raw = Record<string, unknown>;

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});

const STATUSES: Status[] = ['todo', 'doing', 'done'];
const REPEATS: Repeat[] = ['daily', 'weekdays', 'weekly', 'monthly', 'yearly'];

function normSubtask(v: unknown, i: number): Subtask {
  const s = obj(v);
  return { id: str(s.id) || `s${i}`, title: str(s.title), done: s.done === true };
}

export function normTask(id: string, d: Raw): Task {
  const completedAt = typeof d.completedAt === 'number' ? d.completedAt : null;
  const status = STATUSES.includes(d.status as Status) ? (d.status as Status) : 'todo';
  const priority = [1, 2, 3, 4].includes(d.priority as number) ? (d.priority as Priority) : 4;
  const repeat = REPEATS.includes(d.repeat as Repeat) ? (d.repeat as Repeat) : null;
  const rule = repeat
    ? ruleOf({ repeat, every: num(d.every, 1), repeatDays: Array.isArray(d.repeatDays) ? d.repeatDays.filter((x): x is number => typeof x === 'number') : [], repeatFrom: d.repeatFrom === 'done' ? 'done' : 'due' })
    : null;
  const duration = num(d.duration, -1);
  const createdAt = num(d.createdAt);
  return {
    id,
    title: str(d.title, 'Bez nazwy'),
    notes: str(d.notes),
    projectId: typeof d.projectId === 'string' && d.projectId ? d.projectId : null,
    // etap ma sens tylko w projekcie
    stageId: typeof d.projectId === 'string' && d.projectId && typeof d.stageId === 'string' && d.stageId ? d.stageId : null,
    parentIds: Array.isArray(d.parentIds) ? [...new Set(d.parentIds.filter((x): x is string => typeof x === 'string' && x !== '' && x !== id))].slice(0, 50) : [],
    // status i data zrobienia muszą się zgadzać
    status: completedAt !== null ? 'done' : status === 'done' ? 'todo' : status,
    priority,
    due: isISODate(d.due) ? d.due : null,
    time: isISODate(d.due) && isTime(d.time) ? d.time : null,
    duration: duration >= 5 && duration <= 1440 ? Math.round(duration) : null,
    remind: typeof d.remind === 'number' && d.remind >= 0 ? d.remind : null,
    repeat,
    every: rule?.every ?? 1,
    repeatDays: rule?.repeatDays ?? [],
    repeatFrom: rule?.repeatFrom ?? 'due',
    subtasks: Array.isArray(d.subtasks) ? d.subtasks.map(normSubtask).filter((s) => s.title) : [],
    // starsze zadania nie mają kolejności – układają się wg daty dodania
    order: num(d.order, createdAt),
    createdAt,
    updatedAt: num(d.updatedAt),
    completedAt,
    lastDone: typeof d.lastDone === 'number' ? d.lastDone : completedAt,
    doneCount: Math.max(0, num(d.doneCount)),
  };
}

export function normProject(id: string, d: Raw): Project {
  return {
    id,
    name: str(d.name, 'Projekt'),
    color: typeof d.color === 'string' && /^#[0-9a-f]{6}$/i.test(d.color) ? d.color : PROJECT_COLORS[0],
    order: num(d.order),
    createdAt: num(d.createdAt),
    groupId: typeof d.groupId === 'string' && d.groupId ? d.groupId : null,
    sequential: d.sequential === true,
  };
}

export function normStage(id: string, d: Raw): Stage {
  return {
    id,
    projectId: str(d.projectId),
    name: str(d.name, 'Etap'),
    order: num(d.order),
    createdAt: num(d.createdAt),
    due: isISODate(d.due) ? d.due : null,
  };
}

export function normGroup(id: string, d: Raw): Group {
  return { id, name: str(d.name, 'Grupa'), order: num(d.order), createdAt: num(d.createdAt) };
}

export function normSettings(d: Raw): Settings {
  const h = num(d.morningHour, DEFAULT_SETTINGS.morningHour);
  return {
    morningHour: Number.isInteger(h) && h >= 0 && h <= 23 ? h : DEFAULT_SETTINGS.morningHour,
    defaultRemind: d.defaultRemind === null ? null : typeof d.defaultRemind === 'number' && d.defaultRemind >= 0 ? d.defaultRemind : DEFAULT_SETTINGS.defaultRemind,
    remindersOn: d.remindersOn === true,
    distinct: Array.isArray(d.distinct) ? d.distinct.filter((x): x is string => typeof x === 'string') : [],
  };
}
