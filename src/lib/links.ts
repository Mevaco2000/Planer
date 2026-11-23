// Powiązania zadań i duplikaty.
// Zadanie może wpływać na kilka większych zadań (`parentIds`) – np. „Kupić kabel HDMI” potrzebne i do „Podłączyć TV”, i do „Prezentacji”.
// Gdy dwa zadania albo podzadania wyglądają tak samo, aplikacja pyta, czy to to samo; „to samo” łączy je w jedno zadanie
// powiązane z oboma większymi, „różne” zapamiętuje parę i więcej o nią nie pyta.
import type { Subtask, Task } from '../types';
import { fold, newKey } from './format';
import { blankTask, completionPatch, isDone } from './tasks';

// ---------- podobieństwo nazw ----------

/** Nazwa do porównań: bez wielkości liter, polskich znaków, interpunkcji i nadmiarowych spacji. */
export function titleKey(s: string): string {
  return fold(s)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function bigrams(s: string): string[] {
  const t = s.replace(/ /g, '');
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

/** Współczynnik Dice’a na parach liter (0–1). */
export function similarity(a: string, b: string): number {
  const x = bigrams(titleKey(a));
  const y = bigrams(titleKey(b));
  if (!x.length || !y.length) return titleKey(a) === titleKey(b) ? 1 : 0;
  const counts = new Map<string, number>();
  for (const g of x) counts.set(g, (counts.get(g) ?? 0) + 1);
  let common = 0;
  for (const g of y) {
    const c = counts.get(g) ?? 0;
    if (c > 0) {
      common++;
      counts.set(g, c - 1);
    }
  }
  return (2 * common) / (x.length + y.length);
}

const numbersOf = (key: string): string => (key.match(/\d+/g) ?? []).join(',');

/**
 * Czy dwie nazwy wyglądają na to samo: identyczne po uproszczeniu, te same słowa w innej kolejności
 * albo prawie identyczne (literówka, odmiana). Różne liczby („rozdział 3” i „rozdział 4”) = różne zadania.
 */
export function isSimilar(a: string, b: string): boolean {
  const ka = titleKey(a);
  const kb = titleKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  if (numbersOf(ka) !== numbersOf(kb)) return false;
  const words = (k: string) => k.split(' ').sort().join(' ');
  if (words(ka) === words(kb)) return true;
  if (Math.min(ka.length, kb.length) < 6) return false;
  return similarity(ka, kb) >= 0.84;
}

// ---------- zadania i podzadania jako „pozycje” ----------

export type Ref = { kind: 'task'; task: Task } | { kind: 'sub'; task: Task; sub: Subtask };

export const refKey = (r: Ref): string => (r.kind === 'task' ? `t:${r.task.id}` : `s:${r.task.id}:${r.sub.id}`);
export const refTitle = (r: Ref): string => (r.kind === 'task' ? r.task.title : r.sub.title);
export const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Ile par „różne” pamiętamy (najnowsze). */
export const MAX_DISTINCT = 400;

/** Mapa: id zadania → mniejsze zadania, które na nie wpływają. */
export function childrenMap(tasks: Task[]): Map<string, Task[]> {
  const out = new Map<string, Task[]>();
  for (const t of tasks) for (const p of t.parentIds) out.set(p, [...(out.get(p) ?? []), t]);
  return out;
}

/** Czy `ancestorId` jest wyżej w drzewie niż `id` (po `parentIds`, także przez kilka poziomów). */
export function isAncestor(ancestorId: string, id: string, taskMap: Map<string, Pick<Task, 'parentIds'>>): boolean {
  const seen = new Set<string>();
  const stack = [...(taskMap.get(id)?.parentIds ?? [])];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === ancestorId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(taskMap.get(cur)?.parentIds ?? []));
  }
  return false;
}

/** Czy można podpiąć `childId` pod `parentId` bez zapętlenia. */
export const canLink = (childId: string, parentId: string, taskMap: Map<string, Pick<Task, 'parentIds'>>): boolean =>
  childId !== parentId && !isAncestor(childId, parentId, taskMap);

