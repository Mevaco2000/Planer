import { useNavigate, useSearchParams } from 'react-router';
import { DuplicatesCard } from '../components/Duplicates';
import { TaskGraph } from '../components/TaskGraph';
import { PageHead, Spinner } from '../components/ui';
import { useData } from '../data';
import { groupProjects } from '../lib/tasks';

/** Graf wszystkich zadań albo jednego projektu (?p=…). */
export function GraphPage() {
  const { projects, groups, projectMap, loaded } = useData();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const p = params.get('p');
  const projectId = p && projectMap.has(p) ? p : undefined;
  if (!loaded) return <Spinner />;

  return (
    <div className="page page-wide">
      <PageHead
        back={() => nav(-1)}
        title="Graf zadań"
        subtitle="Projekty, etapy, zadania i to, co na co wpływa."
        actions={
          <select className="select-sm" value={projectId ?? ''} onChange={(e) => setParams(e.target.value ? { p: e.target.value } : {}, { replace: true })} aria-label="Projekt">
            <option value="">Wszystkie projekty</option>
            {groupProjects(projects, groups).map((s) =>
              s.projects.length === 0 ? null : s.group ? (
                <optgroup key={s.group.id} label={s.group.name}>
                  {s.projects.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </optgroup>
              ) : (
                s.projects.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))
              ),
            )}
          </select>
        }
      />
      <DuplicatesCard filter={projectId ? (pair) => pair.a.task.projectId === projectId || pair.b.task.projectId === projectId : undefined} />
      <TaskGraph key={projectId ?? 'all'} projectId={projectId} />
    </div>
  );
}
