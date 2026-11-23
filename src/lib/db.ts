// Wszystkie zapisy do Firestore w jednym miejscu.
// Offline obietnice zapisu kończą się dopiero po synchronizacji – UI ich nie czeka (patrz `run` w components/Toast).
import { collection, deleteDoc, doc, getDocs, query, setDoc, updateDoc, where, writeBatch, type WriteBatch } from 'firebase/firestore';
import { db } from '../firebase';
import type { Group, Project, Settings, Stage, Task } from '../types';
import type { Change } from './links';
import type { OrderChange } from './tasks';

const userRef = (uid: string) => doc(db, 'users', uid);
export const tasksCol = (uid: string) => collection(db, 'users', uid, 'tasks');
const projectsCol = (uid: string) => collection(db, 'users', uid, 'projects');
const groupsCol = (uid: string) => collection(db, 'users', uid, 'groups');
const stagesCol = (uid: string) => collection(db, 'users', uid, 'stages');

export const newTaskId = (uid: string): string => doc(tasksCol(uid)).id;
export const newProjectId = (uid: string): string => doc(projectsCol(uid)).id;
export const newGroupId = (uid: string): string => doc(groupsCol(uid)).id;
export const newStageId = (uid: string): string => doc(stagesCol(uid)).id;

const strip = <T extends { id: string }>(o: T): Omit<T, 'id'> => {
  const { id: _id, ...rest } = o;
  return rest;
};

// ---------- zadania ----------

/** Zapis całego zadania (nowe albo po edycji). */
export function saveTask(uid: string, t: Task) {
  return setDoc(doc(tasksCol(uid), t.id), { ...strip(t), updatedAt: Date.now() });
}

export function updateTask(uid: string, id: string, patch: Partial<Omit<Task, 'id'>>) {
  return updateDoc(doc(tasksCol(uid), id), { ...patch, updatedAt: Date.now() });
}

/** Te same zmiany w wielu zadaniach jednym zapisem (np. „przełóż zaległe na dziś”). */
export function updateTasks(uid: string, ids: string[], patch: Partial<Omit<Task, 'id'>>) {
  const batch = writeBatch(db);
  const now = Date.now();
  for (const id of ids) batch.update(doc(tasksCol(uid), id), { ...patch, updatedAt: now });
  return batch.commit();
}

/** Przywrócenie wielu zadań do poprzedniego stanu (cofnięcie). */
export function restoreTasks(uid: string, tasks: Task[]) {
  const batch = writeBatch(db);
  for (const t of tasks) batch.set(doc(tasksCol(uid), t.id), strip(t));
  return batch.commit();
}

export function deleteTask(uid: string, id: string) {
  return deleteDoc(doc(tasksCol(uid), id));
}

/** Kilka zadań naraz (połączenie duplikatów, powiązania, cofnięcie) – jednym zapisem. */
export function applyChange(uid: string, change: Change) {
  const batch = writeBatch(db);
  const now = Date.now();
  for (const t of change.put) batch.set(doc(tasksCol(uid), t.id), { ...strip(t), updatedAt: now });
  for (const id of change.del) batch.delete(doc(tasksCol(uid), id));
  return batch.commit();
}

/** Nowa kolejność kroków projektu (po przeciągnięciu albo strzałkach). */
export function setTaskOrders(uid: string, changes: OrderChange[]) {
  const batch = writeBatch(db);
  const now = Date.now();
  for (const c of changes) batch.update(doc(tasksCol(uid), c.id), { order: c.order, updatedAt: now });
  return batch.commit();
}

// ---------- projekty i grupy ----------

export function saveProject(uid: string, p: Project) {
  return setDoc(doc(projectsCol(uid), p.id), strip(p));
}

/** Zapis grupy i przypisanie do niej projektów (`members`); projekty odznaczone wypadają z grupy. */
export function saveGroup(uid: string, g: Group, projects: Project[], members: Set<string>) {
  const batch = writeBatch(db);
  batch.set(doc(groupsCol(uid), g.id), strip(g));
  for (const p of projects) {
    const inGroup = p.groupId === g.id;
    if (members.has(p.id) && !inGroup) batch.update(doc(projectsCol(uid), p.id), { groupId: g.id });
    else if (!members.has(p.id) && inGroup) batch.update(doc(projectsCol(uid), p.id), { groupId: null });
  }
  return batch.commit();
}

