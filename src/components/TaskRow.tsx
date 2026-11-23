import { useState } from 'react';
import { useData } from '../data';
import { fmtDue, fmtDuration, minutesOf, timeOf, todayISO } from '../lib/dates';
import { isDone, isOverdue, subtaskProgress, taskRepeatLabel } from '../lib/tasks';
import type { Task } from '../types';
import { completeTask, reopenTask } from './actions';
import { Icon } from './Icon';
import { confirmAction } from './Sheet';
import { useUI } from './UIContext';
import { Dot } from './ui';
import type { DragBind } from './useDrag';

/** „9:00–10:30” albo „9:00”. */
export const timeRange = (t: Pick<Task, 'time' | 'duration'>): string => (t.time ? (t.duration ? `${t.time}–${timeOf(minutesOf(t.time) + t.duration)}` : t.time) : '');

export const priorityColor = (p: number) => `var(--p${p})`;

/** Kółko do odhaczania w kolorze priorytetu. */
export function CheckButton({ task, onCheck, checked }: { task: Task; onCheck: () => void; checked: boolean }) {
  return (
    <button
      type="button"
      className={`task-check ${checked ? 'is-checked' : ''}`}
      style={{ ['--pc' as string]: priorityColor(task.priority) }}
      onClick={onCheck}
      aria-pressed={checked}
      aria-label={checked ? `Przywróć: ${task.title}` : `Zrobione: ${task.title}`}
      title={checked ? 'Przywróć' : task.repeat && task.due ? 'Zrobione – zadanie wróci z następnym terminem' : 'Zrobione'}
    >
      <Icon name="check" size={13} />
    </button>
  );
}

/** Odhaczenie z krótką animacją – zadanie znika z listy dopiero, gdy widać ptaszek. */
export function useCheck(task: Task) {
  const { uid, blocked } = useData();
  const [ticking, setTicking] = useState(false);
  const done = isDone(task);
  const toggle = () => {
    if (done) return reopenTask(uid, task);
    if (ticking) return;
    // projekt „po kolei”: krok poza kolejnością tylko po potwierdzeniu
    const waitsFor = blocked.get(task.id);
    if (waitsFor && !confirmAction(`Ten krok czeka na „${waitsFor.title}”. Oznaczyć go jako zrobiony mimo to?`)) return;
    setTicking(true);
    setTimeout(() => {
      completeTask(uid, task, todayISO());
      setTicking(false);
    }, 280);
  };
  return { checked: done || ticking, ticking, toggle };
}

export function TaskMeta({
  task,
  showProject = true,
  showDue = true,
  showStatus = true,
  showRepeat = false,
  showStage = true,
}: {
  task: Task;
  showProject?: boolean;
  showDue?: boolean;
  showStatus?: boolean;
  /** opis powtarzania słowami zamiast samej ikony */
  showRepeat?: boolean;
  /** etap projektu (np. w widoku pogrupowanym po etapach – bez) */
  showStage?: boolean;
}) {
  const { projectMap, stageMap, taskMap, children, blocked } = useData();
  const today = todayISO();
  const project = task.projectId ? projectMap.get(task.projectId) : undefined;
  const stage = showStage && task.stageId ? stageMap.get(task.stageId) : undefined;
  const sub = subtaskProgress(task, children.get(task.id));
  const parents = task.parentIds.map((id) => taskMap.get(id)).filter((p): p is Task => Boolean(p));
  const done = isDone(task);
  const waitsFor = done ? undefined : blocked.get(task.id);
  const items = [
    waitsFor && (
      <span key="wait" className="pill pill-wait" title={`Czeka na: ${waitsFor.title}`}>
        <Icon name="lock" size={11} /> czeka
      </span>
    ),
    showDue && task.due && (
      <span key="due" className={`meta meta-due ${isOverdue(task, today) ? 'is-overdue' : ''} ${task.due === today && !done ? 'is-today' : ''}`}>
        <Icon name="calendar" size={12} />
        {fmtDue(task.due, today)}
        {task.time && ` ${timeRange(task)}`}
      </span>
    ),
    !showDue && task.time && (
      <span key="time" className="meta">
        <Icon name="clock" size={12} />
        {timeRange(task)}
      </span>
    ),
    !task.time && task.duration && (
      <span key="dur" className="meta" title="Czas trwania">
        <Icon name="hourglass" size={12} />
        {fmtDuration(task.duration)}
      </span>
    ),
    task.repeat && (
      <span key="rep" className="meta" title={taskRepeatLabel(task)}>
        <Icon name="repeat" size={12} />
        {showRepeat && taskRepeatLabel(task)}
      </span>
    ),
    task.remind !== null && task.due && !done && (
      <span key="bell" className="meta" title="Przypomnienie">
        <Icon name="bell" size={12} />
      </span>
    ),
    sub.total > 0 && (
      <span key="sub" className="meta">
        <Icon name="checklist" size={12} />
        {sub.done}/{sub.total}
      </span>
    ),
    task.notes.trim() && (
      <span key="note" className="meta" title="Notatka">
        <Icon name="note" size={12} />
      </span>
    ),
    showStatus && task.status === 'doing' && (
      <span key="doing" className="pill pill-doing">
        w trakcie
      </span>
    ),
    parents.length > 0 && (
      <span key="parents" className="meta meta-link" title={`Wpływa na: ${parents.map((p) => p.title).join(', ')}`}>
        <Icon name="link" size={12} />
        {parents[0].title.length > 28 ? `${parents[0].title.slice(0, 27)}…` : parents[0].title}
        {parents.length > 1 && ` +${parents.length - 1}`}
      </span>
    ),
    showProject && project && (
      <span key="proj" className="meta meta-project">
        <Dot color={project.color} size={8} />
        {project.name}
        {stage && <span className="meta-stage">› {stage.name}</span>}
      </span>
    ),
    !showProject && stage && (
      <span key="stage" className="meta meta-project">
        <Icon name="milestone" size={12} />
        {stage.name}
      </span>
    ),
  ].filter(Boolean);
  if (!items.length) return null;
  return <span className="task-meta">{items}</span>;
}

export function TaskRow({
  task,
  showProject = true,
  showDue = true,
  showRepeat = false,
  showStage = true,
  bind,
  dragging = false,
}: {
  task: Task;
  showProject?: boolean;
  showDue?: boolean;
  showRepeat?: boolean;
  showStage?: boolean;
  bind?: DragBind;
  dragging?: boolean;
}) {
  const { openTask } = useUI();
  const { checked, ticking, toggle } = useCheck(task);
  return (
    <li className={`task ${isDone(task) ? 'is-done' : ''} ${ticking ? 'is-ticking' : ''} ${dragging ? 'is-dragging' : ''}`}>
      <CheckButton task={task} checked={checked} onCheck={toggle} />
      <button type="button" className="task-main" onClick={() => openTask(task.id)} {...bind}>
        <span className="task-title">{task.title}</span>
        <TaskMeta task={task} showProject={showProject} showDue={showDue} showRepeat={showRepeat} showStage={showStage} />
      </button>
      {task.priority < 4 && !isDone(task) && (
        <span className="task-flag" style={{ color: priorityColor(task.priority) }} title={`Priorytet: ${['', 'pilne', 'wysoki', 'średni'][task.priority]}`}>
          <Icon name="flag" size={14} />
        </span>
      )}
    </li>
  );
}

export function TaskList({ tasks, ...rest }: { tasks: Task[]; showProject?: boolean; showDue?: boolean; showRepeat?: boolean; showStage?: boolean }) {
  return (
    <ul className="task-list">
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} {...rest} />
      ))}
    </ul>
  );
}
