// Etap projektu – poziom między projektem a zadaniem: nowy albo edycja (nazwa, termin, kolejność, usunięcie).
import { useState } from 'react';
import { useData } from '../data';
import { deleteStage, newStageId, saveStage, setStageOrders } from '../lib/db';
import { plural } from '../lib/format';
import type { Stage } from '../types';
import { Icon } from './Icon';
import { confirmAction, Sheet } from './Sheet';
import { errorMessage, run, toast } from './Toast';

export function StageSheet({ stage, projectId, open, onClose, onCreated }: { stage: Stage | null; projectId: string; open: boolean; onClose: () => void; onCreated?: (s: Stage) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={stage ? 'Edytuj etap' : 'Nowy etap'}>
      {open && <StageForm key={stage?.id ?? 'new'} stage={stage} projectId={projectId} onDone={onClose} onCreated={onCreated} />}
    </Sheet>
  );
}

function StageForm({ stage, projectId, onDone, onCreated }: { stage: Stage | null; projectId: string; onDone: () => void; onCreated?: (s: Stage) => void }) {
  const { uid, stages, tasks } = useData();
  const [name, setName] = useState(stage?.name ?? '');
  const [due, setDue] = useState(stage?.due ?? '');
  const [busy, setBusy] = useState(false);
  const siblings = stages.filter((s) => s.projectId === projectId);
  const index = stage ? siblings.findIndex((s) => s.id === stage.id) : -1;
  const openCount = stage ? tasks.filter((t) => t.stageId === stage.id && t.completedAt === null).length : 0;

  const save = () => {
    const n = name.trim();
    if (!n) return;
    const s: Stage = stage
      ? { ...stage, name: n.slice(0, 100), due: due || null }
      : { id: newStageId(uid), projectId, name: n.slice(0, 100), due: due || null, order: Math.max(0, ...siblings.map((x) => x.order)) + 1, createdAt: Date.now() };
    run(saveStage(uid, s));
    if (!stage) onCreated?.(s);
    onDone();
  };

  /** Zamiana miejscami z sąsiednim etapem. */
  const move = (dir: -1 | 1) => {
    const other = siblings[index + dir];
    if (!stage || !other) return;
    // równe kolejności (np. etapy dodane w tej samej chwili) – najpierw numeracja od nowa
    const orders = siblings.map((s, i) => ({ id: s.id, order: i + 1 }));
    orders[index].order = index + 1 + dir;
    orders[index + dir].order = index + 1;
    run(setStageOrders(uid, orders));
  };

  const remove = async () => {
    if (!stage || !confirmAction(`Usunąć etap „${stage.name}”? Zadania zostaną w projekcie, tylko bez etapu.`)) return;
    setBusy(true);
    try {
      const n = await deleteStage(uid, stage.id);
      toast(n ? `Usunięto etap – ${n} ${plural(n, 'zadanie', 'zadania', 'zadań')} bez etapu` : 'Usunięto etap');
      onDone();
    } catch (e) {
      toast(errorMessage(e), 'error');
      setBusy(false);
    }
  };

  return (
    <div className="form">
      <label className="field">
        <span>Nazwa etapu</span>
        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} placeholder="np. Przygotowanie, Wykonanie, Odbiór" autoFocus maxLength={100} />
      </label>
      <label className="field">
        <span>
          <Icon name="calendar" size={14} /> Termin etapu (opcjonalnie)
        </span>
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </label>
      <p className="hint">Etap to poziom między projektem a zadaniem – grupuje zadania jednej części projektu. Zadanie przypiszesz do etapu w jego edycji albo przeciągając je na etap w liście.</p>
      {stage && siblings.length > 1 && (
        <div className="actions-row">
          <span className="muted small grow">
            Kolejność: {index + 1} z {siblings.length}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={index <= 0} onClick={() => move(-1)}>
            <Icon name="up" size={16} /> Wcześniej
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={index >= siblings.length - 1} onClick={() => move(1)}>
            <Icon name="down" size={16} /> Później
          </button>
        </div>
      )}
      <div className="form-actions">
        {stage && (
          <button type="button" className="btn btn-danger-ghost" disabled={busy} onClick={() => void remove()}>
            <Icon name="trash" size={18} /> Usuń etap
          </button>
        )}
        <span className="spacer" />
        <button type="button" className="btn btn-primary" disabled={!name.trim()} onClick={save}>
          {stage ? 'Zapisz' : 'Dodaj etap'}
        </button>
      </div>
      {stage && openCount > 0 && (
        <p className="hint">
          W etapie: {openCount} {plural(openCount, 'otwarte zadanie', 'otwarte zadania', 'otwartych zadań')}.
        </p>
      )}
    </div>
  );
}
