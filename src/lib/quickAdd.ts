// Szybkie dodawanie po polsku: „Raport na piątek o 10 przez 2h !1 #praca co tydzień”
// → tytuł „Raport”, termin w piątek 10:00, 2 godziny, priorytet pilny, projekt Praca, powtarzanie co tydzień.
// Rozpoznany fragment znika z tytułu; każdy rodzaj (data, godzina…) jest brany tylko raz.
import type { Priority, Project, Repeat, Stage } from '../types';
import { addDays, addMonths, fmtDue, fmtDuration, fromISO, isISODate, nextWeekday, nowTime, startOfWeek, toISO } from './dates';
import { fold } from './format';
import { alignDue, MAX_EVERY, REPEAT_LABEL, repeatLabel, type RepeatRule } from './repeat';

export type TokenKind = 'date' | 'time' | 'duration' | 'priority' | 'project' | 'repeat';

export interface Token {
  kind: TokenKind;
  /** fragment z wpisanego tekstu */
  text: string;
  /** jak go zrozumieliśmy, np. „Jutro”, „18:00” */
  label: string;
}

export interface QuickAdd {
  title: string;
  due: string | null;
  time: string | null;
  /** czas trwania w minutach */
  duration: number | null;
  priority: Priority | null;
  projectId: string | null;
  /** etap projektu – „#projekt/etap” */
  stageId: string | null;
  repeat: Repeat | null;
  /** co ile jednostek (co 2 dni) */
  every: number;
  /** dni tygodnia dla powtarzania co tydzień (0 = pon) */
  repeatDays: number[];
  tokens: Token[];
}

const pad = (n: number) => String(n).padStart(2, '0');

// początek i koniec „słowa” w tekście bez polskich znaków
const B = '(?<=^|[\\s,;(])';
const E = '(?=$|[\\s,;:!?)]|\\.(?:\\s|$))';

const WD = '(poniedzialek|poniedzialku|pon|wtorek|wtorku|wt|srode|sroda|srody|sr|czwartek|czwartku|czw|piatek|piatku|pt|sobote|sobota|soboty|sob|niedziele|niedziela|niedzieli|niedz|nd)';

const wdIndex = (w: string): number =>
  w.startsWith('pon') ? 0 : w.startsWith('wt') ? 1 : w.startsWith('sr') ? 2 : w.startsWith('cz') ? 3 : w.startsWith('pi') || w === 'pt' ? 4 : w.startsWith('so') ? 5 : 6;

const WD_ACC = ['poniedziałek', 'wtorek', 'środę', 'czwartek', 'piątek', 'sobotę', 'niedzielę'];

const MONTHS = ['stycz', 'lut', 'mar', 'kwi', 'maj', 'czerw', 'lip', 'sierp', 'wrze', 'pazdz', 'listop', 'grud'];
const MONTH_RE = '(stycznia|sty|lutego|lut|marca|mar|kwietnia|kwi|maja|maj|czerwca|cze|lipca|lip|sierpnia|sie|wrzesnia|wrz|pazdziernika|paz|listopada|lis|grudnia|gru)';
const monthIndex = (m: string): number => {
  const short: Record<string, number> = { sty: 0, lut: 1, mar: 2, kwi: 3, maj: 4, cze: 5, lip: 6, sie: 7, wrz: 8, paz: 9, lis: 10, gru: 11 };
  return short[m] ?? MONTHS.findIndex((p) => m.startsWith(p));
};

export const PRIORITY_LABEL: Record<Priority, string> = { 1: 'Pilne', 2: 'Wysoki', 3: 'Średni', 4: 'Brak' };

// dni tygodnia także w liczbie mnogiej: „w poniedziałki i czwartki”
const WDP =
  '(?:poniedzialki|wtorki|srody|czwartki|piatki|soboty|niedziele|poniedzialek|poniedzialku|pon|wtorek|wtorku|wt|srode|sroda|sr|czwartek|czwartku|czw|piatek|piatku|pt|sobote|sobota|sob|niedziela|niedzieli|niedz|nd)';
