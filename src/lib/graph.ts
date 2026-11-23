// Graf zadań: projekty → etapy → zadania → mniejsze zadania i podzadania.
// Zadanie, które wpływa na kilka większych, stoi pod jednym z nich, a do pozostałych prowadzą przerywane linie.
// Układ warstwowy od lewej: kolumna = poziom (najdłuższa ścieżka od korzenia), wiersze jak w drzewie.
import type { Project, Stage, Task } from '../types';
import { compareOrder, isDone, isOverdue, subtaskProgress } from './tasks';

export type NodeKind = 'project' | 'inbox' | 'stage' | 'task' | 'sub';

export interface GraphNode {
  /** p:ID, inbox, s:ID, t:ID, u:IDZADANIA:IDPODZADANIA */
  id: string;
  kind: NodeKind;
  label: string;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  /** zadanie (dla podzadania – jego właściciel) */
  taskId: string | null;
  projectId: string | null;
  stageId: string | null;
  done: boolean;
  overdue: boolean;
  doing: boolean;
  /** wpływa na więcej niż jedno widoczne większe zadanie */
  shared: boolean;
  progress: { done: number; total: number } | null;
  due: string | null;
  /** numer kroku w projekcie „po kolei” */
  step: number | null;
  /** z innego projektu (w grafie jednego projektu – powiązane zadanie spoza niego) */
  external: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
  /** tree – należy do; link – wpływa też na */
  kind: 'tree' | 'link';
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
}

export interface GraphInput {
  projects: Project[];
  stages: Stage[];
  tasks: Task[];
  today: string;
  /** tylko ten projekt (z powiązanymi zadaniami spoza niego); undefined = wszystko */
  projectId?: string;
  /** tylko ten etap projektu */
  stageId?: string | null;
  showDone: boolean;
  showSubtasks: boolean;
}

const SIZE: Record<NodeKind, [number, number]> = {
  project: [190, 50],
  inbox: [190, 50],
  stage: [180, 46],
  task: [210, 48],
  sub: [180, 34],
};
export const GRAPH_COL = 266;
const GAP_Y = 10;
const ROOT_GAP = 26;
const PAD = 16;
const KIND_ORDER: Record<NodeKind, number> = { project: 0, inbox: 1, stage: 2, task: 3, sub: 4 };

