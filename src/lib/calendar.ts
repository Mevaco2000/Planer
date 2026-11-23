// Kalendarz: siatka miesiąca, tydzień, zadania danego dnia (z podglądem przyszłych powtórzeń rutyn).
import type { Task } from '../types';
import { addDays, addMonths, dateRange, fromISO, startOfWeek, toISO } from './dates';
import { compareTasks, isDone, occursOn } from './tasks';

/** Pierwszy dzień miesiąca daty `day`. */
export const monthStart = (day: string): string => `${day.slice(0, 7)}-01`;

/** Dni widoczne w siatce miesiąca: pełne tygodnie od poniedziałku (4–6 tygodni). */
export function monthGrid(day: string): string[] {
  const first = monthStart(day);
  const last = addDays(addMonths(first, 1), -1);
  return dateRange(startOfWeek(first), addDays(startOfWeek(last), 6));
}

/** 7 dni tygodnia daty `day` (od poniedziałku). */
export const weekDays = (day: string): string[] => dateRange(startOfWeek(day), addDays(startOfWeek(day), 6));

/** „listopad 2026” */
export const fmtMonth = (day: string): string => fromISO(day).toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });

/** „17–23 listopada 2026”, „29 grudnia 2026 – 4 stycznia 2027” */
export function fmtWeek(day: string): string {
  const [a, b] = [startOfWeek(day), addDays(startOfWeek(day), 6)];
  const da = fromISO(a);
  const db = fromISO(b);
  const long = (d: Date, year: boolean) => d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', ...(year ? { year: 'numeric' } : {}) });
  if (da.getFullYear() !== db.getFullYear()) return `${long(da, true)} – ${long(db, true)}`;
  if (da.getMonth() !== db.getMonth()) return `${long(da, false)} – ${long(db, true)}`;
  return `${da.getDate()}–${long(db, true)}`;
}

/** task – zadanie z terminem tego dnia; next – przyszłe powtórzenie rutyny (podgląd); done – zrobione tego dnia. */
export type DayKind = 'task' | 'next' | 'done';

export interface DayItem {
  task: Task;
  kind: DayKind;
}

/**
 * Zadania dnia: otwarte z tym terminem, zrobione (z terminem tego dnia albo odhaczone tego dnia, gdy bez terminu)
 * i – gdy `routines` – przyszłe powtórzenia rutyn. Z godziną najpierw, potem bez.
 */
export function dayItems(tasks: Task[], day: string, today: string, routines: boolean): DayItem[] {
  const out: DayItem[] = [];
  for (const t of tasks) {
    if (!isDone(t)) {
      if (t.due === day) out.push({ task: t, kind: 'task' });
      else if (routines && day > today && occursOn(t, day)) out.push({ task: t, kind: 'next' });
    } else if (t.due === day || (t.due === null && t.completedAt !== null && toISO(new Date(t.completedAt)) === day)) out.push({ task: t, kind: 'done' });
  }
  const rank: Record<DayKind, number> = { task: 0, next: 1, done: 2 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || compareTasks(a.task, b.task));
}
