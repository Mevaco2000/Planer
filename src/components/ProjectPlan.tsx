// Plan projektu: kroki w ustalonej kolejności. Projekt „po kolei” blokuje kroki do czasu zrobienia poprzedniego.
import { collection, query, where } from 'firebase/firestore';
import { useState } from 'react';
import { useData } from '../data';
import { db } from '../firebase';
import { useLiveQuery } from '../hooks';
import { todayISO } from '../lib/dates';
import { newTaskId, saveProject, saveTask, setTaskOrders } from '../lib/db';
import { findSimilar, pairKey, refKey, type Ref } from '../lib/links';
import { normTask } from '../lib/norm';
import { parseQuickAdd } from '../lib/quickAdd';
import { blankTask, compareOrder, isDone, reorder, type OrderChange } from '../lib/tasks';
import type { Project, Task } from '../types';
import { commitChange, markDistinct } from './actions';
import { SimilarQuestion } from './Duplicates';
import { Icon } from './Icon';
import { sameAsExisting } from './QuickAdd';
import { TaskMeta, useCheck } from './TaskRow';
import { run, toast } from './Toast';
import { Empty, Progress } from './ui';
import { useUI } from './UIContext';
import { DragGhost, isAfter, useDrag, type DragBind } from './useDrag';

type StepState = 'done' | 'current' | 'locked' | 'open';

function StepRow({
  task,
  n,
  state,
  first,
  last,
  onMove,
  bind,
  dragging,
  edge,
  warn,
}: {
  task: Task;
  n: number;
  state: StepState;
  first: boolean;
  last: boolean;
  onMove: (dir: -1 | 1) => void;
  bind: DragBind;
  dragging: boolean;
  edge: 'before' | 'after' | null;
  warn: boolean;
}) {
  const { openTask } = useUI();
  const { checked, ticking, toggle } = useCheck(task);
  const done = state === 'done';
  return (
    <li className={`step is-${state} ${dragging ? 'is-dragging' : ''} ${edge ? `drop-${edge}` : ''} ${ticking ? 'is-ticking' : ''}`} data-drop={task.id}>
      <button
        type="button"
        className="step-dot"
        onClick={toggle}
        aria-pressed={checked}
        aria-label={checked ? `Przywróć: ${task.title}` : `Zrobione: ${task.title}`}
        title={checked ? 'Przywróć' : state === 'locked' ? 'Czeka na poprzedni krok' : 'Zrobione'}
      >
        {checked ? <Icon name="check" size={14} /> : state === 'locked' ? <Icon name="lock" size={12} /> : n}
      </button>
      <button type="button" className="step-main" onClick={() => openTask(task.id)} {...(done ? {} : bind)}>
        {state === 'current' && <span className="step-label">Następny krok</span>}
        <span className="task-title">{task.title}</span>
        <TaskMeta task={task} showProject={false} />
        {warn && (
          <span className="meta warn-text">
            <Icon name="warn" size={12} /> termin wcześniej niż w poprzednim kroku
          </span>
        )}
      </button>
      {!done && (
        <div className="step-move">
          <button type="button" className="icon-btn icon-btn-sm" disabled={first} onClick={() => onMove(-1)} aria-label={`Wyżej: ${task.title}`} title="Wyżej">
            <Icon name="up" size={16} />
          </button>
          <button type="button" className="icon-btn icon-btn-sm" disabled={last} onClick={() => onMove(1)} aria-label={`Niżej: ${task.title}`} title="Niżej">
            <Icon name="down" size={16} />
          </button>
        </div>
      )}
    </li>
  );
}

