import { useMemo, useRef, useState } from 'react';
import { useData } from '../data';
import { fmtDue, todayISO } from '../lib/dates';
import { newTaskId, saveTask } from '../lib/db';
import { findSimilar, pairKey, promoteSubtask, refKey, type Ref } from '../lib/links';
import { parseQuickAdd, type TokenKind } from '../lib/quickAdd';
import { blankTask, REPEATS } from '../lib/tasks';
import type { Repeat, Status, Task } from '../types';
import { commitChange, markDistinct } from './actions';
import { SimilarQuestion } from './Duplicates';
import { Icon } from './Icon';
import { run, toast } from './Toast';
import { Dot } from './ui';

/** Pola terminu, które „to samo” przenosi na istniejące zadanie, gdy samo ich nie ma. */
const SCHEDULE: (keyof Task)[] = ['due', 'time', 'remind', 'repeat', 'every', 'repeatDays', 'repeatFrom'];

/**
 * „To samo” przy szybkim dodawaniu: nowe zadanie nie powstaje. Istniejące zadanie dostaje brakujący termin, czas, projekt;
 * podzadanie staje się osobnym zadaniem (z wpisanym terminem) powiązanym ze swoim większym zadaniem.
 */
export function sameAsExisting(found: Ref, draft: Task, now: number, today: string): { put: Task[]; text: string } {
  if (found.kind === 'task') {
    const ex = found.task;
    const patch: Partial<Task> = {};
    if (!ex.due && draft.due) for (const k of SCHEDULE) Object.assign(patch, { [k]: draft[k] });
    if (!ex.duration && draft.duration) patch.duration = draft.duration;
    if (draft.priority < ex.priority) patch.priority = draft.priority;
    if (!ex.projectId && draft.projectId) Object.assign(patch, { projectId: draft.projectId, stageId: draft.stageId });
    if (!Object.keys(patch).length) return { put: [], text: `Nie dodano – „${ex.title}” już jest` };
    return { put: [{ ...ex, ...patch }], text: `„${ex.title}” już jest – uzupełniono${patch.due ? ` termin (${fmtDue(patch.due as string, today)})` : ''}` };
  }
  const extra: Partial<Task> = {};
  for (const k of [...SCHEDULE, 'duration', 'priority'] as (keyof Task)[]) Object.assign(extra, { [k]: draft[k] });
  if (draft.projectId) Object.assign(extra, { projectId: draft.projectId, stageId: draft.stageId });
  const change = promoteSubtask(found.task, found.sub, { id: draft.id, now, today, patch: extra });
  return { put: change.put, text: `„${found.sub.title}” jest teraz osobnym zadaniem – wpływa na „${found.task.title}”` };
}

export interface QuickDefaults {
  due?: string | null;
  /** godzina, np. po kliknięciu w pustą godzinę w planie dnia */
  time?: string | null;
  projectId?: string | null;
  /** etap projektu (np. dodawanie z sekcji etapu) */
  stageId?: string | null;
  status?: Status;
  /** na ekranie „Rutyny” nowe zadanie od razu się powtarza */
  repeat?: Repeat | null;
}

const KIND_ICON = { date: 'calendar', time: 'clock', duration: 'hourglass', priority: 'flag', project: 'folder', repeat: 'repeat' } as const;

