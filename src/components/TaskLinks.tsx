// Powiązania w edytorze zadania: „wpływa na” (większe zadania) i mniejsze zadania, które wpływają na to zadanie.
import { useState } from 'react';
import { useData } from '../data';
import { matches } from '../lib/format';
import { isDone, sortTasks } from '../lib/tasks';
import type { Task } from '../types';
import { RefWhere } from './Duplicates';
import { Icon } from './Icon';
import { CheckButton, useCheck } from './TaskRow';

/** Wyszukiwarka otwartych zadań do powiązania. */
export function TaskPicker({ allow, onPick, placeholder, autoFocus = false }: { allow: (t: Task) => boolean; onPick: (t: Task) => void; placeholder: string; autoFocus?: boolean }) {
  const { tasks } = useData();
  const [q, setQ] = useState('');
  const query = q.trim();
  const found = query.length >= 2 ? sortTasks(tasks.filter((t) => !isDone(t) && allow(t) && matches(query, t.title))).slice(0, 6) : [];
  return (
    <div className="picker">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} autoFocus={autoFocus} />
      {query.length >= 2 && (
        <ul className="picker-list">
          {found.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(t);
                  setQ('');
                }}
              >
                <b>{t.title}</b>
                <RefWhere r={{ kind: 'task', task: t }} />
              </button>
            </li>
          ))}
          {found.length === 0 && <li className="hint picker-empty">Nie ma takiego otwartego zadania.</li>}
        </ul>
      )}
    </div>
  );
}

/** Mniejsze zadanie powiązane z edytowanym – odhaczasz od razu (to osobne zadanie). */
function ChildRow({ task, onUnlink, pending }: { task: Task; onUnlink: () => void; pending: boolean }) {
  const { checked, toggle } = useCheck(task);
  return (
    <li className={`child-row ${isDone(task) ? 'is-done' : ''}`}>
      <CheckButton task={task} checked={checked} onCheck={toggle} />
      <span className="grow">
        <span className="child-title">{task.title}</span>
        <span className="hint block">
          {pending ? 'powiąże się po zapisaniu' : task.parentIds.length > 1 ? `wpływa też na ${task.parentIds.length - 1} inne` : 'osobne zadanie'}
        </span>
      </span>
      <button type="button" className="icon-btn" onClick={onUnlink} aria-label={`Odłącz: ${task.title}`} title="Odłącz (zadanie zostaje, tylko bez powiązania)">
        <Icon name="x" size={16} />
      </button>
    </li>
  );
}

export function ChildrenList({ items, onUnlink, pendingIds, promoted }: { items: Task[]; onUnlink: (t: Task) => void; pendingIds: string[]; promoted: { key: string; title: string; onUndo: () => void }[] }) {
  if (!items.length && !promoted.length) return null;
  return (
    <ul className="children">
      {items.map((c) => (
        <ChildRow key={c.id} task={c} pending={pendingIds.includes(c.id)} onUnlink={() => onUnlink(c)} />
      ))}
      {promoted.map((p) => (
        <li key={p.key} className="child-row">
          <span className="child-link-icon">
            <Icon name="link" size={14} />
          </span>
          <span className="grow">
            <span className="child-title">{p.title}</span>
            <span className="hint block">po zapisaniu – jedno zadanie wpływające na oba większe</span>
          </span>
          <button type="button" className="icon-btn" onClick={p.onUndo} aria-label={`Cofnij: ${p.title}`}>
            <Icon name="x" size={16} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** „Wpływa na” – większe zadania, do których to zadanie się przyczynia. */
export function ParentsField({ t, allow, onAdd, onRemove }: { t: Task; allow: (c: Task) => boolean; onAdd: (p: Task) => void; onRemove: (id: string) => void }) {
  const { taskMap } = useData();
  const [open, setOpen] = useState(false);
  return (
    <div className="field">
      <span>
        <Icon name="link" size={14} /> Wpływa na
      </span>
      {t.parentIds.length > 0 && (
        <div className="chips-wrap">
          {t.parentIds.map((id) => (
            <span key={id} className="chip chip-token chip-parent">
              <Icon name="link" size={13} />
              {taskMap.get(id)?.title ?? 'zadanie (zrobione dawno)'}
              <button type="button" className="chip-x" onClick={() => onRemove(id)} aria-label={`Odłącz od: ${taskMap.get(id)?.title ?? id}`}>
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {open ? (
        <TaskPicker
          autoFocus
          allow={allow}
          placeholder="Szukaj większego zadania…"
          onPick={(p) => {
            onAdd(p);
            setOpen(false);
          }}
        />
      ) : (
        <button type="button" className="btn btn-ghost btn-sm link-add" onClick={() => setOpen(true)}>
          <Icon name="plus" size={16} /> {t.parentIds.length ? 'Jeszcze jedno większe zadanie' : 'Powiąż z większym zadaniem'}
        </button>
      )}
      {t.parentIds.length === 0 && !open && <span className="hint">Np. „Kupić kabel HDMI” wpływa i na „Podłączyć TV”, i na „Prezentację” – odhaczasz raz, postęp widać w obu.</span>}
    </div>
  );
}
