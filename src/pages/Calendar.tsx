// Kalendarz: miesiąc (siatka z zadaniami i lista wybranego dnia), tydzień (oś godzin dla 7 dni) i lista najbliższych 2 tygodni.
// Przeciągnij zadanie na inny dzień (albo godzinę w tygodniu), przesuń palcem w bok – poprzedni / następny miesiąc albo tydzień.
import { useMemo, useState, type CSSProperties, type MouseEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { setDue, setTime } from '../components/actions';
import { Icon } from '../components/Icon';
import { TaskRow } from '../components/TaskRow';
import { Fold, PageHead, Segmented, Spinner } from '../components/ui';
import { useUI } from '../components/UIContext';
import { DragGhost, useDrag } from '../components/useDrag';
import { useSwipe } from '../components/useSwipe';
import { useData } from '../data';
import { useNow, useToday } from '../hooks';
import { dayItems, fmtMonth, fmtWeek, monthGrid, weekDays, type DayItem } from '../lib/calendar';
import { addDays, addMonths, fmtDue, fmtLong, fmtWeekday, fromISO, isISODate, minutesOf, timeOf, WD_SHORT, weekdayIndex } from '../lib/dates';
import { DEFAULT_DURATION, isDone, isOverdue, layoutDay, sortTasks, taskRepeatLabel } from '../lib/tasks';
import type { Task } from '../types';
import { Upcoming } from './Upcoming';

type CalView = 'month' | 'week' | 'list';

const VIEW_PARAM: Record<CalView, string> = { month: 'miesiac', week: 'tydzien', list: 'lista' };
const VIEW_KEY = 'planer.calendar.view';
const ROUTINES_KEY = 'planer.calendar.routines';
/** Ile zadań widać w kratce miesiąca (reszta: „+N”). */
const CELL_MAX = 3;
/** Tydzień: wysokość minuty (px) i przyciąganie do kwadransa. */
const PXW = 0.8;
const SNAP = 15;

function readStored<T extends string>(key: string, allowed: T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* tryb prywatny */
  }
}

const colorOf = (t: Task, projects: Map<string, { color: string }>): string => (t.projectId && projects.get(t.projectId)?.color) || 'var(--accent)';

function dayTitle(day: string, today: string): string {
  if (day === today) return 'Dziś';
  if (day === addDays(today, 1)) return 'Jutro';
  if (day === addDays(today, -1)) return 'Wczoraj';
  const wd = fromISO(day).toLocaleDateString('pl-PL', { weekday: 'long' });
  return wd[0].toUpperCase() + wd.slice(1);
}