const WDP_WORD = new RegExp(`^${WDP}$`);

// „co 2 dni”, „co drugi dzień”, „co trzy tygodnie”
const COUNT = '(\\d{1,3}|dwa|dwie|trzy|cztery|piec|szesc|drugi|druga|drugie|trzeci|trzecia|trzecie|czwarty|czwarta|czwarte)';
const COUNT_WORDS: Record<string, number> = {
  dwa: 2,
  dwie: 2,
  drugi: 2,
  druga: 2,
  drugie: 2,
  trzy: 3,
  trzeci: 3,
  trzecia: 3,
  trzecie: 3,
  cztery: 4,
  czwarty: 4,
  czwarta: 4,
  czwarte: 4,
  piec: 5,
  szesc: 6,
};

// „za 30 min” to nie czas trwania
const NOT_AFTER_ZA = '(?<!(?:^|\\s)za )';

interface Ctx {
  today: string;
  now: Date;
}

type Hit = { value: unknown; label: string; due?: string };

interface Rule {
  kind: TokenKind;
  re: string;
  run: (m: RegExpExecArray, c: Ctx) => Hit | null;
}

/** Data bez roku: najbliższa przyszła (15.01 wpisane w grudniu = styczeń przyszłego roku). */
function dayMonth(day: number, month: number, year: number | null, c: Ctx): string | null {
  const y = year ?? fromISO(c.today).getFullYear();
  const d = new Date(y, month, day);
  if (d.getMonth() !== month || d.getDate() !== day) return null;
  let iso = toISO(d);
  if (year === null && iso < c.today) iso = toISO(new Date(y + 1, month, day));
  return iso;
}

const date = (iso: string | null, c: Ctx): Hit | null => (iso ? { value: iso, label: fmtDue(iso, c.today) } : null);

const time = (h: number, m: number): Hit | null => (h <= 23 && m <= 59 ? { value: `${pad(h)}:${pad(m)}`, label: `${pad(h)}:${pad(m)}` } : null);

const NUM_WORDS: Record<string, number> = { jeden: 1, dwa: 2, trzy: 3, cztery: 4, piec: 5 };

type RepeatHit = Pick<RepeatRule, 'repeat'> & Partial<Pick<RepeatRule, 'every' | 'repeatDays'>>;

const rep = (value: RepeatHit, label = repeatLabel(value, null), due?: string): Hit => ({ value, label, due });

/** Powtarzanie w wybrane dni tygodnia – pierwszy raz w najbliższy z nich. */
function weekDays(days: number[], c: Ctx): Hit | null {
  const uniq = [...new Set(days)].sort((a, b) => a - b);
  if (!uniq.length) return null;
  const first = uniq.map((d) => nextWeekday(c.today, d)).sort()[0];
  return rep({ repeat: 'weekly', repeatDays: uniq }, undefined, first);
}

const duration = (min: number): Hit | null => (min >= 5 && min <= 1440 ? { value: min, label: fmtDuration(min) } : null);