/** Usuwa grupę; jej projekty zostają, tylko bez grupy. */
export function deleteGroup(uid: string, id: string, projects: Project[]) {
  const batch = writeBatch(db);
  for (const p of projects) if (p.groupId === id) batch.update(doc(projectsCol(uid), p.id), { groupId: null });
  batch.delete(doc(groupsCol(uid), id));
  return batch.commit();
}

type Op = (b: WriteBatch) => void;

async function commitInChunks(ops: Op[]) {
  for (let i = 0; i < ops.length; i += 450) {
    const batch = writeBatch(db);
    for (const op of ops.slice(i, i + 450)) op(batch);
    await batch.commit();
  }
}

/** Usuwa projekt i jego etapy; zadania (także dawno zrobione) trafiają do Skrzynki albo są usuwane. */
export async function deleteProject(uid: string, id: string, tasks: 'inbox' | 'delete') {
  const [snap, stages] = await Promise.all([getDocs(query(tasksCol(uid), where('projectId', '==', id))), getDocs(query(stagesCol(uid), where('projectId', '==', id)))]);
  const now = Date.now();
  await commitInChunks([
    ...snap.docs.map((d): Op => (b) => (tasks === 'delete' ? b.delete(d.ref) : b.update(d.ref, { projectId: null, stageId: null, updatedAt: now }))),
    ...stages.docs.map((d): Op => (b) => b.delete(d.ref)),
    (b) => b.delete(doc(projectsCol(uid), id)),
  ]);
  return snap.size;
}

// ---------- etapy ----------

export function saveStage(uid: string, s: Stage) {
  return setDoc(doc(stagesCol(uid), s.id), strip(s));
}

/** Nowa kolejność etapów (strzałki w edycji etapu). */
export function setStageOrders(uid: string, changes: { id: string; order: number }[]) {
  const batch = writeBatch(db);
  for (const c of changes) batch.update(doc(stagesCol(uid), c.id), { order: c.order });
  return batch.commit();
}

/** Usuwa etap; jego zadania zostają w projekcie, tylko bez etapu (także dawno zrobione). */
export async function deleteStage(uid: string, id: string) {
  const snap = await getDocs(query(tasksCol(uid), where('stageId', '==', id)));
  const now = Date.now();
  await commitInChunks([...snap.docs.map((d): Op => (b) => b.update(d.ref, { stageId: null, updatedAt: now })), (b) => b.delete(doc(stagesCol(uid), id))]);
  return snap.size;
}

// ---------- ustawienia i dane ----------

export function saveSettings(uid: string, patch: Partial<Settings>) {
  return setDoc(userRef(uid), patch, { merge: true });
}

/** Usuwa zadania zrobione przed podaną chwilą; zwraca ich liczbę. */
export async function deleteDoneBefore(uid: string, before: number) {
  const snap = await getDocs(query(tasksCol(uid), where('completedAt', '<', before)));
  await commitInChunks(snap.docs.map((d): Op => (b) => b.delete(d.ref)));
  return snap.size;
}

/** Wszystkie dane (także stare zrobione zadania) – do pobrania jako kopia JSON. */
export async function exportAll(uid: string) {
  const [tasks, projects, groups, stages] = await Promise.all([getDocs(tasksCol(uid)), getDocs(projectsCol(uid)), getDocs(groupsCol(uid)), getDocs(stagesCol(uid))]);
  return {
    exportedAt: new Date().toISOString(),
    groups: groups.docs.map((d) => ({ id: d.id, ...d.data() })),
    projects: projects.docs.map((d) => ({ id: d.id, ...d.data() })),
    stages: stages.docs.map((d) => ({ id: d.id, ...d.data() })),
    tasks: tasks.docs.map((d) => ({ id: d.id, ...d.data() })),
  };
}
