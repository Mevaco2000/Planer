// Plan dnia: oś godzin z blokami zadań. Przeciągnij zadanie z listy „Do zaplanowania” na godzinę, blok – na inną godzinę,
// dolną krawędź bloku – żeby zmienić czas trwania. Kliknięcie w wolne miejsce dodaje zadanie o tej godzinie.
import { useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useSearchParams } from 'react-router';
import { setDuration, setTime } from '../components/actions';
import { Icon } from '../components/Icon';
import { CheckButton, TaskRow, useCheck } from '../components/TaskRow';
import { Fold, PageHead, Spinner } from '../components/ui';
import { useUI } from '../components/UIContext';
import { DragGhost, useDrag, type DragBind } from '../components/useDrag';
import { useSwipe } from '../components/useSwipe';
import { useData } from '../data';
import { useNow, useToday } from '../hooks';
import { addDays, fmtDuration, fmtLong, fromISO, isISODate, minutesOf, timeOf, toISO } from '../lib/dates';
import { plural } from '../lib/format';
import { DEFAULT_DURATION, isDone, isOverdue, layoutDay, occursOn, sortTasks, taskRepeatLabel } from '../lib/tasks';
import type { Task } from '../types';

/** Wysokość jednej minuty na osi (px). */
const PX = 1.2;
/** Przyciąganie do pełnych kwadransów. */
const SNAP = 15;

/** task – zadanie tego dnia; next – przyszłe powtórzenie rutyny (podgląd); done – rutyna odhaczona tego dnia. */
type Kind = 'task' | 'next' | 'done';

interface Item {
  key: string;
  task: Task;
  kind: Kind;
  start: number;
  end: number;
}

const durOf = (t: Task): number => t.duration ?? DEFAULT_DURATION;
const snap = (m: number): number => Math.round(m / SNAP) * SNAP;

/** Minuta doby pod punktem `y` (oś zaczyna się w `top` od godziny `startH`). */
const minuteAt = (y: number, top: number, startH: number, dur: number): number => Math.max(0, Math.min(1440 - dur, snap(startH * 60 + (y - top) / PX)));

function dayTitle(day: string, today: string): string {
  if (day === today) return 'Dziś';
  if (day === addDays(today, 1)) return 'Jutro';
  if (day === addDays(today, -1)) return 'Wczoraj';
  const wd = fromISO(day).toLocaleDateString('pl-PL', { weekday: 'long' });
  return wd[0].toUpperCase() + wd.slice(1);
}

function PlanBlock({ item, col, cols, startH, bind, dragging }: { item: Item; col: number; cols: number; startH: number; bind: DragBind; dragging: boolean }) {
  const { uid, projectMap } = useData();
  const { openTask } = useUI();
  const { checked, ticking, toggle } = useCheck(item.task);
  const [live, setLive] = useState<number | null>(null);
  const t = item.task;
  const dur = live ?? item.end - item.start;
  const project = t.projectId ? projectMap.get(t.projectId) : undefined;
  const editable = item.kind === 'task' && !isDone(t);
  const range = `${timeOf(item.start)}–${timeOf(item.start + dur)}`;

  // rozciąganie dolnej krawędzi = czas trwania (mysz i palec, co kwadrans)
  const startResize = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    const y0 = e.clientY;
    const base = item.end - item.start;
    let cur = base;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      cur = Math.max(SNAP, Math.min(1440 - item.start, snap(base + (ev.clientY - y0) / PX)));
      setLive(cur);
    };
    const end = (commit: boolean) => () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      setLive(null);
      if (commit && cur !== base) setDuration(uid, t, cur);
    };
    const up = end(true);
    const cancel = end(false);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
  };

  return (
    <div
      className={`plan-block kind-${item.kind} ${isDone(t) || item.kind === 'done' ? 'is-done' : ''} ${dur < 40 ? 'is-short' : ''} ${ticking ? 'is-ticking' : ''} ${dragging ? 'is-dragging' : ''} ${live !== null ? 'is-resizing' : ''}`}
      style={{
        top: (item.start - startH * 60) * PX,
        height: Math.max(dur * PX, 22),
        left: `calc(${(col / cols) * 100}% + 2px)`,
        width: `calc(${100 / cols}% - 4px)`,
        ['--bc' as string]: project?.color ?? 'var(--accent)',
      }}
    >
      {item.kind === 'task' ? (
        <CheckButton task={t} checked={checked} onCheck={toggle} />
      ) : (
        <span className="plan-block-icon" title={item.kind === 'next' ? taskRepeatLabel(t) : 'Zrobione'}>
          <Icon name={item.kind === 'next' ? 'repeat' : 'check'} size={13} />
        </span>
      )}
      <button
        type="button"
        className="plan-block-main"
        onClick={() => openTask(t.id)}
        title={`${t.title} · ${range}${item.kind === 'next' ? ' · powtórzenie' : ''}`}
        {...(editable ? bind : {})}
      >
        <span className="task-title">{t.title}</span>
        <span className="plan-block-time">
          {range}
          {live !== null && ` · ${fmtDuration(dur)}`}
        </span>
      </button>
      {editable && <span className="plan-resize" onPointerDown={startResize} title="Przeciągnij, żeby zmienić czas trwania" aria-hidden="true" />}
    </div>
  );
}

