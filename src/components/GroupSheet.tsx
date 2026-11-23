import { useState } from 'react';
import { useData } from '../data';
import { deleteGroup, newGroupId, saveGroup } from '../lib/db';
import type { Group } from '../types';
import { Icon } from './Icon';
import { confirmAction, Sheet } from './Sheet';
import { run } from './Toast';
import { Dot } from './ui';

/** Nowa grupa projektów albo edycja: nazwa i które projekty do niej należą. */
export function GroupSheet({ group, open, onClose }: { group: Group | null; open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={group ? 'Edytuj grupę' : 'Nowa grupa projektów'}>
      {open && <GroupForm key={group?.id ?? 'new'} group={group} onDone={onClose} />}
    </Sheet>
  );
}

function GroupForm({ group, onDone }: { group: Group | null; onDone: () => void }) {
  const { uid, groups, groupMap, projects } = useData();
  const [name, setName] = useState(group?.name ?? '');
  const [members, setMembers] = useState<Set<string>>(() => new Set(group ? projects.filter((p) => p.groupId === group.id).map((p) => p.id) : []));

  const toggle = (id: string) =>
    setMembers((m) => {
      const next = new Set(m);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = () => {
    const n = name.trim();
    if (!n) return;
    const g: Group = group ? { ...group, name: n } : { id: newGroupId(uid), name: n, order: Math.max(0, ...groups.map((x) => x.order)) + 1, createdAt: Date.now() };
    run(saveGroup(uid, g, projects, members));
    onDone();
  };

  const remove = () => {
    if (!group || !confirmAction(`Usunąć grupę „${group.name}”? Projekty zostaną – tylko bez grupy.`)) return;
    run(deleteGroup(uid, group.id, projects));
    onDone();
  };

  return (
    <div className="form">
      <label className="field">
        <span>Nazwa grupy</span>
        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} placeholder="np. Studia, Dom, Firma" autoFocus maxLength={100} />
      </label>

      <div className="field">
        <span>Projekty w grupie</span>
        {projects.length === 0 ? (
          <p className="hint">Nie masz jeszcze projektów – przypiszesz je do grupy przy tworzeniu projektu.</p>
        ) : (
          <ul className="check-list">
            {projects.map((p) => {
              const other = p.groupId && p.groupId !== group?.id ? groupMap.get(p.groupId) : undefined;
              return (
                <li key={p.id}>
                  <label>
                    <input type="checkbox" checked={members.has(p.id)} onChange={() => toggle(p.id)} />
                    <Dot color={p.color} size={10} />
                    <span className="grow">{p.name}</span>
                    {other && !members.has(p.id) && <span className="muted small">w: {other.name}</span>}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <p className="hint">Projekt należy do jednej grupy – zaznaczenie przeniesie go z poprzedniej.</p>
      </div>

      <div className="form-actions">
        {group && (
          <button type="button" className="btn btn-danger-ghost" onClick={remove}>
            <Icon name="trash" size={18} /> Usuń grupę
          </button>
        )}
        <span className="spacer" />
        <button type="button" className="btn btn-primary" disabled={!name.trim()} onClick={save}>
          {group ? 'Zapisz' : 'Utwórz grupę'}
        </button>
      </div>
    </div>
  );
}
