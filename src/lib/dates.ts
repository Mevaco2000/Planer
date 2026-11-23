// Daty jako napisy RRRR-MM-DD w czasie lokalnym (bez przesunięć stref czasowych).
const pad = (n: number) => String(n).padStart(2, '0');

export const toISO = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function fromISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export const todayISO = (now = new Date()): string => toISO(now);

export const isISODate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && toISO(fromISO(s)) === s;

export const isTime = (s: unknown): s is string => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

export function addDays(s: string, n: number): string {
  const d = fromISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** Dodaje miesiące; 31 stycznia + 1 miesiąc = 28/29 lutego (ostatni dzień miesiąca). */
export function addMonths(s: string, n: number): string {
  const d = fromISO(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toISO(d);
}

export function diffDays(from: string, to: string): number {
  return Math.round((fromISO(to).getTime() - fromISO(from).getTime()) / 86400000);
}

/** 0 = poniedziałek … 6 = niedziela */
export const weekdayIndex = (s: string): number => (fromISO(s).getDay() + 6) % 7;

/** Najbliższy dzień tygodnia `wd` (0 = pon) od `from` włącznie. */
export function nextWeekday(from: string, wd: number): string {
  return addDays(from, (wd - weekdayIndex(from) + 7) % 7);
}

export const startOfWeek = (s: string): string => addDays(s, -weekdayIndex(s));

export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Chwila (ms) dla daty i godziny w czasie lokalnym. */
export function atTime(date: string, time: string): number {
  const d = fromISO(date);
  const [h, m] = time.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

export const nowTime = (now = new Date()): string => `${pad(now.getHours())}:${pad(now.getMinutes())}`;

/** „09:30” → 570 */
export function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** 570 → „09:30” (w obrębie doby; 1440 = „24:00” jako koniec dnia) */
export function timeOf(min: number): string {
  const m = Math.max(0, Math.min(1440, Math.round(min)));
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** 90 → „1 godz. 30 min”, 45 → „45 min”, 120 → „2 godz.” */
export function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (!h) return `${m} min`;
  return m ? `${h} godz. ${m} min` : `${h} godz.`;
}

/** Ile tygodni (pełnych, od poniedziałku) dzieli tydzień daty `a` od tygodnia daty `b`. */
export const weeksBetween = (a: string, b: string): number => Math.round(diffDays(startOfWeek(a), startOfWeek(b)) / 7);

export const WD_SHORT = ['pon', 'wt', 'śr', 'czw', 'pt', 'sob', 'nd'];
const MONTHS_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

export const fmtWeekday = (s: string): string => WD_SHORT[weekdayIndex(s)];

/** „Dziś”, „Jutro”, „Wczoraj”, „pt 21.11” (w ciągu tygodnia), „3 gru”, „3 gru 2027”. */
export function fmtDue(s: string, today: string): string {
  const d = diffDays(today, s);
  if (d === 0) return 'Dziś';
  if (d === 1) return 'Jutro';
  if (d === -1) return 'Wczoraj';
  const date = fromISO(s);
  if (d > 1 && d < 7) return `${fmtWeekday(s)} ${date.getDate()}.${pad(date.getMonth() + 1)}`;
  const year = date.getFullYear() !== fromISO(today).getFullYear() ? ` ${date.getFullYear()}` : '';
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}${year}`;
}

/** „sobota, 14 listopada” */
export function fmtLong(s: string): string {
  return fromISO(s).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
}