/** Lista zadań wybranego dnia pod kalendarzem. */
function DayAgenda({ day, today, items, bind, dragId }: { day: string; today: string; items: DayItem[]; bind: ReturnType<typeof useDrag<Task>>['bind']; dragId: string | null }) {
  const { tasks } = useData();
  const { quickAdd, openTask } = useUI();
  const open = items.filter((i) => i.kind === 'task').map((i) => i.task);
  const next = items.filter((i) => i.kind === 'next').map((i) => i.task);
  const done = items.filter((i) => i.kind === 'done').map((i) => i.task);
  const overdue = day === today ? sortTasks(tasks.filter((t) => isOverdue(t, today))) : [];
  const row = (t: Task, showDue = false) => <TaskRow key={t.id} task={t} showDue={showDue} bind={bind(t)} dragging={dragId === t.id} />;

  return (
    <section className="card list-card cal-agenda" aria-live="polite">
      <div className="section-head">
        <h2 className="section-title">
          {dayTitle(day, today)} <span className="muted capitalize cal-agenda-date">{fmtLong(day)}</span>
        </h2>
        <span className="spacer" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => quickAdd({ due: day })}>
          <Icon name="plus" size={16} /> Dodaj
        </button>
        <Link to={day === today ? '/plan' : `/plan?d=${day}`} className="btn btn-ghost btn-sm" title="Rozplanuj ten dzień na godziny">
          <Icon name="timeline" size={16} /> Plan dnia
        </Link>
      </div>
      {open.length > 0 ? <ul className="task-list">{open.map((t) => row(t))}</ul> : !overdue.length && !next.length && <p className="hint cal-free">Wolne – nic nie zaplanowano.</p>}
      {overdue.length > 0 && (
        <>
          <h3 className="section-title is-overdue section-pad">Zaległe</h3>
          <ul className="task-list">{overdue.map((t) => row(t, true))}</ul>
        </>
      )}
      {next.length > 0 && (
        <>
          <h3 className="section-title section-pad">Rutyny tego dnia</h3>
          <ul className="task-list">
            {next.map((t) => (
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
      <Fold title="Zrobione" count={done.length}>
        <ul className="task-list">{done.map((t) => row(t))}</ul>
      </Fold>
    </section>
  );
}

function MonthView({ day, today, routines, onDay }: { day: string; today: string; routines: boolean; onDay: (d: string) => void }) {
  const { tasks, uid, projectMap } = useData();
  const { openTask } = useUI();
  const nav = useNavigate();
  const { drag, bind } = useDrag<Task>((t, target) => isISODate(target) && setDue(uid, t, target, today));
  const swipeRef = useSwipe<HTMLDivElement>((dir) => onDay(addMonths(day, dir)));
  const grid = monthGrid(day);
  const month = day.slice(0, 7);
  const key = grid.join();
  const items = useMemo(() => new Map(grid.map((d) => [d, dayItems(tasks, d, today, routines)])), [tasks, key, today, routines]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="cal-nav">
        <button type="button" className="icon-btn" onClick={() => onDay(addMonths(day, -1))} aria-label="Poprzedni miesiąc" title="Poprzedni miesiąc">
          <Icon name="left" />
        </button>
        <h2 className="cal-title capitalize">{fmtMonth(day)}</h2>
        <button type="button" className="icon-btn" onClick={() => onDay(addMonths(day, 1))} aria-label="Następny miesiąc" title="Następny miesiąc">
          <Icon name="right" />
        </button>
        <span className="spacer" />
        {month !== today.slice(0, 7) && (
          <button type="button" className="btn btn-soft btn-sm" onClick={() => onDay(today)}>
            Dziś
          </button>
        )}
      </div>

      <div className="swipe-pane" ref={swipeRef}>
        <div className="card cal-month">
          <div className="cal-head" aria-hidden="true">
            {WD_SHORT.map((w, i) => (
              <span key={w} className={i > 4 ? 'is-weekend' : ''}>
                {w}
              </span>
            ))}
          </div>
          <div className="cal-grid">
            {grid.map((date) => {
              const list = items.get(date) ?? [];
              const cls = [
                'cal-cell',
                date.slice(0, 7) !== month && 'is-other',
                date === today && 'is-today',
                date === day && 'is-selected',
                weekdayIndex(date) > 4 && 'is-weekend',
                drag?.over === date && 'drop-over',
              ]
                .filter(Boolean)
                .join(' ');
              const openCount = list.filter((i) => i.kind === 'task').length;
              return (
                <div key={date} className={cls} data-drop={date} onClick={() => onDay(date)} onDoubleClick={() => nav(date === today ? '/plan' : `/plan?d=${date}`)}>
                  <button
                    type="button"
                    className="cal-num"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDay(date);
                    }}
                    aria-pressed={date === day}
                    aria-label={`${fmtLong(date)}${openCount ? `, ${openCount} zadań` : ''}`}
                  >
                    {fromISO(date).getDate()}
                  </button>
                  <ul className="cal-items">
                    {list.slice(0, CELL_MAX).map((it) => (
                      <li
                        key={`${it.kind}-${it.task.id}`}
                        className={`cal-item kind-${it.kind} ${isOverdue(it.task, today) ? 'is-overdue' : ''} ${drag?.item.id === it.task.id ? 'is-dragging' : ''}`}
                        style={{ ['--c' as string]: colorOf(it.task, projectMap) } as CSSProperties}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openTask(it.task.id);
                          }}
                          title={`${it.task.time ? `${it.task.time} ` : ''}${it.task.title}${it.kind === 'next' ? ' · powtórzenie' : ''}`}
                          {...(it.kind === 'task' ? bind(it.task) : {})}
                        >
                          {it.task.time && <b>{it.task.time}</b>}
                          <span>{it.task.title}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {list.length > CELL_MAX && <span className="cal-more">+{list.length - CELL_MAX}</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <p className="hint center cal-tip">Kliknij dzień, żeby zobaczyć jego zadania (dwuklik – plan dnia). Przeciągnij zadanie na inny dzień. Przesuń w bok – inny miesiąc.</p>

      <DayAgenda day={day} today={today} items={items.get(day) ?? dayItems(tasks, day, today, routines)} bind={bind} dragId={drag?.item.id ?? null} />

      {drag && (
        <DragGhost x={drag.x} y={drag.y} touch={drag.touch}>
          <b>{drag.item.title}</b>
          <span className="drag-ghost-to">{drag.over && isISODate(drag.over) ? `→ ${fmtDue(drag.over, today)}` : 'upuść na dzień'}</span>
        </DragGhost>
      )}
    </>
  );
}

interface WeekItem extends DayItem {
  key: string;
  start: number;
  end: number;
}

const durOf = (t: Task): number => t.duration ?? DEFAULT_DURATION;
const snap = (m: number): number => Math.round(m / SNAP) * SNAP;
const minuteAt = (y: number, top: number, startH: number, dur: number): number => Math.max(0, Math.min(1440 - dur, snap(startH * 60 + (y - top) / PXW)));

function WeekView({ day, today, routines, onDay }: { day: string; today: string; routines: boolean; onDay: (d: string) => void }) {
  const { tasks, uid, settings, projectMap } = useData();
  const { quickAdd, openTask } = useUI();
  const nav = useNavigate();
  const now = useNow();
  const days = weekDays(day);
  const perDay = days.map((d) => dayItems(tasks, d, today, routines));
  const timed: WeekItem[][] = perDay.map((list) =>
    list
      .filter((i) => i.task.time)
      .map((i) => {
        const start = minutesOf(i.task.time!);
        return { ...i, key: `${i.kind}-${i.task.id}`, start, end: Math.min(1440, start + durOf(i.task)) };
      }),
  );
  const allDay = perDay.map((list) => list.filter((i) => !i.task.time));
  const startH = Math.min(7, ...timed.flat().map((i) => Math.floor(i.start / 60)));
  const hours = Array.from({ length: 24 - startH }, (_, i) => startH + i);
  const height = (24 - startH) * 60 * PXW;

  const { drag, bind } = useDrag<Task>((t, target, info) => {
    if (target.startsWith('wk:') && info.box) setTime(uid, t, target.slice(3), timeOf(minuteAt(info.y, info.box.top, startH, durOf(t))), settings, today);
    else if (target.startsWith('all:')) {
      const date = target.slice(4);
      if (t.time) setTime(uid, t, date, null, settings, today);
      else setDue(uid, t, date, today);
    }
  });
  const swipeRef = useSwipe<HTMLDivElement>((dir) => onDay(addDays(day, 7 * dir)));

  const preview = drag?.over?.startsWith('wk:') && drag.box ? { date: drag.over.slice(3), min: minuteAt(drag.y, drag.box.top, startH, durOf(drag.item)) } : null;
  const nowMin = Math.round((now - fromISO(today).getTime()) / 60_000);

  const onLaneClick = (e: MouseEvent<HTMLDivElement>, date: string) => {
    if (e.target !== e.currentTarget) return;
    const r = e.currentTarget.getBoundingClientRect();
    const m = Math.max(0, Math.min(1410, Math.floor((startH * 60 + (e.clientY - r.top) / PXW) / 30) * 30));
    quickAdd({ due: date, time: timeOf(m) });
  };

  return (
    <>
      <div className="cal-nav">
        <button type="button" className="icon-btn" onClick={() => onDay(addDays(day, -7))} aria-label="Poprzedni tydzień" title="Poprzedni tydzień">
          <Icon name="left" />
        </button>
        <h2 className="cal-title">{fmtWeek(day)}</h2>
        <button type="button" className="icon-btn" onClick={() => onDay(addDays(day, 7))} aria-label="Następny tydzień" title="Następny tydzień">
          <Icon name="right" />
        </button>
        <span className="spacer" />
        {!days.includes(today) && (
          <button type="button" className="btn btn-soft btn-sm" onClick={() => onDay(today)}>
            Ten tydzień
          </button>
        )}
      </div>

      <div className="swipe-pane" ref={swipeRef}>
        <section className="card cal-week" aria-label="Tydzień">
          <div className="wk-row wk-head">
            <span className="wk-gutter" />
            {days.map((date) => (
              <button
                key={date}
                type="button"
                className={`wk-day ${date === today ? 'is-today' : ''} ${date === day ? 'is-selected' : ''} ${weekdayIndex(date) > 4 ? 'is-weekend' : ''}`}
                onClick={() => onDay(date)}
                onDoubleClick={() => nav(date === today ? '/plan' : `/plan?d=${date}`)}
                aria-pressed={date === day}
                aria-label={fmtLong(date)}
              >
                <span>{fmtWeekday(date)}</span>
                <b>{fromISO(date).getDate()}</b>
              </button>
            ))}
          </div>
          <div className="wk-row wk-allday">
            <span className="wk-gutter muted">bez godz.</span>
            {days.map((date, i) => (
              <div key={date} className={`wk-all ${drag?.over === `all:${date}` ? 'drop-over' : ''}`} data-drop={`all:${date}`}>
                {allDay[i].map((it) => (
                  <button
                    key={`${it.kind}-${it.task.id}`}
                    type="button"
                    className={`wk-chip kind-${it.kind} ${isOverdue(it.task, today) ? 'is-overdue' : ''} ${drag?.item.id === it.task.id ? 'is-dragging' : ''}`}
                    style={{ ['--c' as string]: colorOf(it.task, projectMap) } as CSSProperties}
                    onClick={() => openTask(it.task.id)}
                    title={it.task.title}
                    {...(it.kind === 'task' ? bind(it.task) : {})}
                  >
                    {it.task.title}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="wk-row wk-body" style={{ height }}>
            <div className="wk-gutter wk-hours">
              {hours.map((h) => (
                <span key={h} style={{ top: (h - startH) * 60 * PXW }}>
                  {h}:00
                </span>
              ))}
            </div>
            {days.map((date, i) => {
              const layout = layoutDay(timed[i]);
              return (
                <div
                  key={date}
                  className={`wk-lane ${date === today ? 'is-today' : ''} ${drag ? 'is-target' : ''}`}
                  data-drop={`wk:${date}`}
                  onClick={(e) => onLaneClick(e, date)}
                  style={{ backgroundSize: `100% ${60 * PXW}px` }}
                  title="Kliknij wolne miejsce, żeby dodać zadanie o tej godzinie"
                >
                  {timed[i].map((it, j) => {
                    const dur = it.end - it.start;
                    const editable = it.kind === 'task' && !isDone(it.task);
                    return (
                      <button
                        key={it.key}
                        type="button"
                        className={`wk-block kind-${it.kind} ${isDone(it.task) || it.kind === 'done' ? 'is-done' : ''} ${dur < 40 ? 'is-short' : ''} ${drag?.item.id === it.task.id ? 'is-dragging' : ''}`}
                        style={
                          {
                            top: (it.start - startH * 60) * PXW,
                            height: Math.max(dur * PXW, 16),
                            left: `calc(${(layout[j].col / layout[j].cols) * 100}% + 1px)`,
                            width: `calc(${100 / layout[j].cols}% - 2px)`,
                            ['--c' as string]: colorOf(it.task, projectMap),
                          } as CSSProperties
                        }
                        onClick={() => openTask(it.task.id)}
                        title={`${it.task.title} · ${timeOf(it.start)}–${timeOf(it.end)}${it.kind === 'next' ? ' · powtórzenie' : ''}`}
                        {...(editable ? bind(it.task) : {})}
                      >
                        <b>{timeOf(it.start)}</b>
                        <span>{it.task.title}</span>
                      </button>
                    );
                  })}
                  {preview && preview.date === date && drag && (
                    <div className="tl-preview wk-preview" style={{ top: (preview.min - startH * 60) * PXW, height: Math.max(durOf(drag.item) * PXW, 16) }}>
                      {timeOf(preview.min)}
                    </div>
                  )}
                  {date === today && nowMin >= startH * 60 && <div className="tl-now wk-now" style={{ top: (nowMin - startH * 60) * PXW }} />}
                </div>
              );
            })}
          </div>
        </section>
      </div>
      <p className="hint center cal-tip">Przeciągnij zadanie na inną godzinę albo dzień (na telefonie: przytrzymaj). Kliknij wolne miejsce – nowe zadanie o tej godzinie. Przesuń w bok – inny tydzień.</p>

      <DayAgenda day={day} today={today} items={perDay[days.indexOf(day)] ?? []} bind={bind} dragId={drag?.item.id ?? null} />

      {drag && (
        <DragGhost x={drag.x} y={drag.y} touch={drag.touch}>
          <b>{drag.item.title}</b>
          <span className="drag-ghost-to">
            {preview
              ? `→ ${fmtDue(preview.date, today)} ${timeOf(preview.min)}`
              : drag.over?.startsWith('all:')
                ? `→ ${fmtDue(drag.over.slice(4), today)}, bez godziny`
                : isISODate(drag.over)
                  ? `→ ${fmtDue(drag.over!, today)}`
                  : 'upuść na dzień albo godzinę'}
          </span>
        </DragGhost>
      )}
    </>
  );
}

export function Calendar() {
  const { loaded } = useData();
  const today = useToday();
  const [params, setParams] = useSearchParams();
  // przyszłe powtórzenia rutyn – domyślnie ukryte (rutyna „co 2 dni” zajęłaby pół miesiąca)
  const [routines, setRoutines] = useState(() => readStored(ROUTINES_KEY, ['1', '0'], '0') === '1');
  const v = params.get('v');
  const view: CalView = v === VIEW_PARAM.week ? 'week' : v === VIEW_PARAM.list ? 'list' : v === VIEW_PARAM.month ? 'month' : readStored<CalView>(VIEW_KEY, ['month', 'week', 'list'], 'month');
  const d = params.get('d');
  const day = isISODate(d) ? d : today;

  const update = (next: { view?: CalView; day?: string }) => {
    const nv = next.view ?? view;
    const nd = next.day ?? day;
    setParams(nd === today ? { v: VIEW_PARAM[nv] } : { v: VIEW_PARAM[nv], d: nd }, { replace: true });
  };
  if (!loaded) return <Spinner />;

  return (
    <div className={`page ${view !== 'list' ? 'page-wide' : ''}`}>
      <PageHead title="Kalendarz" />
      <div className="cal-toolbar">
        <Segmented<CalView>
          value={view}
          onChange={(nv) => {
            store(VIEW_KEY, nv);
            update({ view: nv });
          }}
          ariaLabel="Widok kalendarza"
          options={[
            {
              value: 'month',
              label: (
                <>
                  <Icon name="grid" size={16} /> Miesiąc
                </>
              ),
            },
            {
              value: 'week',
              label: (
                <>
                  <Icon name="columns" size={16} /> Tydzień
                </>
              ),
            },
            {
              value: 'list',
              label: (
                <>
                  <Icon name="list" size={16} /> Lista
                </>
              ),
            },
          ]}
        />
        {view !== 'list' && (
          <label className="check-inline" title="Przyszłe powtórzenia rutyn (przerywana ramka)">
            <input
              type="checkbox"
              checked={routines}
              onChange={(e) => {
                setRoutines(e.target.checked);
                store(ROUTINES_KEY, e.target.checked ? '1' : '0');
              }}
            />
            Powtórzenia rutyn
          </label>
        )}
      </div>
      {view === 'month' && <MonthView day={day} today={today} routines={routines} onDay={(nd) => update({ day: nd })} />}
      {view === 'week' && <WeekView day={day} today={today} routines={routines} onDay={(nd) => update({ day: nd })} />}
      {view === 'list' && <Upcoming embedded />}
    </div>
  );
}