interface Item {
  ref: Ref;
  key: string;
  title: string;
  /** zadanie, do którego pozycja należy (dla podzadania – właściciel) */
  owner: string;
  done: boolean;
}

function itemsOf(tasks: Task[]): Item[] {
  const out: Item[] = [];
  for (const t of tasks) {
    if (isDone(t)) continue;
    const tk = titleKey(t.title);
    if (tk) out.push({ ref: { kind: 'task', task: t }, key: tk, title: t.title, owner: t.id, done: false });
    for (const s of t.subtasks) {
      const sk = titleKey(s.title);
      if (sk) out.push({ ref: { kind: 'sub', task: t, sub: s }, key: sk, title: s.title, owner: t.id, done: s.done });
    }
  }
  return out;
}

/** Czy para ma sens jako pytanie „czy to to samo?”. */
function comparable(a: Item, b: Item): boolean {
  if (a.owner === b.owner) return false; // zadanie i jego własne podzadanie albo dwa podzadania tej samej listy
  if (a.done && b.done) return false;
  if (a.ref.kind === 'task' && b.ref.kind === 'task') {
    // już powiązane ze sobą
    if (a.ref.task.parentIds.includes(b.ref.task.id) || b.ref.task.parentIds.includes(a.ref.task.id)) return false;
  }
  return true;
}

export interface DuplicatePair {
  a: Ref;
  b: Ref;
  key: string;
  exact: boolean;
}

/**
 * Pary otwartych zadań i podzadań, które wyglądają tak samo – najpierw identyczne nazwy, potem podobne.
 * Pomija pary oznaczone jako różne (`distinct`).
 */
export function findDuplicates(tasks: Task[], distinct: Iterable<string>, limit = 30): DuplicatePair[] {
  const skip = new Set(distinct);
  const items = itemsOf(tasks);
  const out: DuplicatePair[] = [];
  const seen = new Set<string>();
  const push = (a: Item, b: Item, exact: boolean) => {
    const key = pairKey(refKey(a.ref), refKey(b.ref));
    if (seen.has(key) || skip.has(key) || !comparable(a, b)) return;
    seen.add(key);
    // zadanie przed podzadaniem, starsze przed nowszym – stały porządek w pytaniu
    const [x, y] = a.ref.kind === 'sub' && b.ref.kind === 'task' ? [b, a] : [a, b];
    out.push({ a: x.ref, b: y.ref, key, exact });
  };

  const byKey = new Map<string, Item[]>();
  for (const it of items) byKey.set(it.key, [...(byKey.get(it.key) ?? []), it]);
  for (const group of byKey.values()) for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) push(group[i], group[j], true);

  // podobne (nie identyczne) – tylko przy rozsądnej liczbie pozycji
  if (items.length <= 700) {
    for (let i = 0; i < items.length && out.length < limit * 3; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (items[i].key !== items[j].key && isSimilar(items[i].key, items[j].key)) push(items[i], items[j], false);
      }
    }
  }
  return out.sort((p, q) => Number(q.exact) - Number(p.exact)).slice(0, limit);
}

/** Najbardziej podobna otwarta pozycja do nowej nazwy (przy dodawaniu) – albo null. */
export function findSimilar(title: string, tasks: Task[], exclude: { taskId?: string; distinct?: Iterable<string>; selfKey?: string } = {}): Ref | null {
  const key = titleKey(title);
  if (!key) return null;
  const skip = new Set(exclude.distinct ?? []);
  let best: { ref: Ref; score: number } | null = null;
  for (const it of itemsOf(tasks)) {
    if (it.owner === exclude.taskId) continue;
    if (it.done && it.ref.kind === 'sub') continue;
    if (exclude.selfKey && skip.has(pairKey(exclude.selfKey, refKey(it.ref)))) continue;
    if (!isSimilar(key, it.key)) continue;
    // przy remisie wygrywa zadanie (powiązanie istniejącego zadania jest prostsze niż łączenie podzadań)
    const score = (it.key === key ? 2 : similarity(key, it.key)) + (it.ref.kind === 'task' ? 0.1 : 0);
    if (!best || score > best.score) best = { ref: it.ref, score };
  }
  return best?.ref ?? null;
}