const RULES: Rule[] = [
  // ---------- powtarzanie (przed datami: „co piątek” to nie „piątek”) ----------
  {
    kind: 'repeat',
    re: `co ${COUNT} (dni|dzien|tygodnie|tygodni|tydzien|tyg\\.?|miesiace|miesiecy|miesiac|mies\\.?|lata|lat|rok)`,
    run: (m) => {
      const n = COUNT_WORDS[m[1]] ?? Number(m[1]);
      if (!n || n > MAX_EVERY) return null;
      const u = m[2];
      return rep({ repeat: u.startsWith('d') ? 'daily' : u.startsWith('t') ? 'weekly' : u.startsWith('m') ? 'monthly' : 'yearly', every: n });
    },
  },
  { kind: 'repeat', re: '(codziennie|co dzien|kazdego dnia)', run: () => rep({ repeat: 'daily' }) },
  { kind: 'repeat', re: '((?:w )?dni robocze|w dni powszednie|co dzien roboczy)', run: () => rep({ repeat: 'weekdays' }) },
  { kind: 'repeat', re: '(?:(?:w )?weekendy|(?:co|w kazdy) weekend)', run: (_m, c) => weekDays([5, 6], c) },
  {
    // „w poniedziałki i czwartki”, „co pon, śr, pt”
    kind: 'repeat',
    re: `(?:co|w kazdy|w kazda|w kazde|w|we) ${WDP}(?:(?:,? (?:i|oraz) |, ?)${WDP})+`,
    run: (m, c) =>
      weekDays(
        m[0]
          .split(/[\s,]+/)
          .filter((w) => WDP_WORD.test(w))
          .map(wdIndex),
        c,
      ),
  },
  // „w piątki” (ale „w niedzielę” i „w niedziele” piszą się bez polskich znaków tak samo – to zostaje datą)
  { kind: 'repeat', re: '(?:w|we|co) (poniedzialki|wtorki|srody|czwartki|piatki|soboty)', run: (m, c) => weekDays([wdIndex(m[1])], c) },
  {
    kind: 'repeat',
    re: `(?:co|w kazdy|w kazda|w kazde) ${WD}`,
    run: (m, c) => {
      const wd = wdIndex(m[1]);
      return rep({ repeat: 'weekly' }, `Co ${WD_ACC[wd]}`, nextWeekday(c.today, wd));
    },
  },
  { kind: 'repeat', re: '(co tydzien|co tydz\\.?|cotygodniowo|raz w tygodniu)', run: () => rep({ repeat: 'weekly' }, REPEAT_LABEL.weekly) },
  { kind: 'repeat', re: '(co miesiac|comiesiecznie|raz w miesiacu)', run: () => rep({ repeat: 'monthly' }, REPEAT_LABEL.monthly) },
  { kind: 'repeat', re: '(co rok|co roku|corocznie|raz w roku)', run: () => rep({ repeat: 'yearly' }, REPEAT_LABEL.yearly) },

  // ---------- czas trwania (przed datami: „1.5 h” to nie 1 maja) ----------
  { kind: 'duration', re: `${NOT_AFTER_ZA}(?:przez |na )?(\\d{1,2})h(\\d{2})`, run: (m) => duration(Number(m[1]) * 60 + Number(m[2])) },
  {
    kind: 'duration',
    re: `${NOT_AFTER_ZA}(?:przez |na )?(\\d{1,2}) ?(?:h|godz\\.?) (\\d{1,2}) ?(?:min|minut)`,
    run: (m) => duration(Number(m[1]) * 60 + Number(m[2])),
  },
  {
    kind: 'duration',
    re: `${NOT_AFTER_ZA}(?:przez |na )?(\\d{1,2})(?:[.,](\\d))? ?(?:h|godz\\.?|godzin[ay]?|godzine)`,
    run: (m) => duration(Number(m[1]) * 60 + (m[2] ? Number(m[2]) * 6 : 0)),
  },
  { kind: 'duration', re: `${NOT_AFTER_ZA}(?:przez |na )?(?:poltorej godziny|poltora godziny)`, run: () => duration(90) },
  { kind: 'duration', re: `${NOT_AFTER_ZA}(?:przez |na )?(\\d{1,3}) ?(?:min|minut[ey]?)`, run: (m) => duration(Number(m[1])) },

  // „o 10.30” to godzina – przed datami, żeby „10.12” po „o” nie zostało wzięte za 10 grudnia
  {
    kind: 'time',
    re: `(?:o godzinie|o godz\\.?|godz\\.?|o) (\\d{1,2})(?:[:.](\\d{2}))?(?! ${MONTH_RE})`,
    run: (m) => time(Number(m[1]), Number(m[2] ?? 0)),
  },

  // ---------- daty ----------
  { kind: 'date', re: '(?:na |do |od )?(?:dzis|dzisiaj)', run: (_m, c) => date(c.today, c) },
  { kind: 'date', re: '(?:na |od )?pojutrze|do pojutrza', run: (_m, c) => date(addDays(c.today, 2), c) },
  { kind: 'date', re: '(?:na |od )?jutro|do jutra', run: (_m, c) => date(addDays(c.today, 1), c) },
  {
    kind: 'date',
    re: 'za (?:(\\d{1,3}|jeden|dwa|trzy|cztery|piec) (dni|dzien|tygodnie|tygodni|tydzien|miesiace|miesiecy|miesiac)|(tydzien|miesiac))',
    run: (m, c) => {
      const n = m[1] ? (NUM_WORDS[m[1]] ?? Number(m[1])) : 1;
      const unit = m[2] ?? m[3];
      if (unit.startsWith('mies')) return date(addMonths(c.today, n), c);
      return date(addDays(c.today, unit.startsWith('ty') ? n * 7 : n), c);
    },
  },
  {
    kind: 'date',
    re: '(?:w|od) (?:przyszlym|nastepnym) tygodniu|(?:w|od) przyszly tydzien',
    run: (_m, c) => date(addDays(startOfWeek(c.today), 7), c),
  },
  {
    kind: 'date',
    re: `(?:(?:w|we|na|do|od) )?(?:(ten|ta|najblizszy|najblizsza|przyszly|przyszla|przyszla) )?${WD}`,
    run: (m, c) => {
      const wd = wdIndex(m[2]);
      // „w przyszły piątek” = piątek następnego tygodnia
      if (m[1]?.startsWith('przysz')) return date(addDays(startOfWeek(c.today), 7 + wd), c);
      return date(nextWeekday(c.today, wd), c);
    },
  },
  { kind: 'date', re: '(?:(?:na|do|od) )?(\\d{4}-\\d{2}-\\d{2})', run: (m, c) => date(isISODate(m[1]) ? m[1] : null, c) },
  {
    kind: 'date',
    re: '(?:(?:na|do|od) )?(\\d{1,2})\\.(\\d{1,2})(?:\\.(\\d{4}|\\d{2}))?(?!\\d)',
    run: (m, c) => {
      const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null;
      return date(dayMonth(Number(m[1]), Number(m[2]) - 1, y, c), c);
    },
  },
  {
    kind: 'date',
    re: `(?:(?:na|do|od) )?(\\d{1,2}) ${MONTH_RE}(?: (\\d{4}))?`,
    run: (m, c) => date(dayMonth(Number(m[1]), monthIndex(m[2]), m[3] ? Number(m[3]) : null, c), c),
  },

  // ---------- godzina ----------
  { kind: 'time', re: '(\\d{1,2}):(\\d{2})', run: (m) => time(Number(m[1]), Number(m[2])) },
  { kind: 'time', re: 'rano', run: () => time(8, 0) },
  { kind: 'time', re: 'w poludnie', run: () => time(12, 0) },
  { kind: 'time', re: 'po poludniu', run: () => time(15, 0) },
  { kind: 'time', re: 'wieczorem', run: () => time(19, 0) },

  // ---------- priorytet ----------
  { kind: 'priority', re: '(?:!|p)([1-4])', run: (m) => ({ value: Number(m[1]), label: PRIORITY_LABEL[Number(m[1]) as Priority] }) },
  { kind: 'priority', re: '(?:pilne|pilnie)', run: () => ({ value: 1, label: PRIORITY_LABEL[1] }) },
];

