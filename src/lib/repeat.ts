// Powtarzanie i rutyny: „co 2 dni”, „co 2 tygodnie od zrobienia”, „w pon, śr, pt”, „co 3 miesiące”.
import type { Repeat, RepeatFrom, Task } from '../types';
import { addDays, addMonths, diffDays, fmtWeekday, fromISO, WD_SHORT, weekdayIndex, weeksBetween } from './dates';
import { plural } from './format';

export const REPEAT_LABEL: Record<Repeat, string> = {
  daily: 'Codziennie',
  weekdays: 'W dni robocze',
  weekly: 'Co tydzień',
  monthly: 'Co miesiąc',
  yearly: 'Co rok',
};

export interface RepeatRule {
  repeat: Repeat;
  every: number;
  repeatDays: number[];
  repeatFrom: RepeatFrom;
}

export type RuleLike = Repeat | (Pick<RepeatRule, 'repeat'> & Partial<RepeatRule>);

export const MAX_EVERY = 365;

/** Reguła z poprawionymi wartościami: „co 0 dni” = co 1, dni tygodnia tylko dla „co tydzień” liczonego od terminu. */
export function ruleOf(r: RuleLike): RepeatRule {
  const base = typeof r === 'string' ? { repeat: r } : r;
  const repeat = base.repeat;
  const raw = Math.floor(base.every ?? 1);
  const every = repeat === 'weekdays' || !Number.isFinite(raw) ? 1 : Math.min(MAX_EVERY, Math.max(1, raw));
  const repeatFrom: RepeatFrom = base.repeatFrom === 'done' ? 'done' : 'due';
  const repeatDays =
    repeat === 'weekly' && repeatFrom === 'due'
      ? [...new Set(base.repeatDays ?? [])].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b)
      : [];
  return { repeat, every, repeatDays, repeatFrom };
}

const UNITS: Record<Exclude<Repeat, 'weekdays'>, [string, string, string]> = {
  daily: ['dzień', 'dni', 'dni'],
  weekly: ['tydzień', 'tygodnie', 'tygodni'],
  monthly: ['miesiąc', 'miesiące', 'miesięcy'],
  yearly: ['rok', 'lata', 'lat'],
};

/** „dni”, „tygodnie”, „miesięcy”… – jednostka po „co N”. */
export const unitLabel = (repeat: Exclude<Repeat, 'weekdays'>, n: number): string => plural(n, ...UNITS[repeat]);

const nextWorkday = (d: string): string => {
  while (weekdayIndex(d) > 4) d = addDays(d, 1);
  return d;
};

/**
 * Następny termin zadania powtarzanego.
 * Od terminu: pierwszy w rytmie po dzisiejszym dniu i po dotychczasowym terminie (bez „nadrabiania” zaległych).
 * Od zrobienia: odstęp liczony od dziś (dnia odhaczenia).
 */
export function nextDue(due: string, rule: RuleLike, today: string): string {
  const r = ruleOf(rule);
  const n = r.every;
  if (r.repeatFrom === 'done') {
    switch (r.repeat) {
      case 'daily':
        return addDays(today, n);
      case 'weekly':
        return addDays(today, 7 * n);
      case 'monthly':
        return addMonths(today, n);
      case 'yearly':
        return addMonths(today, 12 * n);
      case 'weekdays':
        return nextWorkday(addDays(today, 1));
    }
  }
  const floor = due > today ? due : today;
  if (r.repeat === 'monthly' || r.repeat === 'yearly') {
    // zawsze od pierwotnego terminu – 31 sty → 28 lut → 31 mar (bez „zjeżdżania” na 28.)
    const step = (r.repeat === 'monthly' ? 1 : 12) * n;
    for (let k = 1; k < 5000; k++) {
      const d = addMonths(due, k * step);
      if (d > floor) return d;
    }
    return addMonths(floor, step);
  }
  if (r.repeat === 'weekly' && r.repeatDays.length) {
    // wybrane dni tygodnia; „co 2 tygodnie” liczone od tygodnia obecnego terminu
    let d = addDays(floor, 1);
    for (let i = 0; i < 7 * n + 7; i++, d = addDays(d, 1)) {
      if (r.repeatDays.includes(weekdayIndex(d)) && weeksBetween(due, d) % n === 0) return d;
    }
    return d;
  }
  const step = r.repeat === 'weekly' ? 7 * n : r.repeat === 'daily' ? n : 1;
  const k = Math.floor(diffDays(due, floor) / step) + 1;
  const d = addDays(due, k * step);
  return r.repeat === 'weekdays' ? nextWorkday(d) : d;
}

