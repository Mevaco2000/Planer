import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Board } from '../components/Board';
import { DuplicatesCard } from '../components/Duplicates';
import { Icon } from '../components/Icon';
import { ProjectPlan } from '../components/ProjectPlan';
import { ProjectSheet } from '../components/ProjectSheet';
import { StageSheet } from '../components/StageSheet';
import { TaskGraph } from '../components/TaskGraph';
import { TaskList, TaskRow } from '../components/TaskRow';
import { restoreTasks, updateTask } from '../lib/db';
import { run, toast } from '../components/Toast';
import { Dot, Empty, Fold, PageHead, Progress, Segmented, Spinner } from '../components/ui';
import { useUI } from '../components/UIContext';
import { DragGhost, useDrag } from '../components/useDrag';
import { DONE_DAYS, useData } from '../data';
import { useToday } from '../hooks';
import { fmtDue } from '../lib/dates';
import { plural } from '../lib/format';
import { compareDone, isDone, sortTasks } from '../lib/tasks';
import type { Stage, Task } from '../types';

type View = 'list' | 'board' | 'plan' | 'graph';

const viewKey = (id: string) => `planer.view.${id}`;

function readView(id: string, sequential: boolean): View {
  try {
    const v = localStorage.getItem(viewKey(id));
    if (v === 'board' || v === 'plan' || v === 'list' || v === 'graph') return v;
  } catch {
    /* tryb prywatny */
  }
  // projekt „po kolei” otwiera się od razu na planie kroków
  return sequential ? 'plan' : 'list';
}

const NO_STAGE = 'stage:none';

/** Lista pogrupowana po etapach – zadanie przeciągnięte na inny etap zmienia etap. */
function StagedList({ stages, open, projectId, onEdit }: { stages: Stage[]; open: Task[]; projectId: string; onEdit: (s: Stage) => void }) {
  const { uid, tasks } = useData();
  const { quickAdd } = useUI();
  const today = useToday();
  const { drag, bind } = useDrag<Task>((t, target) => {
    if (!target.startsWith('stage:')) return;
    const stageId = target === NO_STAGE ? null : target.slice(6);
    if (t.stageId === stageId) return;
    run(updateTask(uid, t.id, { stageId }));
    toast(stageId ? `Etap: ${stages.find((s) => s.id === stageId)?.name}` : 'Bez etapu', 'info', { label: 'Cofnij', run: () => run(restoreTasks(uid, [t])) });
  });
  const known = new Set(stages.map((s) => s.id));
  const sections: { stage: Stage | null; list: Task[] }[] = [
    ...stages.map((s) => ({ stage: s, list: open.filter((t) => t.stageId === s.id) })),
    { stage: null, list: open.filter((t) => !t.stageId || !known.has(t.stageId)) },
  ];
  const row = (t: Task) => <TaskRow key={t.id} task={t} showProject={false} showStage={false} bind={bind(t)} dragging={drag?.item.id === t.id} />;

  return (
    <>
      {sections.map(({ stage, list }) => {
        const all = stage ? tasks.filter((t) => t.stageId === stage.id) : [];
        const doneCount = all.filter(isDone).length;
        const drop = stage ? `stage:${stage.id}` : NO_STAGE;
        if (!stage && list.length === 0 && !drag) return null;
        return (
          <section key={drop} className={`card list-card stage-section ${drag?.over === drop ? 'drop-over' : ''}`} data-drop={drop}>
            <div className="section-head">
              <h2 className="section-title stage-title">
                {stage ? <Icon name="milestone" size={16} /> : null}
                {stage ? stage.name : 'Bez etapu'}
                {stage?.due && <span className={`meta ${stage.due < today && all.some((t) => !isDone(t)) ? 'is-overdue danger-text' : ''}`}>do {fmtDue(stage.due, today)}</span>}
              </h2>
              {stage && all.length > 0 && (
                <span className="muted small">
                  {doneCount}/{all.length}
                </span>
              )}
              <button type="button" className="icon-btn icon-btn-sm" onClick={() => quickAdd({ projectId, stageId: stage?.id ?? null })} aria-label={`Dodaj zadanie${stage ? ` do etapu ${stage.name}` : ''}`} title="Dodaj zadanie">
                <Icon name="plus" size={16} />
              </button>
              {stage && (
                <button type="button" className="icon-btn icon-btn-sm" onClick={() => onEdit(stage)} aria-label={`Edytuj etap ${stage.name}`} title="Edytuj etap">
                  <Icon name="edit" size={16} />
                </button>
              )}
            </div>
            {stage && all.length > 0 && <Progress value={doneCount} max={all.length} />}
            {list.length > 0 ? <ul className="task-list">{list.map(row)}</ul> : <p className="hint stage-empty">{all.length ? 'Wszystko w tym etapie zrobione.' : 'Pusto – dodaj zadanie „+” albo przeciągnij je tutaj.'}</p>}
          </section>
        );
      })}
      {drag && (
        <DragGhost x={drag.x} y={drag.y} touch={drag.touch}>
          <b>{drag.item.title}</b>
          <span className="drag-ghost-to">
            {drag.over === NO_STAGE ? '→ bez etapu' : drag.over?.startsWith('stage:') ? `→ ${stages.find((s) => `stage:${s.id}` === drag.over)?.name}` : 'upuść na etap'}
          </span>
        </DragGhost>
      )}
    </>
  );
}

