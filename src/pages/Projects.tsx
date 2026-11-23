import { useState } from 'react';
import { Link } from 'react-router';
import { GroupSheet } from '../components/GroupSheet';
import { Icon } from '../components/Icon';
import { ProjectSheet } from '../components/ProjectSheet';
import { Dot, Empty, PageHead, Progress, Spinner } from '../components/ui';
import { DONE_DAYS, useData } from '../data';
import { useToday } from '../hooks';
import { plural } from '../lib/format';
import { groupProjects, isDone, isOverdue } from '../lib/tasks';
import type { Group, Project, Task } from '../types';

const COLLAPSED_KEY = 'planer.groups.collapsed';

function readCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function ProjectCard({ project: p, tasks, today }: { project: Project; tasks: Task[]; today: string }) {
  const mine = tasks.filter((t) => t.projectId === p.id);
  const open = mine.filter((t) => !isDone(t));
  const done = mine.length - open.length;
  const doing = open.filter((t) => t.status === 'doing').length;
  const overdue = open.filter((t) => isOverdue(t, today)).length;
  return (
    <li>
      <Link to={`/projekty/${p.id}`} className="card card-link project-card">
        <span className="project-icon" style={{ background: `color-mix(in srgb, ${p.color} 16%, transparent)`, color: p.color }}>
          {p.sequential ? <Icon name="steps" size={18} /> : <Dot color={p.color} size={12} />}
        </span>
        <span className="grow">
          <b>{p.name}</b>
          <span className="muted small block">
            {open.length} {plural(open.length, 'otwarte', 'otwarte', 'otwartych')}
            {doing > 0 && ` · ${doing} w trakcie`}
            {overdue > 0 && <span className="danger-text"> · {overdue} zaległe</span>}
            {done > 0 && ` · ${done} zrobione w ${DONE_DAYS} dni`}
          </span>
          {mine.length > 0 && <Progress value={done} max={mine.length} />}
        </span>
        <Icon name="right" size={18} className="muted" />
      </Link>
    </li>
  );
}

export function Projects() {
  const { projects, groups, tasks, loaded } = useData();
  const today = useToday();
  const [creating, setCreating] = useState<{ groupId: string | null } | null>(null);
  const [editingGroup, setEditingGroup] = useState<Group | 'new' | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed);
  if (!loaded) return <Spinner />;

  const open = tasks.filter((t) => !isDone(t));
  const inbox = open.filter((t) => t.projectId === null).length;
  const routines = open.filter((t) => t.repeat);
  const routinesToday = routines.filter((t) => t.due !== null && t.due <= today).length;
  const sections = groupProjects(projects, groups).filter((s) => s.group || s.projects.length);

  const toggle = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
    } catch {
      /* tryb prywatny */
    }
  };

  return (
    <div className="page">
      <PageHead
        title="Projekty"
        actions={
          <>
            <Link to="/graf" className="btn btn-ghost btn-sm" title="Graf zadań – co na co wpływa">
              <Icon name="graph" size={16} /> Graf
            </Link>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingGroup('new')} title="Nowa grupa projektów">
              <Icon name="layers" size={16} /> Grupa
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating({ groupId: null })}>
              <Icon name="plus" size={16} /> Projekt
            </button>
          </>
        }
      />

      <ul className="cards">
        <li>
          <Link to="/skrzynka" className="card card-link project-card">
            <span className="project-icon">
              <Icon name="inbox" size={18} />
            </span>
            <span className="grow">
              <b>Skrzynka</b>
              <span className="muted small block">
                {inbox} {plural(inbox, 'zadanie', 'zadania', 'zadań')} bez projektu
              </span>
            </span>
            <Icon name="right" size={18} className="muted" />
          </Link>
        </li>
        <li>
          <Link to="/rutyny" className="card card-link project-card">
            <span className="project-icon">
              <Icon name="repeat" size={18} />
            </span>
            <span className="grow">
              <b>Rutyny</b>
              <span className="muted small block">
                {routines.length ? `${routines.length} ${plural(routines.length, 'rutyna', 'rutyny', 'rutyn')}` : 'Golenie co 2 dni, fryzjer co 2 tygodnie…'}
                {routinesToday > 0 && ` · ${routinesToday} na dziś`}
              </span>
            </span>
            <Icon name="right" size={18} className="muted" />
          </Link>
        </li>
      </ul>

      {sections.map(({ group, projects: list }) => {
        if (!group) {
          return (
            <section key="none" className="project-group">
              {groups.length > 0 && (
                <header className="group-head">
                  <span className="group-name muted">Bez grupy</span>
                </header>
              )}
              <ul className="cards">
                {list.map((p) => (
                  <ProjectCard key={p.id} project={p} tasks={tasks} today={today} />
                ))}
              </ul>
            </section>
          );
        }
        const isOpen = !collapsed.has(group.id);
        const openCount = open.filter((t) => list.some((p) => p.id === t.projectId)).length;
        return (
          <section key={group.id} className="project-group">
            <header className="group-head">
              <button type="button" className="group-toggle" onClick={() => toggle(group.id)} aria-expanded={isOpen}>
                <Icon name="down" size={16} className={`fold-chevron ${isOpen ? 'is-open' : ''}`} />
                <span className="group-name">{group.name}</span>
                <span className="muted small">
                  {list.length} {plural(list.length, 'projekt', 'projekty', 'projektów')} · {openCount} {plural(openCount, 'otwarte', 'otwarte', 'otwartych')}
                </span>
              </button>
              <button type="button" className="icon-btn icon-btn-sm" onClick={() => setCreating({ groupId: group.id })} aria-label={`Nowy projekt w grupie ${group.name}`} title="Nowy projekt w tej grupie">
                <Icon name="plus" size={16} />
              </button>
              <button type="button" className="icon-btn icon-btn-sm" onClick={() => setEditingGroup(group)} aria-label={`Edytuj grupę ${group.name}`} title="Edytuj grupę">
                <Icon name="edit" size={16} />
              </button>
            </header>
            {isOpen &&
              (list.length ? (
                <ul className="cards">
                  {list.map((p) => (
                    <ProjectCard key={p.id} project={p} tasks={tasks} today={today} />
                  ))}
                </ul>
              ) : (
                <p className="hint group-empty">Pusta grupa – dodaj projekt przyciskiem „+” albo przypisz istniejący w edycji grupy.</p>
              ))}
          </section>
        );
      })}

      {projects.length === 0 && (
        <Empty
          title="Nie masz jeszcze projektów"
          icon={<Icon name="folder" size={28} />}
          action={
            <button type="button" className="btn btn-primary" onClick={() => setCreating({ groupId: null })}>
              <Icon name="plus" size={18} /> Utwórz pierwszy projekt
            </button>
          }
        >
          Projekt grupuje zadania – np. Praca, Dom, Studia. Każdy ma listę, tablicę i plan kroków po kolei. Projekty możesz łączyć w grupy.
        </Empty>
      )}

      <ProjectSheet project={null} open={creating !== null} groupId={creating?.groupId ?? null} onClose={() => setCreating(null)} />
      <GroupSheet group={editingGroup === 'new' ? null : editingGroup} open={editingGroup !== null} onClose={() => setEditingGroup(null)} />
    </div>
  );
}
