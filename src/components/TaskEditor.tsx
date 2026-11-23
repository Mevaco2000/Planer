import { useState } from 'react';
import { Link } from 'react-router';
import { useData } from '../data';
import { addDays, fmtDue, fmtDuration, fmtWeekday, fromISO, nextWeekday, todayISO, WD_SHORT } from '../lib/dates';
import { applyChange, newStageId, newTaskId, saveSettings, saveStage } from '../lib/db';
import { matches, newKey } from '../lib/format';
import { addDistinct, canLink, findSimilar, linkedChild, pairKey, promoteSubtask, refKey, type Ref } from '../lib/links';
import { MAX_EVERY } from '../lib/repeat';
import {
  alignDue,
  completionPatch,
  DURATIONS,
  groupProjects,
  isDone,
  nextDue,
  PRIORITIES,
  REMIND_TIMED,
  remindAllDay,
  repeatLabel,
  REPEATS,
  ruleOf,
  STATUSES,
  unitLabel,
} from '../lib/tasks';
import type { Priority, Repeat, RepeatFrom, Stage, Status, Task } from '../types';
import { commitChange, removeTask } from './actions';
import { SimilarQuestion } from './Duplicates';
import { Icon } from './Icon';
import { sameAsExisting } from './QuickAdd';
import { confirmAction } from './Sheet';
import { ChildrenList, ParentsField } from './TaskLinks';
import { priorityColor } from './TaskRow';
import { run, toast } from './Toast';
import { Segmented } from './ui';

/** Zmiany w innych zadaniach, które zapiszą się razem z edytowanym (po „Zapisz”). */
interface Pending {
  /** istniejące zadania, które mają wpływać na edytowane */
  link: string[];
  /** powiązane zadania do odłączenia */
  unlink: string[];
  /** podzadania innych zadań, które staną się wspólnym zadaniem (wpływającym i na właściciela, i na edytowane) */
  promote: { ownerId: string; subId: string; title: string }[];
  /** pary „różne” do zapamiętania */
  distinct: string[];
}

const NO_PENDING: Pending = { link: [], unlink: [], promote: [], distinct: [] };

/** Reguła powtarzania z poprawionymi wartościami i termin w pasujący dzień. */
function normalizeRepeat(t: Task): Task {
  if (!t.repeat) return { ...t, every: 1, repeatDays: [], repeatFrom: 'due' };
  const r = ruleOf({ ...t, repeat: t.repeat });
  return { ...t, ...r, due: t.due ? alignDue(t.due, r) : t.due };
}

