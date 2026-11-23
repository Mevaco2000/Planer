// Tablica projektu: do zrobienia / w trakcie / zrobione – przeciąganie między kolumnami zmienia status.
import { useData } from '../data';
import { fmtDue, todayISO } from '../lib/dates';
import { restoreTasks, updateTask } from '../lib/db';
import { compareDone, isDone, sortTasks, statusPatch, STATUSES } from '../lib/tasks';
import type { Status, Task } from '../types';
import { Icon } from './Icon';
import { CheckButton, priorityColor, TaskMeta, useCheck } from './TaskRow';
import { run, toast } from './Toast';
import { useUI } from './UIContext';
import { DragGhost, useDrag, type DragBind } from './useDrag';

function BoardCard({ task, bind, dragging }: { task: Task; bind: DragBind; dragging: boolean }) {
  const { openTask } = useUI();
  const { checked, ticking, toggle } = useCheck(task);
  return (
    <li
      className={`board-card ${isDone(task) ? 'is-done' : ''} ${ticking ? 'is-ticking' : ''} ${dragging ? 'is-dragging' : ''}`}
      style={{ ['--pc' as string]: priorityColor(task.priority) }}
    >
      <CheckButton task={task} checked={checked} onCheck={toggle} />
      <button type="button" className="board-card-main" onClick={() => openTask(task.id)} {...bind}>
        <span className="task-title">{task.title}</span>
        {/* status widać po kolumnie */}
        <TaskMeta task={task} showProject={false} showStatus={false} />
      </button>
    </li>
  );
}

export function Board({ tasks, projectId, stageId = null }: { tasks: Task[]; projectId: string; stageId?: string | null }) {
  const { uid } = useData();
  const { quickAdd } = useUI();
  const { drag, bind } = useDrag<Task>((t, target) => {
    const status = target as Status;
    if (t.status === status) return;
    const today = todayISO();
    const patch = statusPatch(t, status, Date.now(), today);
    if (!Object.keys(patch).length) return;
    run(updateTask(uid, t.id, patch));
    const label = patch.due ? `Zrobione – następny raz: ${fmtDue(patch.due, today)}` : `${STATUSES.find((s) => s.value === status)?.label}: ${t.title}`;
    toast(label, 'info', { label: 'Cofnij', run: () => run(restoreTasks(uid, [t])) });
  });

  const columns: Record<Status, Task[]> = {
    todo: sortTasks(tasks.filter((t) => !isDone(t) && t.status === 'todo')),
    doing: sortTasks(tasks.filter((t) => !isDone(t) && t.status === 'doing')),
    done: tasks.filter(isDone).sort(compareDone),
  };

  return (
    <div className="board">
      {STATUSES.map((s) => (
        <section key={s.value} className={`board-col col-${s.value} ${drag?.over === s.value ? 'drop-over' : ''}`} data-drop={s.value}>
          <header className="board-col-head">
            <span className={`status-dot s-${s.value}`} />
            <b>{s.label}</b>
            <span className="muted">{columns[s.value].length}</span>
          </header>
          <ul className="board-cards">
            {columns[s.value].map((t) => (
              <BoardCard key={t.id} task={t} bind={bind(t)} dragging={drag?.item.id === t.id} />
            ))}
          </ul>
          {s.value !== 'done' && (
            <button type="button" className="board-add" onClick={() => quickAdd({ projectId, stageId, status: s.value })}>
              <Icon name="plus" size={16} /> Dodaj
            </button>
          )}
        </section>
      ))}
      {drag && (
        <DragGhost x={drag.x} y={drag.y} touch={drag.touch}>
          <b>{drag.item.title}</b>
          <span className="drag-ghost-to">{drag.over ? `→ ${STATUSES.find((s) => s.value === drag.over)?.label}` : 'upuść w kolumnie'}</span>
        </DragGhost>
      )}
    </div>
  );
}