// ---------- zmiany (do zapisania jednym zapisem i cofnięcia) ----------

export interface Change {
  /** zadania do zapisania w całości (nowe albo zmienione) */
  put: Task[];
  /** zadania do usunięcia */
  del: string[];
}

/** Zmiana odwrotna – przywraca stan sprzed `change` (`before` = zadania przed zmianą). */
export function undoChange(change: Change, before: Map<string, Task>): Change {
  return {
    put: [...change.put.map((t) => before.get(t.id)).filter((t): t is Task => Boolean(t)), ...change.del.map((id) => before.get(id)).filter((t): t is Task => Boolean(t))],
    del: change.put.filter((t) => !before.has(t.id)).map((t) => t.id),
  };
}

const uniq = (xs: string[]): string[] => [...new Set(xs)];

/** Zadanie podpięte pod większe; bez projektu – przejmuje projekt (i etap) większego. */
export function linkedChild(child: Task, parent: Pick<Task, 'id' | 'projectId' | 'stageId'>): Task {
  const inherit = child.projectId === null && parent.projectId !== null;
  return {
    ...child,
    parentIds: uniq([...child.parentIds, parent.id]),
    projectId: inherit ? parent.projectId : child.projectId,
    stageId: inherit ? parent.stageId : child.stageId,
  };
}

/** Podzadanie staje się osobnym zadaniem powiązanym z właścicielem (i ewentualnie innymi większymi zadaniami). */
export function promoteSubtask(owner: Task, sub: Subtask, opts: { id: string; now: number; today: string; extraParents?: Task[]; done?: boolean; patch?: Partial<Task> }): Change {
  const parents = [owner, ...(opts.extraParents ?? [])];
  let task = blankTask(opts.id, opts.now, {
    title: sub.title.trim(),
    projectId: parents.find((p) => p.projectId)?.projectId ?? null,
    stageId: parents.find((p) => p.projectId)?.stageId ?? null,
    parentIds: uniq(parents.map((p) => p.id)),
    ...opts.patch,
  });
  if (opts.done ?? sub.done) task = { ...task, ...completionPatch(task, opts.now, opts.today) };
  return { put: [task, { ...owner, subtasks: owner.subtasks.filter((s) => s.id !== sub.id) }], del: [] };
}

/** Wynik połączenia: zmiany i krótki opis do komunikatu. */
export interface Merge {
  change: Change;
  /** zadanie, które zostaje (albo powstało) */
  kept: Task;
  text: string;
}

const joinNotes = (a: string, b: string): string => {
  const x = a.trim();
  const y = b.trim();
  if (!x || x === y) return y || x;
  if (!y) return x;
  return `${x}\n\n${y}`;
};

function mergeSubtasks(a: Subtask[], b: Subtask[]): Subtask[] {
  const out = a.map((s) => ({ ...s }));
  for (const s of b) {
    const same = out.find((x) => titleKey(x.title) === titleKey(s.title));
    if (same) same.done = same.done || s.done;
    else out.push({ ...s, id: out.some((x) => x.id === s.id) ? newKey() : s.id });
  }
  return out;
}

