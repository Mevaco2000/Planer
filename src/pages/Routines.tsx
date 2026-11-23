// Rutyny: wszystkie zadania powtarzane w jednym miejscu – co ile, kiedy następny raz, kiedy ostatnio.
import { useNavigate } from 'react-router';
import { skipTask } from '../components/actions';
import { Icon } from '../components/Icon';
import { CheckButton, TaskMeta, useCheck } from '../components/TaskRow';
import { Empty, PageHead, Spinner } from '../components/ui';
import { useUI } from '../components/UIContext';
import { useData } from '../data';
import { useToday } from '../hooks';
import { addDays, diffDays, fmtDue, toISO } from '../lib/dates';
import { newTaskId } from '../lib/db';
import { plural } from '../lib/format';
import { blankTask, isDone, isOverdue, sortTasks } from '../lib/tasks';
import type { Task } from '../types';

/** „dziś”, „wczoraj”, „5 dni temu”, „3 lis” */
function ago(ms: number, today: string): string {
  const d = diffDays(toISO(new Date(ms)), today);
  if (d <= 0) return 'dziś';
  if (d === 1) return 'wczoraj';
  if (d < 14) return `${d} dni temu`;
  return fmtDue(toISO(new Date(ms)), today);
}

/** Pomysły na start – otwierają edytor z wypełnioną regułą. */
const IDEAS: { label: string; patch: Partial<Task> }[] = [
  { label: 'Golenie co 2 dni', patch: { title: 'Golenie', repeat: 'daily', every: 2 } },
  { label: 'Fryzjer co 2 tygodnie od wizyty', patch: { title: 'Fryzjer', repeat: 'weekly', every: 2, repeatFrom: 'done' } },
  { label: 'Trening pon, śr, pt o 18', patch: { title: 'Trening', repeat: 'weekly', repeatDays: [0, 2, 4], time: '18:00', duration: 60 } },
  { label: 'Podlać kwiaty co 3 dni', patch: { title: 'Podlać kwiaty', repeat: 'daily', every: 3 } },
  { label: 'Zmiana pościeli co 2 tygodnie', patch: { title: 'Zmiana pościeli', repeat: 'weekly', every: 2 } },
];

function RoutineRow({ task }: { task: Task }) {
  const { uid } = useData();
  const { openTask } = useUI();
  const today = useToday();
  const { checked, ticking, toggle } = useCheck(task);
  const lateDays = isOverdue(task, today) && task.due ? diffDays(task.due, today) : 0;
  return (
    <li className={`task routine ${ticking ? 'is-ticking' : ''}`}>
      <CheckButton task={task} checked={checked} onCheck={toggle} />
      <button type="button" className="task-main" onClick={() => openTask(task.id)}>
        <span className="task-title">{task.title}</span>
        <TaskMeta task={task} showRepeat />
        <span className="routine-stats">
          {task.lastDone ? `Ostatnio ${ago(task.lastDone, today)}` : 'Jeszcze nie zrobione'}
          {task.doneCount > 0 && ` · ${task.doneCount} ${plural(task.doneCount, 'raz', 'razy', 'razy')}`}
          {lateDays > 0 && (
            <span className="danger-text">
              {' '}
              · spóźnione o {lateDays} {plural(lateDays, 'dzień', 'dni', 'dni')}
            </span>
          )}
        </span>
      </button>
      {task.due && (
        <button type="button" className="icon-btn icon-btn-sm" onClick={() => skipTask(uid, task, today)} aria-label={`Pomiń ten raz: ${task.title}`} title="Pomiń ten raz – przejdź do następnego terminu">
          <Icon name="skip" size={16} />
        </button>
      )}
    </li>
  );
}

function Section({ title, tasks, overdue = false }: { title: string; tasks: Task[]; overdue?: boolean }) {
  if (!tasks.length) return null;
  return (
    <section className="card list-card">
      <h2 className={`section-title section-pad ${overdue ? 'is-overdue' : ''}`}>
        {title} ({tasks.length})
      </h2>
      <ul className="task-list">
        {tasks.map((t) => (
          <RoutineRow key={t.id} task={t} />
        ))}
      </ul>
    </section>
  );
}

export function Routines() {
  const { tasks, uid, loaded } = useData();
  const { openDraft } = useUI();
  const today = useToday();
  const nav = useNavigate();
  if (!loaded) return <Spinner />;

  const all = sortTasks(tasks.filter((t) => t.repeat && !isDone(t)));
  const week = addDays(today, 7);
  const now = all.filter((t) => t.due !== null && t.due <= today);
  const soon = all.filter((t) => t.due !== null && t.due > today && t.due <= week);
  const later = all.filter((t) => t.due === null || t.due > week);

  const create = (patch: Partial<Task> = {}) => openDraft(blankTask(newTaskId(uid), Date.now(), { repeat: 'daily', due: today, ...patch }));

  return (
    <div className="page">
      <PageHead
        back={() => nav('/projekty')}
        title="Rutyny"
        subtitle="Rzeczy, które wracają: co 2 dni, co 2 tygodnie, w wybrane dni tygodnia."
        actions={
          <button type="button" className="btn btn-primary btn-sm" onClick={() => create()}>
            <Icon name="plus" size={16} /> Nowa
          </button>
        }
      />

      {all.length === 0 ? (
        <Empty title="Nie masz jeszcze rutyn" icon={<Icon name="repeat" size={28} />}>
          Rutyna to zadanie, które po odhaczeniu wraca z następnym terminem. Ustawisz, co ile ma się powtarzać i czy liczyć od terminu, czy od dnia, w którym
          faktycznie ją zrobisz. W szybkim dodawaniu wpisz np. „Golenie co 2 dni rano”.
        </Empty>
      ) : (
        <>
          <Section title="Na dziś i zaległe" tasks={now} overdue={now.some((t) => isOverdue(t, today))} />
          <Section title="W tym tygodniu" tasks={soon} />
          <Section title="Później" tasks={later} />
        </>
      )}

      <section className="card">
        <h2 className="card-title">
          <Icon name="repeat" size={18} /> Pomysły
        </h2>
        <div className="chips-wrap">
          {IDEAS.map((i) => (
            <button key={i.label} type="button" className="chip" onClick={() => create(i.patch)}>
              <Icon name="plus" size={14} /> {i.label}
            </button>
          ))}
        </div>
        <p className="hint">
          „Od zrobienia” – następny termin liczony od dnia odhaczenia (fryzjer 2 tygodnie po ostatniej wizycie). „Od terminu” – stały rytm, np. co drugi poniedziałek.
          Przycisk <Icon name="skip" size={12} /> pomija jeden raz bez liczenia go jako zrobiony.
        </p>
      </section>
    </div>
  );
}
