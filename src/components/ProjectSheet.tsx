import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useData } from '../data';
import { deleteProject, newProjectId, saveProject } from '../lib/db';
import { plural } from '../lib/format';
import { PROJECT_COLORS } from '../lib/tasks';
import type { Project } from '../types';
import { Icon } from './Icon';
import { confirmAction, Sheet } from './Sheet';
import { errorMessage, run, toast } from './Toast';

/** Nowy projekt albo edycja (nazwa, kolor, grupa, kolejność kroków, usunięcie). */
export function ProjectSheet({ project, open, onClose, groupId = null }: { project: Project | null; open: boolean; onClose: () => void; groupId?: string | null }) {
  return (
    <Sheet open={open} onClose={onClose} title={project ? 'Edytuj projekt' : 'Nowy projekt'}>
      {open && <ProjectForm key={project?.id ?? 'new'} project={project} defaultGroup={groupId} onDone={onClose} />}
    </Sheet>
  );
}

function ProjectForm({ project, defaultGroup, onDone }: { project: Project | null; defaultGroup: string | null; onDone: () => void }) {
  const { uid, projects, groups, tasks } = useData();
  const nav = useNavigate();
  const [name, setName] = useState(project?.name ?? '');
  const [color, setColor] = useState(project?.color ?? PROJECT_COLORS[projects.length % PROJECT_COLORS.length]);
  const [groupId, setGroupId] = useState<string | null>(project ? project.groupId : defaultGroup);
  const [sequential, setSequential] = useState(project?.sequential ?? false);
  const [busy, setBusy] = useState(false);
  const openCount = project ? tasks.filter((t) => t.projectId === project.id && t.completedAt === null).length : 0;

  const save = () => {
    const n = name.trim();
    if (!n) return;
    const p: Project = project
      ? { ...project, name: n, color, groupId, sequential }
      : { id: newProjectId(uid), name: n, color, order: Math.max(0, ...projects.map((x) => x.order)) + 1, createdAt: Date.now(), groupId, sequential };
    run(saveProject(uid, p));
    onDone();
    if (!project) nav(`/projekty/${p.id}`);
  };

  const remove = async (mode: 'inbox' | 'delete') => {
    if (!project) return;
    const what = mode === 'inbox' ? 'Zadania trafią do Skrzynki.' : 'Usunięte zostaną też wszystkie jego zadania (także zrobione).';
    if (!confirmAction(`Usunąć projekt „${project.name}”? ${what}`)) return;
    setBusy(true);
    try {
      const n = await deleteProject(uid, project.id, mode);
      toast(mode === 'inbox' && n ? `Usunięto projekt – ${n} ${plural(n, 'zadanie', 'zadania', 'zadań')} w Skrzynce` : 'Usunięto projekt');
      onDone();
      nav('/projekty', { replace: true });
    } catch (e) {
      toast(errorMessage(e), 'error');
      setBusy(false);
    }
  };

  return (
    <div className="form">
      <label className="field">
        <span>Nazwa</span>
        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} placeholder="np. Praca, Dom, Studia" autoFocus maxLength={100} />
      </label>
      <div className="field">
        <span>Kolor</span>
        <div className="colors" role="radiogroup" aria-label="Kolor projektu">
          {PROJECT_COLORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={c === color} aria-label={c} className={`color-btn ${c === color ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)}>
              {c === color && <Icon name="check" size={16} />}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span>
          <Icon name="layers" size={14} /> Grupa
        </span>
        <select value={groupId ?? ''} onChange={(e) => setGroupId(e.target.value || null)}>
          <option value="">Bez grupy</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        {groups.length === 0 && <span className="hint">Grupy utworzysz na ekranie Projekty („+ Grupa”).</span>}
      </label>
      <label className="switch-row">
        <input type="checkbox" checked={sequential} onChange={(e) => setSequential(e.target.checked)} />
        <span className="grow">
          <b>Zadania po kolei</b>
          <span className="hint block">Następny krok odblokowuje się dopiero po zrobieniu poprzedniego. Kolejność ustawisz w widoku „Plan”.</span>
        </span>
      </label>
      {name.trim() && <p className="hint">W szybkim dodawaniu wpisz „#{name.trim().split(/\s+/)[0].toLowerCase()}”, żeby dodać zadanie do tego projektu.</p>}
      <div className="form-actions">
        <span className="spacer" />
        <button type="button" className="btn btn-primary" disabled={!name.trim()} onClick={save}>
          {project ? 'Zapisz' : 'Utwórz projekt'}
        </button>
      </div>
      {project && (
        <div className="danger-zone">
          <p className="hint">
            Projekt ma {openCount} {plural(openCount, 'otwarte zadanie', 'otwarte zadania', 'otwartych zadań')}.
          </p>
          <div className="actions-row">
            <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void remove('inbox')}>
              <Icon name="inbox" size={16} /> Usuń projekt, zadania do Skrzynki
            </button>
            <button type="button" className="btn btn-sm btn-danger-ghost" disabled={busy} onClick={() => void remove('delete')}>
              <Icon name="trash" size={16} /> Usuń razem z zadaniami
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