export function ProjectPage() {
  const { id = '' } = useParams();
  const { projectMap, groupMap, stages, stageMap, tasks, loaded } = useData();
  const { quickAdd } = useUI();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>(() => readView(id, projectMap.get(id)?.sequential ?? false));
  const [editing, setEditing] = useState(false);
  const [stageSheet, setStageSheet] = useState<Stage | 'new' | null>(null);
  const project = projectMap.get(id);

  if (!loaded) return <Spinner />;
  if (!project) {
    return (
      <div className="page">
        <Empty
          title="Nie ma takiego projektu"
          action={
            <button type="button" className="btn btn-primary" onClick={() => nav('/projekty')}>
              Wróć do projektów
            </button>
          }
        >
          Mógł zostać usunięty na innym urządzeniu.
        </Empty>
      </div>
    );
  }

  const projectStages = stages.filter((s) => s.projectId === id);
  const etap = params.get('etap');
  const stage = etap ? stageMap.get(etap) : undefined;
  const activeStage = stage && stage.projectId === id ? stage : undefined;
  const setStage = (sid: string | null) => setParams(sid ? { etap: sid } : {}, { replace: true });

  const mine = tasks.filter((t) => t.projectId === id);
  const scoped = activeStage ? mine.filter((t) => t.stageId === activeStage.id) : mine;
  const open = sortTasks(scoped.filter((t) => !isDone(t)));
  const done = scoped.filter(isDone).sort(compareDone);
  const allOpen = mine.filter((t) => !isDone(t)).length;
  const changeView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(viewKey(id), v);
    } catch {
      /* tryb prywatny */
    }
  };

  return (
    <div className={`page ${view === 'graph' ? 'page-wide' : ''}`}>
      <PageHead
        back={() => nav('/projekty')}
        title={
          <span className="title-with-dot">
            <Dot color={project.color} size={14} />
            {project.name}
          </span>
        }
        subtitle={`${project.groupId && groupMap.get(project.groupId) ? `${groupMap.get(project.groupId)!.name} · ` : ''}${allOpen} ${plural(allOpen, 'otwarte zadanie', 'otwarte zadania', 'otwartych zadań')}${projectStages.length ? ` · ${projectStages.length} ${plural(projectStages.length, 'etap', 'etapy', 'etapów')}` : ''}`}
        actions={
          <button type="button" className="icon-btn" onClick={() => setEditing(true)} aria-label="Edytuj projekt" title="Edytuj projekt">
            <Icon name="edit" />
          </button>
        }
      />

      <div className="stage-bar" role="group" aria-label="Etapy projektu">
        {projectStages.length > 0 && (
          <button type="button" className={`chip ${!activeStage ? 'chip-on' : ''}`} onClick={() => setStage(null)} aria-pressed={!activeStage}>
            Wszystkie etapy
          </button>
        )}
        {projectStages.map((s) => {
          const all = mine.filter((t) => t.stageId === s.id);
          const on = activeStage?.id === s.id;
          return (
            <button key={s.id} type="button" className={`chip stage-chip ${on ? 'chip-on' : ''}`} onClick={() => setStage(on ? null : s.id)} aria-pressed={on}>
              <Icon name="milestone" size={13} />
              {s.name}
              {all.length > 0 && (
                <span className="chip-count">
                  {all.filter(isDone).length}/{all.length}
                </span>
              )}
            </button>
          );
        })}
        {activeStage && (
          <button type="button" className="icon-btn icon-btn-sm" onClick={() => setStageSheet(activeStage)} aria-label={`Edytuj etap ${activeStage.name}`} title="Edytuj etap">
            <Icon name="edit" size={16} />
          </button>
        )}
        <button type="button" className="chip chip-add" onClick={() => setStageSheet('new')} title="Etap – część projektu, np. „Przygotowanie”, „Wykonanie”, „Odbiór”">
          <Icon name="plus" size={13} /> Etap
        </button>
      </div>

      <Segmented<View>
        value={view}
        onChange={changeView}
        ariaLabel="Widok projektu"
        options={[
          {
            value: 'list',
            label: (
              <>
                <Icon name="list" size={16} /> Lista
              </>
            ),
          },
          {
            value: 'board',
            label: (
              <>
                <Icon name="columns" size={16} /> Tablica
              </>
            ),
          },
          {
            value: 'plan',
            label: (
              <>
                <Icon name="steps" size={16} /> Plan
              </>
            ),
          },
          {
            value: 'graph',
            label: (
              <>
                <Icon name="graph" size={16} /> Graf
              </>
            ),
          },
        ]}
      />

      <DuplicatesCard filter={(pair) => pair.a.task.projectId === id || pair.b.task.projectId === id} />

      {view === 'graph' ? (
        <TaskGraph projectId={id} stageId={activeStage?.id ?? null} />
      ) : view === 'plan' ? (
        <ProjectPlan project={project} stageId={activeStage?.id ?? null} />
      ) : view === 'board' ? (
        <>
          <Board tasks={scoped} projectId={id} stageId={activeStage?.id ?? null} />
          <p className="hint center">Przeciągnij kartę do innej kolumny (na telefonie: przytrzymaj i przeciągnij). W „Zrobione” – ostatnie {DONE_DAYS} dni.</p>
        </>
      ) : (
        <>
          {projectStages.length > 0 && !activeStage ? (
            <StagedList stages={projectStages} open={open} projectId={id} onEdit={(s) => setStageSheet(s)} />
          ) : (
            <section className="card list-card">
              <div className="section-head">
                <h2 className="section-title">{activeStage ? activeStage.name : 'Do zrobienia'}</h2>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => quickAdd({ projectId: id, stageId: activeStage?.id ?? null })}>
                  <Icon name="plus" size={16} /> Dodaj
                </button>
              </div>
              {open.length > 0 ? (
                <TaskList tasks={open} showProject={false} showStage={!activeStage} />
              ) : (
                <Empty title="Nic tu jeszcze nie ma">Dodaj pierwsze zadanie przyciskiem „+”. W szybkim dodawaniu możesz od razu wpisać termin, np. „Prezentacja w piątek o 10”.</Empty>
              )}
            </section>
          )}
          <Fold title={`Zrobione (ostatnie ${DONE_DAYS} dni)`} count={done.length}>
            <section className="card list-card">
              <TaskList tasks={done} showProject={false} />
            </section>
          </Fold>
        </>
      )}

      <ProjectSheet project={project} open={editing} onClose={() => setEditing(false)} />
      <StageSheet stage={stageSheet === 'new' ? null : stageSheet} projectId={id} open={stageSheet !== null} onClose={() => setStageSheet(null)} />
    </div>
  );
}
