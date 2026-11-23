// Akcje na zadaniach z komunikatem i możliwością cofnięcia.
import { fmtDue, fmtDuration } from '../lib/dates';
import { applyChange, restoreTasks, saveSettings, updateTask, updateTasks } from '../lib/db';
import { addDistinct, undoChange, unlinkDeleted, type Change } from '../lib/links';
import { completionPatch, isDone, skipPatch, timePatch } from '../lib/tasks';
import type { Settings, Task } from '../types';
import { run, toast } from './Toast';

const undo = (uid: string, before: Task[]) => ({ label: 'Cofnij', run: () => run(restoreTasks(uid, before)) });

/** Zmiana kilku zadań naraz z komunikatem i cofnięciem (`taskMap` = stan przed zmianą). */
export function commitChange(uid: string, change: Change, taskMap: Map<string, Task>, text?: string) {
  if (!change.put.length && !change.del.length) return;
  const back = undoChange(change, taskMap);
  run(applyChange(uid, change));
  if (text) toast(text, 'info', { label: 'Cofnij', run: () => run(applyChange(uid, back)) });
}

/** „To różne zadania” – aplikacja więcej nie zapyta o tę parę. */
export function markDistinct(uid: string, settings: Settings, key: string) {
  run(saveSettings(uid, { distinct: addDistinct(settings.distinct, key) }));
}

export function completeTask(uid: string, t: Task, today: string) {
  const patch = completionPatch(t, Date.now(), today);
  run(updateTask(uid, t.id, patch));
  if (patch.due) toast(`Zrobione – następny raz: ${fmtDue(patch.due, today)}`, 'info', undo(uid, [t]));
  else toast(`Zrobione: ${t.title}`, 'info', undo(uid, [t]));
}

export function reopenTask(uid: string, t: Task) {
  if (!isDone(t)) return;
  run(updateTask(uid, t.id, { status: 'todo', completedAt: null }));
}

export function setDue(uid: string, t: Task, due: string, today: string) {
  if (t.due === due) return;
  run(updateTask(uid, t.id, { due }));
  toast(`Przełożono na: ${fmtDue(due, today)}`, 'info', undo(uid, [t]));
}

export function setDueMany(uid: string, tasks: Task[], due: string, today: string) {
  if (!tasks.length) return;
  run(updateTasks(uid, tasks.map((t) => t.id), { due }));
  toast(`Przełożono ${tasks.length} na: ${fmtDue(due, today)}`, 'info', undo(uid, tasks));
}

/** Rutyna: „pomiń ten raz” – następny termin bez liczenia jako zrobione. */
export function skipTask(uid: string, t: Task, today: string) {
  const patch = skipPatch(t, today);
  if (!patch.due) return;
  run(updateTask(uid, t.id, patch));
  toast(`Pominięto – następny raz: ${fmtDue(patch.due, today)}`, 'info', undo(uid, [t]));
}

/** Plan dnia: dzień i godzina (null = bez godziny). */
export function setTime(uid: string, t: Task, due: string, time: string | null, settings: Settings, today: string) {
  if (t.due === due && t.time === time) return;
  run(updateTask(uid, t.id, timePatch(t, due, time, settings)));
  toast(time ? `Zaplanowano: ${fmtDue(due, today)} ${time}` : 'Bez godziny – do zaplanowania', 'info', undo(uid, [t]));
}

/** Plan dnia: czas trwania po rozciągnięciu bloku. */
export function setDuration(uid: string, t: Task, duration: number) {
  if (t.duration === duration) return;
  run(updateTask(uid, t.id, { duration }));
  toast(`Czas trwania: ${fmtDuration(duration)}`, 'info', undo(uid, [t]));
}

/** Usunięcie zadania; mniejsze zadania, które na nie wpływały, tracą to powiązanie. */
export function removeTask(uid: string, t: Task, taskMap: Map<string, Task>) {
  commitChange(uid, { put: unlinkDeleted(t.id, [...taskMap.values()]), del: [t.id] }, new Map([...taskMap, [t.id, t]]), `Usunięto: ${t.title}`);
}