/** Termin zgodny z regułą: dla „w dni robocze” i wybranych dni tygodnia – najbliższy pasujący dzień od `due` włącznie. */
export function alignDue(due: string, rule: RuleLike): string {
  const r = ruleOf(rule);
  if (r.repeat === 'weekdays') return nextWorkday(due);
  if (r.repeat === 'weekly' && r.repeatDays.length) {
    let d = due;
    for (let i = 0; i < 7; i++, d = addDays(d, 1)) if (r.repeatDays.includes(weekdayIndex(d))) return d;
  }
  return due;
}

type RepeatFields = Pick<Task, 'due' | 'repeat' | 'every' | 'repeatDays' | 'repeatFrom'>;

/** Czy zadanie powtarzane wypada w dniu `day` późniejszym niż jego termin – podgląd przyszłych dni w planie. */
export function occursOn(t: RepeatFields, day: string): boolean {
  if (!t.repeat || !t.due || day <= t.due) return false;
  // przyszłe powtórzenia „od zrobienia” to tylko przybliżenie – zakładamy, że zrobisz w terminie
  const rule: RepeatRule = { ...ruleOf({ ...t, repeat: t.repeat, repeatFrom: 'due' }) };
  let d = t.due;
  for (let i = 0; i < 1000 && d < day; i++) d = nextDue(d, rule, d);
  return d === day;
}

/** „Codziennie”, „Co 2 dni”, „Co 2 tygodnie (pt)”, „Co tydzień: pon, śr, pt”, „Co 3 miesiące (15.)”, „… od zrobienia”. */
export function repeatLabel(rule: RuleLike, due: string | null): string {
  const r = ruleOf(rule);
  const n = r.every;
  let s: string;
  switch (r.repeat) {
    case 'weekdays':
      s = REPEAT_LABEL.weekdays;
      break;
    case 'daily':
      s = n === 1 ? REPEAT_LABEL.daily : `Co ${n} dni`;
      break;
    case 'weekly': {
      const head = n === 1 ? REPEAT_LABEL.weekly : `Co ${n} ${unitLabel('weekly', n)}`;
      if (r.repeatDays.length === 7 && n === 1) s = REPEAT_LABEL.daily;
      else if (r.repeatDays.length) s = `${head}: ${r.repeatDays.map((d) => WD_SHORT[d]).join(', ')}`;
      else s = due && r.repeatFrom === 'due' ? `${head} (${fmtWeekday(due)})` : head;
      break;
    }
    case 'monthly': {
      const head = n === 1 ? REPEAT_LABEL.monthly : `Co ${n} ${unitLabel('monthly', n)}`;
      s = due && r.repeatFrom === 'due' ? `${head} (${fromISO(due).getDate()}.)` : head;
      break;
    }
    case 'yearly':
      s = n === 1 ? REPEAT_LABEL.yearly : `Co ${n} ${unitLabel('yearly', n)}`;
      break;
  }
  return r.repeatFrom === 'done' ? `${s} od zrobienia` : s;
}

/** Opis powtarzania zadania; pusty, gdy zadanie się nie powtarza. */
export const taskRepeatLabel = (t: RepeatFields): string => (t.repeat ? repeatLabel({ ...t, repeat: t.repeat }, t.due) : '');
