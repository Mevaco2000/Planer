import { setDue } from '../components/actions';
import { Icon } from '../components/Icon';
import { TaskRow } from '../components/TaskRow';
import { Fold, PageHead, Spinner } from '../components/ui';
import { useUI } from '../components/UIContext';
import { DragGhost, useDrag } from '../components/useDrag';
import { useData } from '../data';
import { useToday } from '../hooks';
import { addDays, dateRange, fmtDue, fromISO, weekdayIndex } from '../lib/dates';
import { isDone, isOverdue, sortTasks } from '../lib/tasks';
import type { Task } from '../types';

const DAYS = 14;

function dayLabel(date: string, today: string): { main: string; sub: string } {
  const d = fromISO(date);
  const long = d.toLocaleDateString('pl-PL', { weekday: 'long' });
  const dm = d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' });
  if (date === today) return { main: 'Dziś', sub: `${long}, ${dm}` };
  if (date === addDays(today, 1)) return { main: 'Jutro', sub: `${long}, ${dm}` };
  return { main: long[0].toUpperCase() + long.slice(1), sub: dm };
}

/** Najbliższe 2 tygodnie dzień po dniu (`embedded` – jako widok „Lista” w Kalendarzu, bez nagłówka strony). */
export function Upcoming({ embedded = false }: { embedded?: boolean }) {
  const { tasks, uid, loaded } = useData();
  const { quickAdd } = useUI();
  const today = useToday();
  const { drag, bind } = useDrag<Task>((t, target) => setDue(uid, t, target, today));
  if (!loaded) return <Spinner />;

  const last = addDays(today, DAYS - 1);
  const open = tasks.filter((t) => !isDone(t) && t.due !== null);
  const overdue = sortTasks(open.filter((t) => isOverdue(t, today)));
  const later = sortTasks(open.filter((t) => t.due! > last));
  const byDate = new Map<string, Task[]>();
  for (const t of sortTasks(open)) byDate.set(t.due!, [...(byDate.get(t.due!) ?? []), t]);

  const row = (t: Task, showDue = false) => <TaskRow key={t.id} task={t} showDue={showDue} bind={bind(t)} dragging={drag?.item.id === t.id} />;

  return (
    <div className="page">
      {embedded ? (
        <p className="hint">Najbliższe 2 tygodnie – przeciągnij zadanie na inny dzień, żeby je przełożyć.</p>
      ) : (
        <PageHead title="Nadchodzące" subtitle="Najbliższe 2 tygodnie – przeciągnij zadanie na inny dzień, żeby je przełożyć." />
      )}

      {overdue.length > 0 && (
        <Fold title="Zaległe" count={overdue.length} defaultOpen>
          <section className="card list-card">
            <ul className="task-list">{overdue.map((t) => row(t, true))}</ul>
          </section>
        </Fold>
      )}

      <div className="days">
        {dateRange(today, last).map((date) => {
          const list = byDate.get(date) ?? [];
          const { main, sub } = dayLabel(date, today);
          return (
            <section
              key={date}
              className={`day-group ${weekdayIndex(date) > 4 ? 'is-weekend' : ''} ${date === today ? 'is-today' : ''} ${drag?.over === date ? 'drop-over' : ''}`}
              data-drop={date}
            >
              <header className="day-group-head">
                <b>{main}</b>
                <span className="muted small">{sub}</span>
                <span className="spacer" />
                <button type="button" className="icon-btn icon-btn-sm" onClick={() => quickAdd({ due: date })} aria-label={`Dodaj zadanie: ${main} ${sub}`}>
                  <Icon name="plus" size={18} />
                </button>
              </header>
              {list.length > 0 ? <ul className="task-list">{list.map((t) => row(t))}</ul> : <p className="day-empty">Wolne</p>}
            </section>
          );
        })}
      </div>

      <Fold title="Później" count={later.length}>
        <section className="card list-card">
          <ul className="task-list">{later.map((t) => row(t, true))}</ul>
        </section>
      </Fold>

      {drag && (
        <DragGhost x={drag.x} y={drag.y} touch={drag.touch}>
          <b>{drag.item.title}</b>
          <span className="drag-ghost-to">{drag.over ? `→ ${fmtDue(drag.over, today)}` : 'upuść na dzień'}</span>
        </DragGhost>
      )}
    </div>
  );
}