export function buildGraph(input: GraphInput): Graph {
  const { projects, stages, today, showDone, showSubtasks } = input;
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const visible = (t: Task) => showDone || !isDone(t);

  // ---------- które zadania ----------
  let tasks: Task[];
  const external = new Set<string>();
  if (input.projectId) {
    const inScope = (t: Task) => t.projectId === input.projectId && (!input.stageId || t.stageId === input.stageId);
    const own = input.tasks.filter((t) => inScope(t) && visible(t));
    const ownIds = new Set(own.map((t) => t.id));
    const byId = new Map(input.tasks.map((t) => [t.id, t]));
    const extra = new Map<string, Task>();
    // większe zadania spoza projektu i mniejsze spoza projektu – jeden krok
    for (const t of own) for (const pid of t.parentIds) {
      const p = byId.get(pid);
      if (p && !ownIds.has(p.id) && visible(p)) extra.set(p.id, p);
    }
    for (const t of input.tasks) if (!ownIds.has(t.id) && visible(t) && t.parentIds.some((p) => ownIds.has(p))) extra.set(t.id, t);
    for (const id of extra.keys()) external.add(id);
    tasks = [...own, ...extra.values()];
  } else tasks = input.tasks.filter(visible);
  const taskIds = new Set(tasks.map((t) => t.id));

  // ---------- węzły ----------
  const nodes = new Map<string, GraphNode>();
  const add = (n: Omit<GraphNode, 'x' | 'y' | 'w' | 'h' | 'depth'>) => {
    const [w, h] = SIZE[n.kind];
    nodes.set(n.id, { ...n, x: 0, y: 0, w, h, depth: 0 });
  };
  const base = { taskId: null, projectId: null, stageId: null, done: false, overdue: false, doing: false, shared: false, progress: null, due: null, step: null, external: false };

  const projectTasks = (pid: string) => tasks.filter((t) => t.projectId === pid && !external.has(t.id));
  const shownProjects = input.projectId
    ? projects.filter((p) => p.id === input.projectId)
    : projects.filter((p) => projectTasks(p.id).length > 0 || stages.some((s) => s.projectId === p.id));
  for (const p of shownProjects) {
    const mine = projectTasks(p.id);
    add({ ...base, id: `p:${p.id}`, kind: 'project', label: p.name, color: p.color, projectId: p.id, progress: { done: mine.filter(isDone).length, total: mine.length } });
  }
  if (!input.projectId && tasks.some((t) => t.projectId === null)) {
    const mine = tasks.filter((t) => t.projectId === null);
    add({ ...base, id: 'inbox', kind: 'inbox', label: 'Skrzynka', color: 'var(--muted)', progress: { done: mine.filter(isDone).length, total: mine.length } });
  }
  const shownStages = stages.filter((s) => nodes.has(`p:${s.projectId}`) && (!input.stageId || s.id === input.stageId));
  for (const s of shownStages) {
    const mine = tasks.filter((t) => t.stageId === s.id && !external.has(t.id));
    add({
      ...base,
      id: `s:${s.id}`,
      kind: 'stage',
      label: s.name,
      color: projectMap.get(s.projectId)?.color ?? 'var(--accent)',
      projectId: s.projectId,
      stageId: s.id,
      due: s.due,
      done: mine.length > 0 && mine.every(isDone),
      overdue: s.due !== null && s.due < today && mine.some((t) => !isDone(t)),
      progress: { done: mine.filter(isDone).length, total: mine.length },
    });
  }

  // kroki w projektach „po kolei”
  const steps = new Map<string, number>();
  for (const p of projects) {
    if (!p.sequential) continue;
    tasks
      .filter((t) => t.projectId === p.id)
      .sort(compareOrder)
      .forEach((t, i) => steps.set(t.id, i + 1));
  }

  const childCount = new Map<string, Task[]>();
  for (const t of tasks) for (const pid of t.parentIds) if (taskIds.has(pid)) childCount.set(pid, [...(childCount.get(pid) ?? []), t]);

  for (const t of tasks) {
    const prog = subtaskProgress(t, childCount.get(t.id));
    add({
      ...base,
      id: `t:${t.id}`,
      kind: 'task',
      label: t.title,
      color: (t.projectId && projectMap.get(t.projectId)?.color) || 'var(--muted)',
      taskId: t.id,
      projectId: t.projectId,
      stageId: t.stageId,
      done: isDone(t),
      overdue: isOverdue(t, today),
      doing: t.status === 'doing' && !isDone(t),
      shared: t.parentIds.filter((p) => taskIds.has(p)).length > 1,
      progress: prog.total ? prog : null,
      due: t.due,
      step: steps.get(t.id) ?? null,
      external: external.has(t.id),
    });
    if (showSubtasks) {
      for (const s of t.subtasks) {
        if (s.done && !showDone && !isDone(t)) continue;
        add({ ...base, id: `u:${t.id}:${s.id}`, kind: 'sub', label: s.title, color: nodes.get(`t:${t.id}`)!.color, taskId: t.id, projectId: t.projectId, done: s.done || isDone(t), external: external.has(t.id) });
      }
    }
  }

  // ---------- kandydaci na rodzica w drzewie ----------
  const cands = new Map<string, string[]>();
  for (const n of nodes.values()) {
    let c: string[] = [];
    if (n.kind === 'stage') c = [`p:${n.projectId}`];
    else if (n.kind === 'sub') c = [`t:${n.taskId}`];
    else if (n.kind === 'task') {
      const t = tasks.find((x) => x.id === n.taskId)!;
      c = t.parentIds.filter((p) => taskIds.has(p)).map((p) => `t:${p}`);
      if (!c.length && !n.external) {
        if (t.stageId && nodes.has(`s:${t.stageId}`)) c = [`s:${t.stageId}`];
        else if (t.projectId && nodes.has(`p:${t.projectId}`)) c = [`p:${t.projectId}`];
        else if (!t.projectId && nodes.has('inbox')) c = ['inbox'];
      }
    }
    cands.set(n.id, c.filter((id) => nodes.has(id) && id !== n.id));
  }

  // poziom = najdłuższa ścieżka od korzenia (zapętlenia przerywamy)
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const c = cands.get(id) ?? [];
    const d = c.length ? 1 + Math.max(...c.map(depthOf)) : 0;
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const id of nodes.keys()) depthOf(id);

  const edges: GraphEdge[] = [];
  const kids = new Map<string, string[]>();
  const roots: string[] = [];
  for (const n of nodes.values()) {
    n.depth = depth.get(n.id) ?? 0;
    const c = (cands.get(n.id) ?? []).filter((p) => (depth.get(p) ?? 0) < n.depth);
    if (!c.length) {
      roots.push(n.id);
      continue;
    }
    // pod najgłębszym rodzicem (wtedy linia drzewa ma długość jednej kolumny), do reszty – przerywane linie
    const primary = c.reduce((a, b) => ((depth.get(b) ?? 0) > (depth.get(a) ?? 0) ? b : a));
    kids.set(primary, [...(kids.get(primary) ?? []), n.id]);
    edges.push({ from: primary, to: n.id, kind: 'tree' });
    for (const p of c) if (p !== primary) edges.push({ from: p, to: n.id, kind: 'link' });
  }

  // ---------- kolejność i położenie ----------
  const stageOrder = new Map(stages.map((s, i) => [s.id, i]));
  const projectOrder = new Map(projects.map((p, i) => [p.id, i]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const subIndex = (id: string) => {
    const [, tid, sid] = id.split(':');
    return taskById.get(tid)?.subtasks.findIndex((s) => s.id === sid) ?? 0;
  };
  const cmp = (a: string, b: string): number => {
    const x = nodes.get(a)!;
    const y = nodes.get(b)!;
    if (x.external !== y.external) return x.external ? 1 : -1;
    if (x.kind !== y.kind) return KIND_ORDER[x.kind] - KIND_ORDER[y.kind];
    if (x.kind === 'project') return (projectOrder.get(x.projectId!) ?? 0) - (projectOrder.get(y.projectId!) ?? 0);
    if (x.kind === 'stage') return (stageOrder.get(x.stageId!) ?? 0) - (stageOrder.get(y.stageId!) ?? 0);
    if (x.kind === 'sub') return subIndex(a) - subIndex(b);
    const tx = taskById.get(x.taskId!)!;
    const ty = taskById.get(y.taskId!)!;
    if (x.done !== y.done) return x.done ? 1 : -1;
    return compareOrder(tx, ty);
  };

  let cursor = PAD;
  const place = (id: string) => {
    const n = nodes.get(id)!;
    const ch = (kids.get(id) ?? []).sort(cmp);
    if (!ch.length) {
      n.y = cursor;
      cursor += n.h + GAP_Y;
      return;
    }
    for (const c of ch) place(c);
    const first = nodes.get(ch[0])!;
    const last = nodes.get(ch[ch.length - 1])!;
    n.y = Math.max(PAD, (first.y + first.h / 2 + last.y + last.h / 2) / 2 - n.h / 2);
    // rodzic wyższy niż jedno dziecko nie może najechać na następny wiersz
    cursor = Math.max(cursor, n.y + n.h + GAP_Y);
  };
  roots.sort(cmp).forEach((r, i) => {
    if (i > 0) cursor += ROOT_GAP;
    place(r);
  });

  let maxDepth = 0;
  for (const n of nodes.values()) {
    n.x = PAD + n.depth * GRAPH_COL;
    maxDepth = Math.max(maxDepth, n.depth);
  }
  const width = PAD * 2 + maxDepth * GRAPH_COL + Math.max(...[...nodes.values()].map((n) => n.w), 0);
  return { nodes: [...nodes.values()], edges, width, height: cursor + PAD };
}

/** Ścieżka krzywej między węzłami: z prawej krawędzi rodzica do lewej krawędzi dziecka. */
export function edgePath(a: Pick<GraphNode, 'x' | 'y' | 'w' | 'h'>, b: Pick<GraphNode, 'x' | 'y' | 'w' | 'h'>): string {
  const x1 = a.x + a.w;
  const y1 = a.y + a.h / 2;
  const x2 = b.x;
  const y2 = b.y + b.h / 2;
  const dx = Math.max(28, Math.abs(x2 - x1) / 2);
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
}
