// Pytania „czy to to samo?” – przy dodawaniu zadania/podzadania i dla par, które już są w danych.
import { useMemo, useState } from 'react';
import { useData } from '../data';
import { fmtDue, todayISO } from '../lib/dates';
import { newTaskId } from '../lib/db';
import { findDuplicates, mergeRefs, refTitle, type DuplicatePair, type Ref } from '../lib/links';
import { commitChange, markDistinct } from './actions';
import { Icon } from './Icon';
import { Dot } from './ui';

/** Gdzie jest zadanie albo podzadanie: „Projekt › Etap · termin” albo „podzadanie w: Większe zadanie”. */
export function RefWhere({ r }: { r: Ref }) {
  const { projectMap, stageMap } = useData();
  const t = r.task;
  const project = t.projectId ? projectMap.get(t.projectId) : undefined;
  const stage = t.stageId ? stageMap.get(t.stageId) : undefined;
  const place = (
    <>
      {project ? <Dot color={project.color} size={8} /> : <Icon name="inbox" size={12} />}
      {project ? project.name : 'Skrzynka'}
      {stage && ` › ${stage.name}`}
    </>
  );
  if (r.kind === 'sub') {
    return (
      <span className="dup-where">
        podzadanie w „{t.title}” · {place}
        {r.sub.done && ' · odhaczone'}
      </span>
    );
  }
  return (
    <span className="dup-where">
      {place}
      {t.due && ` · ${fmtDue(t.due, todayISO())}${t.time ? ` ${t.time}` : ''}`}
      {t.parentIds.length > 0 && ` · wpływa na ${t.parentIds.length}`}
    </span>
  );
}

/** Pytanie przy dodawaniu: „Podobne już jest: … Czy to to samo?” */
export function SimilarQuestion({
  found,
  sameLabel = 'To samo',
  differentLabel = 'Różne – dodaj',
  onSame,
  onDifferent,
  onCancel,
  hint,
}: {
  found: Ref;
  sameLabel?: string;
  differentLabel?: string;
  onSame: () => void;
  onDifferent: () => void;
  onCancel?: () => void;
  hint?: string;
}) {
  return (
    <div className="dup-ask" role="alertdialog" aria-label="Czy to to samo zadanie?">
      <p className="dup-ask-q">
        <Icon name="merge" size={16} /> Podobne {found.kind === 'sub' ? 'podzadanie' : 'zadanie'} już jest. Czy to to samo?
      </p>
      <div className="dup-item">
        <b>{refTitle(found)}</b>
        <RefWhere r={found} />
      </div>
      {hint && <p className="hint">{hint}</p>}
      <div className="actions-row">
        <button type="button" className="btn btn-primary btn-sm" onClick={onSame}>
          {sameLabel}
        </button>
        <button type="button" className="btn btn-soft btn-sm" onClick={onDifferent}>
          {differentLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            Wróć
          </button>
        )}
      </div>
    </div>
  );
}

/** Co się stanie po „to samo” – krótko, żeby wiadomo było, co klikam. */
function mergeHint(p: DuplicatePair): string {
  if (p.a.kind === 'task' && p.b.kind === 'task') return 'Zostanie jedno zadanie – z terminem, podzadaniami, notatkami i powiązaniami obu.';
  if (p.a.kind === 'sub' && p.b.kind === 'sub') return 'Powstanie jedno zadanie, które wpływa na oba większe zadania – odhaczasz je raz.';
  return 'Zadanie będzie wpływać także na to większe zadanie, a podzadanie zniknie z jego listy – odhaczasz raz.';
}

// „Później” – do końca sesji (bez zapisu)
const later = new Set<string>();

/**
 * Karta z pytaniem o parę, która wygląda tak samo (np. „Kupić kabel HDMI” w dwóch miejscach).
 * `filter` – tylko pary dotyczące np. danego projektu.
 */
export function DuplicatesCard({ filter }: { filter?: (p: DuplicatePair) => boolean }) {
  const { uid, tasks, taskMap, settings } = useData();
  const [, rerender] = useState(0);
  const pairs = useMemo(() => findDuplicates(tasks, settings.distinct), [tasks, settings.distinct]);
  const list = pairs.filter((p) => !later.has(p.key) && (!filter || filter(p)));
  const pair = list[0];
  if (!pair) return null;

  const same = () => {
    const today = todayISO();
    const m = mergeRefs(pair.a, pair.b, tasks, { newId: () => newTaskId(uid), now: Date.now(), today });
    commitChange(uid, m.change, taskMap, m.text);
  };
  const different = () => markDistinct(uid, settings, pair.key);
  const skip = () => {
    later.add(pair.key);
    rerender((n) => n + 1);
  };
  return (
    <section className="card dup-card" aria-label="Możliwy duplikat">
      <div className="section-head">
        <h2 className="section-title">
          <Icon name="merge" size={16} /> Czy to to samo?
        </h2>
        {list.length > 1 && <span className="muted small">1 z {list.length}</span>}
      </div>
      <div className="dup-pair">
        {[pair.a, pair.b].map((r) => (
          <div key={r.kind === 'task' ? r.task.id : `${r.task.id}:${r.sub.id}`} className="dup-item">
            <b>{refTitle(r)}</b>
            <RefWhere r={r} />
          </div>
        ))}
      </div>
      <p className="hint">{mergeHint(pair)}</p>
      <div className="actions-row">
        <button type="button" className="btn btn-primary btn-sm" onClick={same}>
          <Icon name="merge" size={16} /> To samo – połącz
        </button>
        <button type="button" className="btn btn-soft btn-sm" onClick={different}>
          Różne
        </button>
        <span className="spacer" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={skip}>
          Później
        </button>
      </div>
    </section>
  );
}