export function ProjectPlan({ project, stageId = null }: { project: Project; stageId?: string | null }) {
  const { uid, tasks, taskMap, projects, settings, blocked } = useData();
  const [text, setText] = useState('');
  const [ask, setAsk] = useState<{ found: Ref; draft: Task } | null>(null);
  // wszystkie zadania projektu, także zrobione dawniej niż 2 tygodnie temu – inaczej numeracja kroków by się rozjeżdżała
  const all = useLiveQuery(() => query(collection(db, 'users', uid, 'tasks'), where('projectId', '==', project.id)), normTask, `project-tasks:${uid}:${project.id}`);
  const allSteps = all ?? tasks.filter((t) => t.projectId === project.id);
  // wybrany etap – tylko jego kroki
  const steps = allSteps.filter((t) => !stageId || t.stageId === stageId).sort(compareOrder);

  const apply = (changes: OrderChange[]) => {
    if (changes.length) run(setTaskOrders(uid, changes));
  };
  const { drag, bind } = useDrag<Task>((t, target, info) => apply(reorder(steps, t.id, target, isAfter(info.y, info.box))));
  const move = (t: Task, dir: -1 | 1) => {
    const j = steps.findIndex((s) => s.id === t.id) + dir;
    if (j >= 0 && j < steps.length) apply(reorder(steps, t.id, steps[j].id, dir > 0));
  };

  const doneCount = steps.filter(isDone).length;
  // „następny krok” – pierwszy otwarty, który nie czeka na krok z innego etapu
  const current = steps.find((t) => !isDone(t) && !blocked.has(t.id));

  // termin wcześniejszy niż w którymś z poprzednich otwartych kroków – pewnie coś jest nie po kolei
  const warnings = new Set<string>();
  let maxDue: string | null = null;
  for (const t of steps) {
    if (isDone(t)) continue;
    if (t.due && maxDue && t.due < maxDue) warnings.add(t.id);
    if (t.due && (!maxDue || t.due > maxDue)) maxDue = t.due;
  }

  const addStep = () => {
    const p = parseQuickAdd(text, new Date(), projects, ['project']);
    if (!p.title || ask) return;
    const now = Date.now();
    const lastOrder = Math.max(-Infinity, ...allSteps.map((s) => s.order));
    const draft = blankTask(newTaskId(uid), now, {
      title: p.title,
      projectId: project.id,
      stageId: stageId ?? null,
      priority: p.priority ?? 4,
      due: p.due,
      time: p.due ? p.time : null,
      duration: p.duration,
      remind: p.due && p.time ? settings.defaultRemind : null,
      repeat: p.due ? p.repeat : null,
      every: p.every,
      repeatDays: p.repeatDays,
      order: Number.isFinite(lastOrder) ? lastOrder + 1024 : now,
    });
    const found = findSimilar(draft.title, tasks, { distinct: settings.distinct });
    if (found) setAsk({ found, draft });
    else {
      run(saveTask(uid, draft));
      setText('');
    }
  };

  const askSame = () => {
    if (!ask) return;
    const r = sameAsExisting(ask.found, ask.draft, Date.now(), todayISO());
    if (r.put.length) commitChange(uid, { put: r.put, del: [] }, taskMap, r.text);
    else toast(r.text);
    setAsk(null);
    setText('');
  };

  const askDifferent = () => {
    if (!ask) return;
    markDistinct(uid, settings, pairKey(`t:${ask.draft.id}`, refKey(ask.found)));
    run(saveTask(uid, ask.draft));
    setAsk(null);
    setText('');
  };

  const stateOf = (t: Task): StepState =>
    isDone(t) ? 'done' : t.id === current?.id ? 'current' : project.sequential && (blocked.has(t.id) || current) ? 'locked' : 'open';
  const edgeOf = (t: Task) => (drag && drag.over === t.id && drag.item.id !== t.id ? (isAfter(drag.y, drag.box) ? 'after' : 'before') : null);

  return (
    <>
      <section className="card">
        {steps.length > 0 && (
          <>
            <div className="row">
              <span className="grow">
                <b>
                  {doneCount} z {steps.length}
                </b>{' '}
                <span className="muted">kroków zrobione</span>
              </span>
              {steps.every(isDone) && <span className="ok-text small">{stageId ? 'Etap ukończony' : 'Projekt ukończony'}</span>}
            </div>
            <Progress value={doneCount} max={steps.length} />
          </>
        )}
        <label className="switch-row">
          <input type="checkbox" checked={project.sequential} onChange={(e) => run(saveProject(uid, { ...project, sequential: e.target.checked }))} />
          <span className="grow">
            <b>Po kolei</b>
            <span className="hint block">
              Następny krok odblokowuje się dopiero po zrobieniu poprzedniego. W „Dziś” i innych widokach zablokowane kroki mają znaczek „czeka”.
            </span>
          </span>
        </label>
      </section>

      <section className="card steps-card">
        {steps.length === 0 ? (
          <Empty title="Plan jest pusty" icon={<Icon name="steps" size={28} />}>
            Dodaj kroki w kolejności, w jakiej trzeba je wykonać – np. „Zebrać dokumenty”, „Wypełnić wniosek”, „Złożyć w urzędzie do piątku”.
          </Empty>
        ) : (
          <ol className="steps">
            {steps.map((t, i) => (
              <StepRow
                key={t.id}
                task={t}
                n={i + 1}
                state={stateOf(t)}
                first={i === 0}
                last={i === steps.length - 1}
                onMove={(dir) => move(t, dir)}
                bind={bind(t)}
                dragging={drag?.item.id === t.id}
                edge={edgeOf(t)}
                warn={warnings.has(t.id)}
              />
            ))}
          </ol>
        )}
        <div className="input-row step-add">
          <input
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setAsk(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addStep())}
            placeholder="Dodaj krok… (np. „Złożyć wniosek do piątku”)"
            aria-label="Nowy krok"
            enterKeyHint="done"
          />
          <button type="button" className="btn btn-soft" onClick={addStep} disabled={!text.trim() || ask !== null} aria-label="Dodaj krok">
            <Icon name="plus" size={18} />
          </button>
        </div>
        {ask && (
          <SimilarQuestion
            found={ask.found}
            sameLabel={ask.found.kind === 'sub' ? 'To samo – zrób z niego krok' : 'To samo – nie dodawaj'}
            differentLabel="Różne – dodaj krok"
            onSame={askSame}
            onDifferent={askDifferent}
            onCancel={() => setAsk(null)}
          />
        )}
      </section>
      {steps.length > 1 && <p className="hint center">Przeciągnij krok, żeby zmienić kolejność (na telefonie: przytrzymaj i przeciągnij), albo użyj strzałek.</p>}

      {drag && (
        <DragGhost x={drag.x} y={drag.y} touch={drag.touch}>
          <b>{drag.item.title}</b>
          <span className="drag-ghost-to">{drag.over && drag.over !== drag.item.id ? 'upuść tutaj' : 'przeciągnij na inne miejsce'}</span>
        </DragGhost>
      )}
    </>
  );
}
