import { DuplicatesCard } from '../components/Duplicates';
import { Icon } from '../components/Icon';
import { TaskList } from '../components/TaskRow';
import { Empty, PageHead, Spinner } from '../components/ui';
import { useUI } from '../components/UIContext';
import { useData } from '../data';
import { isDone, sortTasks } from '../lib/tasks';

/**
 * Skrzynka – tylko otwarte zadania bez projektu. Zadanie odhaczone gdziekolwiek (Dziś, Plan, Kalendarz, tutaj)
 * od razu stąd znika; cofnąć można z komunikatu, a zrobione widać w „Dziś” i w wyszukiwaniu.
 */
export function Inbox() {
  const { tasks, loaded } = useData();
  const { quickAdd } = useUI();
  if (!loaded) return <Spinner />;
  const open = sortTasks(tasks.filter((t) => t.projectId === null && !isDone(t)));

  return (
    <div className="page">
      <PageHead title="Skrzynka" subtitle="Zadania bez projektu – szybkie notatki, sprawy do rozdzielenia." />
      <DuplicatesCard filter={(p) => p.a.task.projectId === null || p.b.task.projectId === null} />
      <section className="card list-card">
        <div className="section-head">
          <h2 className="section-title">Do zrobienia</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => quickAdd({})}>
            <Icon name="plus" size={16} /> Dodaj
          </button>
        </div>
        {open.length > 0 ? (
          <TaskList tasks={open} showProject={false} />
        ) : (
          <Empty title="Skrzynka jest pusta" icon={<Icon name="inbox" size={28} />}>
            Wszystko, co dodasz bez projektu, trafi tutaj. Projekt przypiszesz później w edycji zadania albo od razu, wpisując „#nazwa”.
          </Empty>
        )}
      </section>
    </div>
  );
}
