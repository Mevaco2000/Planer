import { useNavigate, useParams } from 'react-router';
import { TaskEditor } from '../components/TaskEditor';
import { Empty, PageHead, Spinner } from '../components/ui';
import { useData } from '../data';

/** Zadanie jako strona – tu prowadzi kliknięcie w powiadomienie. */
export function TaskPage() {
  const { id = '' } = useParams();
  const { taskMap, loaded } = useData();
  const nav = useNavigate();
  const task = taskMap.get(id);
  if (!loaded) return <Spinner />;
  if (!task) {
    return (
      <div className="page">
        <Empty
          title="Nie znaleziono zadania"
          action={
            <button type="button" className="btn btn-primary" onClick={() => nav('/')}>
              Przejdź do „Dziś”
            </button>
          }
        >
          Mogło zostać usunięte albo zrobione dawno temu.
        </Empty>
      </div>
    );
  }
  return (
    <div className="page">
      <PageHead title="Zadanie" back={() => nav('/')} />
      <section className="card">
        <TaskEditor key={task.id} initial={task} isNew={false} onDone={() => nav('/')} />
      </section>
    </div>
  );
}