/** Szybkie dodawanie: jedno pole, a termin, godzinę, czas trwania, priorytet, projekt i powtarzanie rozpoznaje z tekstu. */
export function QuickAdd({ defaults, onDetails, onOpen }: { defaults: QuickDefaults; onDetails: (draft: Task) => void; onOpen?: (id: string) => void }) {
  const { uid, projects, projectMap, stages, stageMap, settings, tasks, taskMap } = useData();
  const [text, setText] = useState('');
  const [off, setOff] = useState<TokenKind[]>([]);
  const [useDue, setUseDue] = useState(true);
  const [useTime, setUseTime] = useState(true);
  const [useProject, setUseProject] = useState(true);
  const [useRepeat, setUseRepeat] = useState(true);
  const [added, setAdded] = useState(0);
  // podobne zadanie już jest – pytanie „czy to to samo?” przed dodaniem
  const [ask, setAsk] = useState<{ found: Ref; draft: Task } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const today = todayISO();

  const parsed = useMemo(() => parseQuickAdd(text, new Date(), projects, off, stages), [text, projects, off, stages]);
  const defRepeat = !parsed.repeat && useRepeat ? (defaults.repeat ?? null) : null;
  const defDue = useDue && defaults.due ? defaults.due : defRepeat ? today : null;
  const due = parsed.due ?? defDue;
  const defTime = !parsed.time && useTime && due ? (defaults.time ?? null) : null;
  const projectId = parsed.projectId ?? (useProject ? (defaults.projectId ?? null) : null);
  const defaultProject = defaults.projectId ? projectMap.get(defaults.projectId) : undefined;
  const defaultStage = defaults.stageId ? stageMap.get(defaults.stageId) : undefined;
  const stageId = parsed.projectId ? parsed.stageId : projectId && defaultStage?.projectId === projectId ? defaultStage.id : null;

  const build = (): Task => {
    const time = due ? (parsed.time ?? defTime) : null;
    const repeat = due ? (parsed.repeat ?? defRepeat) : null;
    return blankTask(newTaskId(uid), Date.now(), {
      title: parsed.title,
      projectId,
      stageId,
      status: defaults.status ?? 'todo',
      priority: parsed.priority ?? 4,
      due,
      time,
      duration: parsed.duration,
      remind: time ? settings.defaultRemind : null,
      repeat,
      every: parsed.repeat ? parsed.every : 1,
      repeatDays: parsed.repeat ? parsed.repeatDays : [],
    });
  };

  const reset = () => {
    setAsk(null);
    setText('');
    setOff([]);
    input.current?.focus();
  };

  const save = (t: Task) => {
    run(saveTask(uid, t));
    const where = [t.due && `${fmtDue(t.due, today)}${t.time ? ` ${t.time}` : ''}`, t.projectId && projectMap.get(t.projectId)?.name].filter(Boolean).join(' · ');
    toast(`Dodano: ${t.title}${where ? ` (${where})` : ''}`);
    setAdded((n) => n + 1);
    reset();
  };

  const add = () => {
    if (!parsed.title || ask) return;
    const t = build();
    const found = findSimilar(t.title, tasks, { distinct: settings.distinct });
    if (found) setAsk({ found, draft: t });
    else save(t);
  };

  const same = () => {
    if (!ask) return;
    const r = sameAsExisting(ask.found, ask.draft, Date.now(), today);
    const existing = ask.found.task.id;
    if (r.put.length) commitChange(uid, { put: r.put, del: [] }, taskMap, r.text);
    else toast(r.text, 'info', onOpen ? { label: 'Pokaż', run: () => onOpen(existing) } : undefined);
    reset();
  };

  const different = () => {
    if (!ask) return;
    markDistinct(uid, settings, pairKey(`t:${ask.draft.id}`, refKey(ask.found)));
    save(ask.draft);
  };

  return (
    <div className="quick">
      <div className="quick-row">
        <input
          ref={input}
          className="quick-input"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setAsk(null);
            if (!e.target.value) setOff([]);
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          placeholder={defaults.repeat ? 'Np. Golenie co 2 dni rano' : 'Np. Raport w piątek o 10 !1 #praca'}
          aria-label="Nowe zadanie"
          autoFocus
          enterKeyHint="done"
        />
        <button type="button" className="btn btn-primary quick-add" onClick={add} disabled={!parsed.title || ask !== null} aria-label="Dodaj zadanie">
          <Icon name="arrowRight" />
        </button>
      </div>

      <div className="chips-wrap quick-chips" aria-live="polite">
        {parsed.tokens.map((t) => (
          <span key={t.kind} className={`chip chip-token kind-${t.kind}`}>
            <Icon name={KIND_ICON[t.kind]} size={13} />
            {t.label}
            <button type="button" className="chip-x" onClick={() => setOff((o) => [...o, t.kind])} aria-label={`Nie rozpoznawaj: ${t.text}`} title={`To nie ${t.kind === 'date' ? 'termin' : 'polecenie'} – zostaw „${t.text}” w nazwie`}>
              <Icon name="x" size={12} />
            </button>
          </span>
        ))}
        {!parsed.due && due && useDue && (
          <span className="chip chip-token chip-default">
            <Icon name="calendar" size={13} />
            {fmtDue(due, today)}
            {defaults.due && (
              <button type="button" className="chip-x" onClick={() => setUseDue(false)} aria-label="Bez terminu">
                <Icon name="x" size={12} />
              </button>
            )}
          </span>
        )}
        {defTime && (
          <span className="chip chip-token chip-default">
            <Icon name="clock" size={13} />
            {defTime}
            <button type="button" className="chip-x" onClick={() => setUseTime(false)} aria-label="Bez godziny">
              <Icon name="x" size={12} />
            </button>
          </span>
        )}
        {defRepeat && (
          <span className="chip chip-token chip-default">
            <Icon name="repeat" size={13} />
            {REPEATS.find((r) => r.value === defRepeat)?.label}
            <button type="button" className="chip-x" onClick={() => setUseRepeat(false)} aria-label="Bez powtarzania">
              <Icon name="x" size={12} />
            </button>
          </span>
        )}
        {!parsed.projectId && defaultProject && useProject && (
          <span className="chip chip-token chip-default">
            <Dot color={defaultProject.color} size={8} />
            {defaultProject.name}
            {stageId && defaultStage && ` › ${defaultStage.name}`}
            <button type="button" className="chip-x" onClick={() => setUseProject(false)} aria-label="Do Skrzynki">
              <Icon name="x" size={12} />
            </button>
          </span>
        )}
      </div>

      {ask && (
        <SimilarQuestion
          found={ask.found}
          sameLabel={ask.found.kind === 'sub' ? 'To samo – zrób z niego zadanie' : 'To samo – nie dodawaj'}
          onSame={same}
          onDifferent={different}
          onCancel={() => setAsk(null)}
          hint={
            ask.found.kind === 'sub'
              ? 'Podzadanie stanie się osobnym zadaniem z wpisanym terminem i nadal będzie wpływać na swoje większe zadanie.'
              : 'Nie powstanie drugie takie samo zadanie. Jeśli istniejące nie ma terminu albo projektu, dostanie te wpisane tutaj.'
          }
        />
      )}

      <p className="hint">
        Rozpoznam z tekstu termin („jutro”, „w piątek”, „15.12”), godzinę („o 18”), czas trwania („przez 2h”, „30 min”), priorytet („!1”), projekt („#praca”, z etapem:
        „#praca/odbiór”) i powtarzanie („co 2 dni”, „co 2 tygodnie”, „w pon i czw”). Enter dodaje i czyści pole.
      </p>

      <div className="form-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDetails(build())}>
          <Icon name="edit" size={16} /> Więcej opcji
        </button>
        <span className="spacer" />
        {added > 0 && <span className="muted small">Dodano {added}</span>}
      </div>
    </div>
  );
}