/** Projekt po „#nazwa”: dokładnie, a potem po początku nazwy albo któregoś jej słowa (#dom → „Dom i ogród”). */
function findProject(token: string, projects: Pick<Project, 'id' | 'name'>[]): Pick<Project, 'id' | 'name'> | null {
  const t = token.replace(/[-_]/g, ' ');
  const keyed = projects.map((p) => ({ p, k: fold(p.name) }));
  return (
    keyed.find(({ k }) => k === t || k.replace(/\s+/g, '') === t.replace(/\s+/g, ''))?.p ??
    keyed.find(({ k }) => k.startsWith(t))?.p ??
    keyed.find(({ k }) => k.split(/\s+/).some((w) => w.startsWith(t)))?.p ??
    null
  );
}

export function parseQuickAdd(
  input: string,
  now: Date,
  projects: Pick<Project, 'id' | 'name'>[],
  disabled: TokenKind[] = [],
  stages: Pick<Stage, 'id' | 'name' | 'projectId'>[] = [],
): QuickAdd {
  const c: Ctx = { today: toISO(now), now };
  let text = input;
  let folded = fold(input);
  const out: QuickAdd = { title: '', due: null, time: null, duration: null, priority: null, projectId: null, stageId: null, repeat: null, every: 1, repeatDays: [], tokens: [] };
  const taken = new Set<TokenKind>(disabled);

  const cut = (index: number, length: number) => {
    const piece = text.slice(index, index + length);
    text = `${text.slice(0, index)} ${text.slice(index + length)}`;
    folded = `${folded.slice(0, index)} ${folded.slice(index + length)}`;
    return piece.trim();
  };

  for (const rule of RULES) {
    if (taken.has(rule.kind)) continue;
    const m = new RegExp(`${B}(?:${rule.re})${E}`).exec(folded);
    if (!m) continue;
    const hit = rule.run(m, c);
    if (!hit) continue;
    const piece = cut(m.index, m[0].length);
    taken.add(rule.kind);
    if (rule.kind === 'repeat') {
      const r = hit.value as RepeatHit;
      out.repeat = r.repeat;
      out.every = r.every ?? 1;
      out.repeatDays = r.repeatDays ?? [];
      // „co piątek” ustala też termin, jeśli nie podano innego
      if (hit.due && !taken.has('date')) {
        out.due = hit.due;
        taken.add('date');
      }
    } else if (rule.kind === 'date') out.due = hit.value as string;
    else if (rule.kind === 'time') out.time = hit.value as string;
    else if (rule.kind === 'duration') out.duration = hit.value as number;
    else if (rule.kind === 'priority') out.priority = hit.value as Priority;
    out.tokens.push({ kind: rule.kind, text: piece, label: hit.label });
  }

  if (!taken.has('project')) {
    // „#praca” albo „#praca/odbior” – projekt i etap
    const re = new RegExp(`${B}#([a-z0-9_-]+)(?:/([a-z0-9_-]+))?${E}`, 'g');
    for (let m = re.exec(folded); m; m = re.exec(folded)) {
      const p = findProject(m[1], projects);
      if (!p) continue;
      const s = m[2] ? findProject(m[2], stages.filter((x) => x.projectId === p.id)) : null;
      out.projectId = p.id;
      out.stageId = s?.id ?? null;
      out.tokens.push({ kind: 'project', text: cut(m.index, m[0].length), label: s ? `${p.name} › ${s.name}` : p.name });
      break;
    }
  }

  // sama godzina = dziś (a gdy ta godzina już minęła – jutro); samo powtarzanie = od dziś
  if (out.time && !out.due) out.due = out.time > nowTime(now) ? c.today : addDays(c.today, 1);
  if (out.repeat && !out.due) out.due = c.today;
  // „w dni robocze” zaczyna się w dzień roboczy, „w pon i czw” – w najbliższy z tych dni
  if (out.repeat && out.due) out.due = alignDue(out.due, { repeat: out.repeat, repeatDays: out.repeatDays });

  out.title = text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim()
    .replace(/^[,;:–-]+\s*|\s*[,;:–-]+$/g, '')
    .trim();
  return out;
}