/** Dwa zadania to to samo: zostaje jedno (z projektem albo starsze), dostaje powiązania, podzadania i notatki drugiego. */
function mergeTasks(x: Task, y: Task, tasks: Task[]): Merge {
  const [keep, drop] = (x.projectId === null) !== (y.projectId === null) ? (x.projectId ? [x, y] : [y, x]) : x.createdAt <= y.createdAt ? [x, y] : [y, x];
  // termin: wcześniejszy z dwóch (razem z godziną, przypomnieniem i powtarzaniem)
  const sched = keep.due && (!drop.due || keep.due <= drop.due) ? keep : drop.due ? drop : keep;
  const kept: Task = {
    ...keep,
    projectId: keep.projectId ?? drop.projectId,
    stageId: keep.projectId ? (keep.stageId ?? (drop.projectId === keep.projectId ? drop.stageId : null)) : drop.stageId,
    parentIds: uniq([...keep.parentIds, ...drop.parentIds]).filter((p) => p !== keep.id && p !== drop.id),
    notes: joinNotes(keep.notes, drop.notes),
    subtasks: mergeSubtasks(keep.subtasks, drop.subtasks),
    priority: Math.min(keep.priority, drop.priority) as Task['priority'],
    status: keep.status === 'doing' || drop.status === 'doing' ? 'doing' : keep.status,
    due: sched.due,
    time: sched.time,
    remind: sched.remind,
    repeat: sched.repeat,
    every: sched.every,
    repeatDays: sched.repeatDays,
    repeatFrom: sched.repeatFrom,
    duration: keep.duration ?? drop.duration,
    doneCount: keep.doneCount + drop.doneCount,
  };
  // mniejsze zadania usuniętego przechodzą na to, które zostaje
  const moved = tasks
    .filter((t) => t.parentIds.includes(drop.id) && t.id !== keep.id)
    .map((t) => ({ ...t, parentIds: uniq(t.parentIds.map((p) => (p === drop.id ? keep.id : p))) }));
  return { change: { put: [kept, ...moved], del: [drop.id] }, kept, text: `Połączono w jedno: ${kept.title}` };
}

/**
 * „To samo” dla pary z pytania o duplikat:
 * - dwa zadania → jedno zadanie (powiązania obu),
 * - zadanie i podzadanie → zadanie wpływa też na właściciela podzadania (podzadanie znika z listy),
 * - dwa podzadania → jedno zadanie wpływające na oba większe zadania.
 */
export function mergeRefs(a: Ref, b: Ref, tasks: Task[], opts: { newId: () => string; now: number; today: string }): Merge {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  if (a.kind === 'task' && b.kind === 'task') return mergeTasks(a.task, b.task, tasks);

  if (a.kind === 'sub' && b.kind === 'sub') {
    const change = promoteSubtask(a.task, a.sub, { id: opts.newId(), now: opts.now, today: opts.today, extraParents: [b.task], done: a.sub.done || b.sub.done });
    const kept = change.put[0];
    const other = { ...b.task, subtasks: b.task.subtasks.filter((s) => s.id !== b.sub.id) };
    return { change: { put: [...change.put, other], del: [] }, kept, text: `„${kept.title}” to teraz jedno zadanie – wpływa na „${a.task.title}” i „${b.task.title}”` };
  }

  const [t, s] = a.kind === 'task' ? [a, b as Extract<Ref, { kind: 'sub' }>] : [b as Extract<Ref, { kind: 'task' }>, a];
  const owner = { ...s.task, subtasks: s.task.subtasks.filter((x) => x.id !== s.sub.id) };
  let kept = canLink(t.task.id, owner.id, taskMap) ? linkedChild(t.task, owner) : t.task;
  // podzadanie było już odhaczone – to samo zadanie jest więc zrobione
  if (s.sub.done && !isDone(kept) && !kept.repeat) kept = { ...kept, ...completionPatch(kept, opts.now, opts.today) };
  return { change: { put: [kept, owner], del: [] }, kept, text: `„${kept.title}” wpływa teraz także na „${owner.title}”` };
}

/** Usunięcie zadania: jego mniejsze zadania tracą to powiązanie. */
export function unlinkDeleted(id: string, tasks: Task[]): Task[] {
  return tasks.filter((t) => t.parentIds.includes(id)).map((t) => ({ ...t, parentIds: t.parentIds.filter((p) => p !== id) }));
}

/** Nowa lista par „różne” (najnowsze na końcu, z limitem). */
export function addDistinct(list: string[], key: string): string[] {
  return [...list.filter((k) => k !== key), key].slice(-MAX_DISTINCT);
}