/** Powtarzanie: rodzaj, co ile, dni tygodnia, od terminu albo od zrobienia. */
function RepeatFields({ t, setT, today }: { t: Task; setT: (fn: (x: Task) => Task) => void; today: string }) {
  const setRepeat = (repeat: Repeat | null) =>
    setT((x) => ({
      ...x,
      repeat,
      due: repeat && !x.due ? today : x.due,
      every: repeat === x.repeat ? x.every : 1,
      repeatDays: repeat === 'weekly' ? x.repeatDays : [],
    }));
  const toggleDay = (d: number) => setT((x) => ({ ...x, repeatDays: x.repeatDays.includes(d) ? x.repeatDays.filter((y) => y !== d) : [...x.repeatDays, d].sort((a, b) => a - b) }));
  const rule = t.repeat ? ruleOf({ ...t, repeat: t.repeat }) : null;
  const after = t.repeat && t.due ? nextDue(alignDue(t.due, rule!), rule!, today) : null;

  return (
    <div className="field">
      <span>
        <Icon name="repeat" size={14} /> Powtarzanie
      </span>
      <select value={t.repeat ?? ''} onChange={(e) => setRepeat((e.target.value || null) as Repeat | null)} aria-label="Powtarzanie">
        <option value="">Nie powtarzaj</option>
        {REPEATS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      {t.repeat && (
        <div className="repeat-box">
          {t.repeat !== 'weekdays' && (
            <label className="every-row">
              <span>Co</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_EVERY}
                value={t.every || ''}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  setT((x) => ({ ...x, every: Number.isFinite(n) ? Math.min(MAX_EVERY, n) : 0 }));
                }}
                aria-label="Co ile"
              />
              <span>{unitLabel(t.repeat, t.every || 1)}</span>
            </label>
          )}
          {t.repeat === 'weekly' && t.repeatFrom === 'due' && (
            <div className="weekdays" role="group" aria-label="Dni tygodnia">
              {WD_SHORT.map((d, i) => (
                <button key={d} type="button" className={`chip day-chip ${t.repeatDays.includes(i) ? 'chip-on' : ''}`} aria-pressed={t.repeatDays.includes(i)} onClick={() => toggleDay(i)}>
                  {d}
                </button>
              ))}
            </div>
          )}
          {t.repeat !== 'weekdays' && (
            <Segmented<RepeatFrom>
              value={t.repeatFrom}
              onChange={(v) => setT((x) => ({ ...x, repeatFrom: v }))}
              ariaLabel="Następny termin liczony"
              options={[
                { value: 'due', label: 'Od terminu' },
                { value: 'done', label: 'Od zrobienia' },
              ]}
            />
          )}
          <p className="hint">
            {t.repeatFrom === 'done'
              ? 'Następny raz liczony od dnia, w którym odhaczysz – np. fryzjer 2 tygodnie po ostatniej wizycie.'
              : t.repeat === 'weekly' && !t.repeatDays.length && t.due
                ? `Stały rytm. Bez zaznaczonych dni – w dzień tygodnia terminu (${fmtWeekday(t.due)}).`
                : 'Stały rytm – kolejne terminy nie przesuwają się, nawet gdy zrobisz później.'}
          </p>
          {rule && (
            <p className="repeat-summary">
              <b>{repeatLabel(rule, t.due)}</b>
              {after && <span className="muted"> · po odhaczeniu dziś następny raz: {fmtDue(after, today)}</span>}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Edycja zadania – w oknie albo jako strona (link z powiadomienia). Zapis po „Zapisz”. */
export function TaskEditor({ initial, isNew, onDone }: { initial: Task; isNew: boolean; onDone: () => void }) {
  const { uid, projects, groups, stages, settings, tasks, taskMap, children } = useData();
  const [t, setT] = useState<Task>(initial);
  const [newSub, setNewSub] = useState('');
  const [pending, setPending] = useState<Pending>(NO_PENDING);
  // podobne zadanie/podzadanie już jest – pytanie przy dodawaniu podzadania albo zapisie nowego zadania
  const [subAsk, setSubAsk] = useState<{ found: Ref; title: string } | null>(null);
  const [saveAsk, setSaveAsk] = useState<{ found: Ref; next: Task } | null>(null);
  const set = <K extends keyof Task>(k: K, v: Task[K]) => setT((x) => ({ ...x, [k]: v }));
  const today = todayISO();
  const projectStages = stages.filter((s) => s.projectId === t.projectId);

  // mniejsze zadania: zapisane powiązania (bez odłączanych) + te, które powiążą się po zapisaniu
  const linkedChildren = [
    ...(children.get(t.id) ?? []).filter((c) => !pending.unlink.includes(c.id)),
    ...pending.link.map((id) => taskMap.get(id)).filter((c): c is Task => Boolean(c)),
  ];
  const linkedIds = new Set(linkedChildren.map((c) => c.id));
  const mapWithDraft = new Map([...taskMap, [t.id, t]]);
  /** może wpływać na edytowane zadanie (bez zapętleń i powtórzeń) */
  const canBeChild = (c: Task) => c.id !== t.id && !linkedIds.has(c.id) && !t.parentIds.includes(c.id) && canLink(c.id, t.id, mapWithDraft);
  /** edytowane zadanie może na nie wpływać */
  const canBeParent = (p: Task) => p.id !== t.id && !t.parentIds.includes(p.id) && !linkedIds.has(p.id) && canLink(t.id, p.id, mapWithDraft);

  const setProject = (projectId: string | null) =>
    setT((x) => ({ ...x, projectId, stageId: x.stageId && stages.some((s) => s.id === x.stageId && s.projectId === projectId) ? x.stageId : null }));

  const newStage = () => {
    if (!t.projectId) return;
    const name = window.prompt('Nazwa nowego etapu (np. „Przygotowanie”, „Wykonanie”, „Odbiór”)')?.trim();
    if (!name) return;
    const s: Stage = { id: newStageId(uid), projectId: t.projectId, name: name.slice(0, 100), order: Math.max(0, ...projectStages.map((x) => x.order)) + 1, createdAt: Date.now(), due: null };
    run(saveStage(uid, s));
    set('stageId', s.id);
  };
  const valid = t.title.trim().length > 0;
  // odhaczenie powtarzanego zadania przesuwa termin zamiast kończyć zadanie
  const advances = t.status === 'done' && initial.completedAt === null && t.repeat !== null && t.due !== null;

  const setDueValue = (due: string | null) =>
    setT((x) => ({
      ...x,
      due,
      time: due ? x.time : null,
      remind: due ? x.remind : null,
      repeat: due ? x.repeat : null,
    }));

  const setTime = (time: string | null) =>
    setT((x) => {
      // nowa godzina → domyślne przypomnienie z ustawień; bez godziny – przypomnienie rano
      if (time && !x.time) return { ...x, time, remind: x.remind ?? settings.defaultRemind };
      if (!time) return { ...x, time: null, remind: x.remind === null ? null : x.remind >= 1440 ? 1440 : 0 };
      return { ...x, time };
    });

  const addSubItem = (title: string, distinctFrom?: Ref) => {
    const id = newKey();
    set('subtasks', [...t.subtasks, { id, title, done: false }]);
    if (distinctFrom) setPending((p) => ({ ...p, distinct: [...p.distinct, pairKey(`s:${t.id}:${id}`, refKey(distinctFrom))] }));
    setNewSub('');
    setSubAsk(null);
  };

  const linkChild = (c: Task) => {
    setPending((p) => ({ ...p, link: [...p.link.filter((x) => x !== c.id), c.id], unlink: p.unlink.filter((x) => x !== c.id) }));
    setNewSub('');
    setSubAsk(null);
  };

  /** Nowe podzadanie – a gdy takie samo zadanie albo podzadanie już gdzieś jest, najpierw pytanie „czy to to samo?”. */
  const addSub = () => {
    const title = newSub.trim();
    if (!title) return;
    const found = findSimilar(title, tasks, { taskId: t.id, distinct: settings.distinct });
    const usable = found && (found.kind === 'sub' ? !pending.promote.some((p) => p.subId === found.sub.id) : canBeChild(found.task));
    if (found && usable) setSubAsk({ found, title });
    else addSubItem(title);
  };

  const subSame = () => {
    if (!subAsk) return;
    const f = subAsk.found;
    if (f.kind === 'task') linkChild(f.task);
    else {
      setPending((p) => ({ ...p, promote: [...p.promote, { ownerId: f.task.id, subId: f.sub.id, title: f.sub.title }] }));
      setNewSub('');
      setSubAsk(null);
    }
  };

  // podpowiedzi przy wpisywaniu podzadania: istniejące zadania, które można powiązać
  const suggestions =
    newSub.trim().length >= 3 && !subAsk ? tasks.filter((c) => !isDone(c) && canBeChild(c) && matches(newSub, c.title)).slice(0, 3) : [];

  /** Zapis edytowanego zadania razem ze zmianami powiązanych zadań – jednym zapisem. */
  const commit = (next: Task, extraDistinct: string[] = []) => {
    const now = Date.now();
    const others = new Map<string, Task>();
    const get = (id: string) => others.get(id) ?? taskMap.get(id);
    const created: Task[] = [];
    const withNext = new Map([...taskMap, [next.id, next]]);
    for (const id of pending.link) {
      const c = get(id);
      if (c && canLink(c.id, next.id, withNext)) others.set(id, linkedChild(c, next));
    }
    for (const id of pending.unlink) {
      const c = get(id);
      if (c) others.set(id, { ...c, parentIds: c.parentIds.filter((p) => p !== next.id) });
    }
    for (const p of pending.promote) {
      const owner = get(p.ownerId);
      const sub = owner?.subtasks.find((s) => s.id === p.subId);
      if (!owner || !sub) continue;
      const ch = promoteSubtask(owner, sub, { id: newTaskId(uid), now, today, extraParents: [next] });
      created.push(ch.put[0]);
      others.set(owner.id, ch.put[1]);
    }
    others.delete(next.id);
    run(applyChange(uid, { put: [{ ...next, updatedAt: now }, ...created, ...others.values()], del: [] }));
    const distinct = [...pending.distinct, ...extraDistinct];
    if (distinct.length) run(saveSettings(uid, { distinct: distinct.reduce(addDistinct, settings.distinct) }));
    if (advances && next.due) toast(`Zrobione – następny raz: ${fmtDue(next.due, today)}`);
    else if (isNew) toast(`Dodano: ${next.title}`);
    onDone();
  };

  const save = () => {
    if (!valid) return;
    const now = Date.now();
    let next: Task = normalizeRepeat({
      ...t,
      title: t.title.trim(),
      notes: t.notes.trim(),
      subtasks: t.subtasks.map((s) => ({ ...s, title: s.title.trim() })).filter((s) => s.title),
    });
    if (next.status === 'done' && initial.completedAt === null) next = { ...next, ...completionPatch(next, now, today) };
    else if (next.status !== 'done') next = { ...next, completedAt: null };
    // nowe zadanie: takie samo już jest?
    if (isNew && !saveAsk) {
      const found = findSimilar(next.title, tasks, { taskId: next.id, distinct: settings.distinct });
      if (found && !(found.kind === 'task' && (next.parentIds.includes(found.task.id) || linkedIds.has(found.task.id)))) {
        setSaveAsk({ found, next });
        return;
      }
    }
    commit(next);
  };

  const saveSame = () => {
    if (!saveAsk) return;
    const r = sameAsExisting(saveAsk.found, saveAsk.next, Date.now(), today);
    if (r.put.length) commitChange(uid, { put: r.put, del: [] }, taskMap, r.text);
    else toast(r.text);
    onDone();
  };

  const saveDifferent = () => {
    if (!saveAsk) return;
    commit(saveAsk.next, [pairKey(`t:${saveAsk.next.id}`, refKey(saveAsk.found))]);
  };

  const remove = () => {
    if (!confirmAction(`Usunąć zadanie „${initial.title}”?`)) return;
    removeTask(uid, initial, taskMap);
    onDone();
  };

  const remindOptions = t.time ? REMIND_TIMED : remindAllDay(settings.morningHour);
  const quickDates = [
    { label: 'Dziś', value: today },
    { label: 'Jutro', value: addDays(today, 1) },
    { label: 'Pon', value: nextWeekday(addDays(today, 1), 0) },
    { label: 'Za tydzień', value: addDays(today, 7) },
  ];

  return (
    <div className="form task-editor">
      <textarea
        className="title-input"
        rows={1}
        value={t.title}
        onChange={(e) => set('title', e.target.value.replace(/\n/g, ' '))}
        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), save())}
        placeholder="Co jest do zrobienia?"
        aria-label="Nazwa zadania"
        autoFocus={isNew}
      />

      <Segmented<Status> value={t.status} options={STATUSES} onChange={(v) => set('status', v)} ariaLabel="Status" />
      {advances && <p className="hint">Zadanie powtarzane – po zapisaniu wróci z następnym terminem.</p>}

      <div className="field">
        <span>Termin</span>
        <div className="chips-wrap">
          {quickDates.map((d) => (
            <button key={d.label} type="button" className={`chip ${t.due === d.value ? 'chip-on' : ''}`} onClick={() => setDueValue(d.value)}>
              {d.label}
            </button>
          ))}
          <button type="button" className={`chip ${t.due === null ? 'chip-on' : ''}`} onClick={() => setDueValue(null)}>
            Bez terminu
          </button>
        </div>
        <div className="grid-2">
          <input type="date" value={t.due ?? ''} onChange={(e) => setDueValue(e.target.value || null)} aria-label="Data" />
          <span className="time-field">
            <input type="time" value={t.time ?? ''} onChange={(e) => setTime(e.target.value || null)} disabled={!t.due} aria-label="Godzina" />
            {t.time && (
              <button type="button" className="icon-btn" onClick={() => setTime(null)} aria-label="Bez godziny">
                <Icon name="x" size={16} />
              </button>
            )}
          </span>
        </div>
        {t.due && <span className="hint">{fromISO(t.due).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>}
      </div>

      <div className="grid-2">
        <label className="field">
          <span>
            <Icon name="hourglass" size={14} /> Czas trwania
          </span>
          <select value={t.duration ?? ''} onChange={(e) => set('duration', e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">Nie podano</option>
            {(t.duration && !DURATIONS.includes(t.duration) ? [...DURATIONS, t.duration].sort((a, b) => a - b) : DURATIONS).map((d) => (
              <option key={d} value={d}>
                {fmtDuration(d)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>
            <Icon name="bell" size={14} /> Przypomnienie
          </span>
          <select value={t.remind ?? ''} disabled={!t.due} onChange={(e) => set('remind', e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">Bez przypomnienia</option>
            {remindOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {t.remind !== null && t.due && !settings.remindersOn && (
        <p className="hint">
          Powiadomienia włączysz w <Link to="/ustawienia">Ustawieniach</Link> – bez tego przypomnienie widać tylko na liście.
        </p>
      )}

      <RepeatFields t={t} setT={setT} today={today} />

      <div className="grid-2">
        <label className="field">
          <span>
            <Icon name="folder" size={14} /> Projekt
          </span>
          <select value={t.projectId ?? ''} onChange={(e) => setProject(e.target.value || null)}>
            <option value="">Skrzynka (bez projektu)</option>
            {groupProjects(projects, groups).map((s) =>
              s.group ? (
                s.projects.length > 0 && (
                  <optgroup key={s.group.id} label={s.group.name}>
                    {s.projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                )
              ) : (
                s.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))
              ),
            )}
          </select>
        </label>
        <label className="field">
          <span>
            <Icon name="milestone" size={14} /> Etap
          </span>
          <select
            value={t.stageId ?? ''}
            disabled={!t.projectId}
            onChange={(e) => (e.target.value === '__new' ? newStage() : set('stageId', e.target.value || null))}
            title={t.projectId ? 'Etap projektu' : 'Etap wybierzesz po wybraniu projektu'}
          >
            <option value="">{t.projectId ? 'Bez etapu' : '—'}</option>
            {projectStages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            {t.projectId && <option value="__new">+ Nowy etap…</option>}
          </select>
        </label>
      </div>

      <div className="field">
        <span>
          <Icon name="flag" size={14} /> Priorytet
        </span>
        <div className="prio-row" role="radiogroup" aria-label="Priorytet">
            {PRIORITIES.map((p) => (
              <button
                key={p.value}
                type="button"
                role="radio"
                aria-checked={t.priority === p.value}
                className={`prio-btn ${t.priority === p.value ? 'on' : ''}`}
                style={{ ['--pc' as string]: priorityColor(p.value) }}
                onClick={() => set('priority', p.value as Priority)}
                title={p.label}
              >
                <Icon name="flag" size={15} />
                <span>{p.label}</span>
              </button>
            ))}
        </div>
      </div>

      <div className="field">
        <span>
          <Icon name="checklist" size={14} /> Podzadania
        </span>
        <ChildrenList
          items={linkedChildren}
          pendingIds={pending.link}
          onUnlink={(c) =>
            setPending((p) => (p.link.includes(c.id) ? { ...p, link: p.link.filter((x) => x !== c.id) } : { ...p, unlink: [...p.unlink, c.id] }))
          }
          promoted={pending.promote.map((pr) => ({
            key: `${pr.ownerId}:${pr.subId}`,
            title: pr.title,
            onUndo: () => setPending((p) => ({ ...p, promote: p.promote.filter((x) => x !== pr) })),
          }))}
        />
        {t.subtasks.length > 0 && (
          <ul className="subtasks">
            {t.subtasks.map((s, i) => (
              <li key={s.id} className={s.done ? 'is-done' : ''}>
                <input
                  type="checkbox"
                  checked={s.done}
                  onChange={(e) => set('subtasks', t.subtasks.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))}
                  aria-label={`Zrobione: ${s.title}`}
                />
                <input
                  className="sub-input"
                  value={s.title}
                  onChange={(e) => set('subtasks', t.subtasks.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                  aria-label="Podzadanie"
                />
                <button type="button" className="icon-btn" onClick={() => set('subtasks', t.subtasks.filter((_, j) => j !== i))} aria-label={`Usuń: ${s.title}`}>
                  <Icon name="x" size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="input-row">
          <input
            value={newSub}
            onChange={(e) => {
              setNewSub(e.target.value);
              setSubAsk(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), subAsk ? undefined : addSub())}
            placeholder="Dodaj podzadanie albo powiąż istniejące zadanie…"
            aria-label="Nowe podzadanie"
          />
          <button type="button" className="btn btn-soft" onClick={addSub} disabled={!newSub.trim() || subAsk !== null} aria-label="Dodaj podzadanie">
            <Icon name="plus" size={18} />
          </button>
        </div>
        {suggestions.length > 0 && (
          <div className="chips-wrap link-suggest">
            {suggestions.map((c) => (
              <button key={c.id} type="button" className="chip" onClick={() => linkChild(c)} title="Istniejące zadanie będzie wpływać na to zadanie">
                <Icon name="link" size={13} /> Powiąż: {c.title}
              </button>
            ))}
          </div>
        )}
        {subAsk && (
          <SimilarQuestion
            found={subAsk.found}
            sameLabel={subAsk.found.kind === 'task' ? 'To samo – powiąż' : 'To samo – połącz'}
            differentLabel="Różne – osobne podzadanie"
            onSame={subSame}
            onDifferent={() => addSubItem(subAsk.title, subAsk.found)}
            onCancel={() => setSubAsk(null)}
            hint={
              subAsk.found.kind === 'task'
                ? 'To zadanie będzie wpływać i na swoje dotychczasowe miejsce, i na to zadanie – odhaczasz je raz.'
                : `Z obu podzadań powstanie jedno zadanie wpływające i na „${subAsk.found.task.title}”, i na to zadanie.`
            }
          />
        )}
      </div>

      <ParentsField
        t={t}
        allow={canBeParent}
        onAdd={(p) => setT((x) => ({ ...x, parentIds: [...x.parentIds, p.id], ...(x.projectId === null && p.projectId ? { projectId: p.projectId, stageId: p.stageId } : {}) }))}
        onRemove={(id) => setT((x) => ({ ...x, parentIds: x.parentIds.filter((p) => p !== id) }))}
      />

      <label className="field">
        <span>
          <Icon name="note" size={14} /> Notatka
        </span>
        <textarea rows={3} value={t.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Szczegóły, linki, adres…" />
      </label>

      {!isNew && (
        <p className="hint">
          Dodane {new Date(initial.createdAt).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' })}
          {initial.doneCount > 0 && ` · zrobione już ${initial.doneCount} ${initial.doneCount === 1 ? 'raz' : 'razy'}`}
          {initial.completedAt
            ? ` · zrobione ${new Date(initial.completedAt).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' })}`
            : initial.lastDone && ` · ostatnio ${new Date(initial.lastDone).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' })}`}
        </p>
      )}

      {saveAsk && (
        <SimilarQuestion
          found={saveAsk.found}
          sameLabel={saveAsk.found.kind === 'sub' ? 'To samo – zrób z niego zadanie' : 'To samo – nie dodawaj'}
          onSame={saveSame}
          onDifferent={saveDifferent}
          onCancel={() => setSaveAsk(null)}
        />
      )}

      <div className="form-actions sticky-actions">
        {!isNew && (
          <button type="button" className="btn btn-danger-ghost" onClick={remove}>
            <Icon name="trash" size={18} /> Usuń
          </button>
        )}
        <span className="spacer" />
        <button type="button" className="btn btn-primary" disabled={!valid} onClick={save}>
          {isNew ? 'Dodaj' : 'Zapisz'}
        </button>
      </div>
    </div>
  );
}
