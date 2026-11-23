import { useState } from 'react';
import { Icon } from '../components/Icon';
import { TaskList } from '../components/TaskRow';
import { Empty, PageHead } from '../components/ui';
import { DONE_DAYS, useData } from '../data';
import { matches, plural } from '../lib/format';
import { compareDone, isDone, sortTasks } from '../lib/tasks';

export function Search() {
  const { tasks, projectMap, stageMap } = useData();
  const [q, setQ] = useState('');
  const query = q.trim();
  const found = query
    ? tasks.filter((t) =>
        matches(
          query,
          [t.title, t.notes, ...t.subtasks.map((s) => s.title), t.projectId ? (projectMap.get(t.projectId)?.name ?? '') : 'skrzynka', t.stageId ? (stageMap.get(t.stageId)?.name ?? '') : ''].join(' '),
        ),
      )
    : [];
  const open = sortTasks(found.filter((t) => !isDone(t)));
  const done = found.filter(isDone).sort(compareDone);

  return (
    <div className="page">
      <PageHead title="Szukaj" />
      <label className="search-box">
        <Icon name="search" size={18} />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nazwa, notatka, podzadanie, projekt…" aria-label="Szukaj zadań" autoFocus />
      </label>
      {!query ? (
        <p className="hint">Szukam w nazwach, notatkach, podzadaniach i nazwach projektów – wśród otwartych zadań i zrobionych w ostatnich {DONE_DAYS} dniach.</p>
      ) : found.length === 0 ? (
        <Empty title="Nic nie znalazłem">Spróbuj innego słowa – wielkość liter i polskie znaki nie mają znaczenia.</Empty>
      ) : (
        <>
          <p className="muted small">
            {found.length} {plural(found.length, 'zadanie', 'zadania', 'zadań')}
          </p>
          {open.length > 0 && (
            <section className="card list-card">
              <TaskList tasks={open} />
            </section>
          )}
          {done.length > 0 && (
            <section className="card list-card">
              <h2 className="section-title section-pad">Zrobione</h2>
              <TaskList tasks={done} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
