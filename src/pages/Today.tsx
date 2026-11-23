import { Link } from 'react-router';
import { setDueMany } from '../components/actions';
import { DuplicatesCard } from '../components/Duplicates';
import { Icon } from '../components/Icon';
import { TaskList } from '../components/TaskRow';
import { Empty, Fold, PageHead, Progress, Spinner } from '../components/ui';
import { useUI } from '../components/UIContext';
import { useData } from '../data';
import { useToday } from '../hooks';
import { fmtLong, fromISO } from '../lib/dates';
import { plural } from '../lib/format';
import { compareDone, isDone, isOverdue, sortTasks } from '../lib/tasks';

export function Today() {
  const { tasks, uid, loaded } = useData();
  const { quickAdd } = useUI();
  const today = useToday();
  if (!loaded) return <Spinner />;

  const open = tasks.filter((t) => !isDone(t));
  const overdue = sortTasks(open.filter((t) => isOverdue(t, today)));
  const todays = sortTasks(open.filter((t) => t.due === today));
  const dayStart = fromISO(today).getTime();
  const doneToday = tasks.filter((t) => t.completedAt !== null && t.completedAt >= dayStart).sort(compareDone);
  const total = overdue.length + todays.length + doneToday.length;

  return (
    <div className="page">
      <PageHead
        title="Dziś"
        subtitle={<span className="capitalize">{fmtLong(today)}</span>}
        actions={
          <Link to="/plan" className="btn btn-ghost btn-sm" title="Rozplanuj dzień na godziny">
            <Icon name="timeline" size={16} /> Plan dnia
          </Link>
        }
      />

      {total > 0 && (
        <section className="card today-progress">
          <div className="row">
            <span className="grow">
              <b>
                {doneToday.length} z {total}
              </b>{' '}
              <span className="muted">{plural(total, 'zadania', 'zadań', 'zadań')} zrobione</span>
            </span>
            {overdue.length + todays.length === 0 && <span className="ok-text small">Wszystko na dziś zrobione</span>}
          </div>
          <Progress value={doneToday.length} max={total} />
        </section>
      )}

      <DuplicatesCard />

      {overdue.length > 0 && (
        <section className="card list-card">
          <div className="section-head">
            <h2 className="section-title is-overdue">Zaległe ({overdue.length})</h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDueMany(uid, overdue, today, today)}>
              Przełóż na dziś
            </button>
          </div>
          <TaskList tasks={overdue} />
        </section>
      )}

      <section className="card list-card">
        <div className="section-head">
          <h2 className="section-title">Na dziś</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => quickAdd({ due: today })}>
            <Icon name="plus" size={16} /> Dodaj
          </button>
        </div>
        {todays.length > 0 ? (
          <TaskList tasks={todays} showDue={false} />
        ) : (
          <Empty title={doneToday.length ? 'Na dziś wszystko zrobione' : 'Na dziś nic nie ma'} icon={<Icon name="sun" size={28} />}>
            {doneToday.length
              ? 'Dobra robota. Zajrzyj do Nadchodzących albo odpocznij.'
              : 'Dodaj zadanie przyciskiem „+” (albo klawiszem N) – np. „Zadzwonić do mamy o 18”.'}
          </Empty>
        )}
      </section>

      <Fold title="Zrobione dziś" count={doneToday.length}>
        <section className="card list-card">
          <TaskList tasks={doneToday} />
        </section>
      </Fold>
    </div>
  );
}