export function Plan() {
  const { tasks, uid, loaded, settings } = useData();
  const { quickAdd, openTask } = useUI();
  const today = useToday();
  const now = useNow();
  const [params, setParams] = useSearchParams();
  const param = params.get('d');
  const day = isISODate(param) ? param : today;
  const go = (next: string) => setParams(next === today ? {} : { d: next }, { replace: true });
  // przesunięcie w bok (palcem, touchpadem albo strzałkami ← →) – poprzedni / następny dzień
  const swipeRef = useSwipe<HTMLDivElement>((dir) => go(addDays(day, dir)));

  const open = tasks.filter((t) => !isDone(t));
  const ofDay = tasks.filter((t) => t.due === day);
  const upcoming = day > today ? open.filter((t) => occursOn(t, day)) : [];
  // rutyna odhaczona tego dnia ma już następny termin – zostaje w planie jako zrobiona
  const doneRoutines = day <= today ? open.filter((t) => t.repeat && t.time && t.lastDone !== null && t.due !== day && toISO(new Date(t.lastDone)) === day) : [];

  const items: Item[] = [
    ...ofDay.filter((t) => t.time).map((t) => ({ t, kind: 'task' as const })),
    ...upcoming.filter((t) => t.time).map((t) => ({ t, kind: 'next' as const })),
    ...doneRoutines.map((t) => ({ t, kind: 'done' as const })),
  ].map(({ t, kind }) => {
    const start = minutesOf(t.time!);
    return { key: `${kind}-${t.id}`, task: t, kind, start, end: Math.min(1440, start + durOf(t)) };
  });
  const layout = layoutDay(items);
  const untimed = sortTasks(ofDay.filter((t) => !t.time && !isDone(t)));
  const upcomingUntimed = upcoming.filter((t) => !t.time);
  const overdue = day === today ? sortTasks(open.filter((t) => isOverdue(t, today))) : [];
  const backlog = sortTasks(open.filter((t) => t.due === null));
  const startH = Math.min(6, Math.floor(Math.min(1440, ...items.map((i) => i.start)) / 60));
  const endH = 24;
  const planned = items.filter((i) => i.kind === 'task').reduce((s, i) => s + i.end - i.start, 0);

  const { drag, bind } = useDrag<Task>((t, target, info) => {
    if (target === 'plan' && info.box) setTime(uid, t, day, timeOf(minuteAt(info.y, info.box.top, startH, durOf(t))), settings, today);
    else if (target === 'unscheduled' && t.time) setTime(uid, t, t.due ?? day, null, settings, today);
  });

  if (!loaded) return <Spinner />;

  const preview = drag?.over === 'plan' && drag.box ? minuteAt(drag.y, drag.box.top, startH, durOf(drag.item)) : null;
  const nowMin = Math.round((now - fromISO(today).getTime()) / 60_000);
  const hours = Array.from({ length: endH - startH }, (_, i) => startH + i);

  const onLaneClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const r = e.currentTarget.getBoundingClientRect();
    const m = Math.max(0, Math.min(1410, Math.floor((startH * 60 + (e.clientY - r.top) / PX) / 30) * 30));
    quickAdd({ due: day, time: timeOf(m) });
  };

  const row = (t: Task, showDue = false) => <TaskRow key={t.id} task={t} showDue={showDue} bind={bind(t)} dragging={drag?.item.id === t.id} />;
  const toPlan = untimed.length + overdue.length;

  return (
    <div className="page page-wide">
      <PageHead title="Plan dnia" />

      <div className="plan-nav">
        <button type="button" className="icon-btn" onClick={() => go(addDays(day, -1))} aria-label="Poprzedni dzień" title="Poprzedni dzień">
          <Icon name="left" />
        </button>
        <label className="plan-date" title="Wybierz dzień">
          <b>{dayTitle(day, today)}</b>
          <span className="muted small capitalize">{fmtLong(day)}</span>
          <input type="date" value={day} onChange={(e) => isISODate(e.target.value) && go(e.target.value)} aria-label="Wybierz dzień" />
        </label>
        <button type="button" className="icon-btn" onClick={() => go(addDays(day, 1))} aria-label="Następny dzień" title="Następny dzień">
          <Icon name="right" />
        </button>
        <span className="spacer" />
        {day !== today && (
          <button type="button" className="btn btn-soft btn-sm" onClick={() => go(today)}>
            Dziś
          </button>
        )}
      </div>

      <div className="swipe-pane" ref={swipeRef}>
      <p className="muted small plan-summary">
        {planned ? `Zaplanowane: ${fmtDuration(planned)}` : 'Nic jeszcze nie zaplanowano na godziny'}
        {toPlan > 0 && ` · ${toPlan} ${plural(toPlan, 'zadanie czeka', 'zadania czekają', 'zadań czeka')} na godzinę`}
      </p>

      <div className="plan-layout">
        <section className={`card list-card plan-side ${drag?.over === 'unscheduled' ? 'drop-over' : ''}`} data-drop="unscheduled">
          <div className="section-head">
            <h2 className="section-title">Do zaplanowania</h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => quickAdd({ due: day })}>
              <Icon name="plus" size={16} /> Dodaj
            </button>
          </div>
          {untimed.length > 0 && <ul className="task-list">{untimed.map((t) => row(t))}</ul>}
          {overdue.length > 0 && (
            <>
              <h3 className="section-title is-overdue section-pad">Zaległe</h3>
              <ul className="task-list">{overdue.map((t) => row(t, true))}</ul>
            </>
          )}
          {upcomingUntimed.length > 0 && (
            <>
              <h3 className="section-title section-pad">Rutyny tego dnia</h3>
              <ul className="task-list">
                {upcomingUntimed.map((t) => (
                  <li key={t.id} className="task is-preview">
                    <span className="plan-block-icon">
                      <Icon name="repeat" size={13} />
                    </span>
                    <button type="button" className="task-main" onClick={() => openTask(t.id)}>
                      <span className="task-title">{t.title}</span>
                      <span className="task-meta">{taskRepeatLabel(t)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {toPlan + upcomingUntimed.length === 0 && <p className="hint plan-empty">Wszystkie zadania na ten dzień mają godzinę.</p>}
          <Fold title="Bez terminu" count={backlog.length}>
            <ul className="task-list">{backlog.map((t) => row(t))}</ul>
          </Fold>
          <p className="hint plan-tip">
            Przeciągnij zadanie na godzinę (na telefonie: przytrzymaj i przeciągnij). Dolną krawędź bloku – żeby zmienić czas trwania. Blok z powrotem tutaj – bez godziny.
            Przesuń palcem w bok (albo strzałki ← →), żeby zmienić dzień.
          </p>
        </section>

        <section className="card plan-day" aria-label="Oś dnia">
          <div className="timeline" style={{ height: (endH - startH) * 60 * PX + 12 }}>
            {hours.map((h) => (
              <div key={h} className="tl-hour" style={{ top: (h - startH) * 60 * PX }}>
                <span>{h}:00</span>
              </div>
            ))}
            {hours.map((h) => (
              <div key={`h${h}`} className="tl-half" style={{ top: ((h - startH) * 60 + 30) * PX }} />
            ))}
            <div className={`tl-lane ${drag ? 'is-target' : ''}`} data-drop="plan" onClick={onLaneClick} title="Kliknij wolne miejsce, żeby dodać zadanie o tej godzinie" style={{ height: (endH - startH) * 60 * PX }}>
              {items.map((it, i) => (
                <PlanBlock key={it.key} item={it} col={layout[i].col} cols={layout[i].cols} startH={startH} bind={bind(it.task)} dragging={drag?.item.id === it.task.id} />
              ))}
              {preview !== null && drag && (
                <div className="tl-preview" style={{ top: (preview - startH * 60) * PX, height: Math.max(durOf(drag.item) * PX, 22) }}>
                  {timeOf(preview)}–{timeOf(preview + durOf(drag.item))}
                </div>
              )}
              {day === today && nowMin >= startH * 60 && nowMin < endH * 60 && (
                <div className="tl-now" style={{ top: (nowMin - startH * 60) * PX }} aria-label={`Teraz: ${timeOf(nowMin)}`} />
              )}
            </div>
          </div>
        </section>
      </div>
      </div>

      {drag && (
        <DragGhost x={drag.x} y={drag.y} touch={drag.touch}>
          <b>{drag.item.title}</b>
          <span className="drag-ghost-to">
            {preview !== null ? `→ ${timeOf(preview)}–${timeOf(preview + durOf(drag.item))}` : drag.over === 'unscheduled' ? '→ bez godziny' : 'upuść na godzinę'}
          </span>
        </DragGhost>
      )}
    </div>
  );
}
