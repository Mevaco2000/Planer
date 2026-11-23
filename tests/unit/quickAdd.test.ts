import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from '../../src/lib/quickAdd';

// sobota 14 listopada 2026, 10:30
const now = new Date(2026, 10, 14, 10, 30);
const projects = [
  { id: 'p-praca', name: 'Praca' },
  { id: 'p-dom', name: 'Dom i ogród' },
  { id: 'p-studia', name: 'Studia – semestr 5' },
];
const q = (s: string, disabled: Parameters<typeof parseQuickAdd>[3] = []) => parseQuickAdd(s, now, projects, disabled);

describe('szybkie dodawanie', () => {
  it('zwykły tekst zostaje tytułem', () => {
    expect(q('Kupić mleko')).toMatchObject({ title: 'Kupić mleko', due: null, time: null, priority: null, projectId: null, repeat: null, tokens: [] });
  });

  it('dziś, jutro, pojutrze – także z „na” i „do”', () => {
    expect(q('Kupić mleko dziś')).toMatchObject({ title: 'Kupić mleko', due: '2026-11-14' });
    expect(q('Raport na jutro')).toMatchObject({ title: 'Raport', due: '2026-11-15' });
    expect(q('Oddać książkę do jutra')).toMatchObject({ title: 'Oddać książkę', due: '2026-11-15' });
    expect(q('pojutrze odebrać paczkę')).toMatchObject({ title: 'odebrać paczkę', due: '2026-11-16' });
  });

  it('dni tygodnia – najbliższy (dziś też), „przyszły” = następny tydzień, bez polskich znaków', () => {
    expect(q('Spotkanie w poniedziałek').due).toBe('2026-11-16');
    expect(q('Spotkanie w poniedzialek').due).toBe('2026-11-16');
    expect(q('Prezentacja w piątek').due).toBe('2026-11-20');
    expect(q('Projekt do piątku').due).toBe('2026-11-20');
    expect(q('Sprzątanie w sobotę').due).toBe('2026-11-14');
    expect(q('Basen we wt').due).toBe('2026-11-17');
    // w sobotę „przyszły piątek” to piątek następnego tygodnia (20.11), tak jak „w piątek”
    expect(q('Kolokwium w przyszły piątek').due).toBe('2026-11-20');
    expect(parseQuickAdd('Kolokwium w przyszły piątek', new Date(2026, 10, 16, 9), projects).due).toBe('2026-11-27');
    expect(parseQuickAdd('Kolokwium w piątek', new Date(2026, 10, 16, 9), projects).due).toBe('2026-11-20');
    expect(q('Plan w przyszłym tygodniu')).toMatchObject({ title: 'Plan', due: '2026-11-16' });
  });

  it('daty liczbowe i słowne; bez roku – najbliższa przyszła', () => {
    expect(q('Rachunek 20.11').due).toBe('2026-11-20');
    expect(q('Rachunek na 3.12.2026').due).toBe('2026-12-03');
    expect(q('Rachunek 5.01').due).toBe('2027-01-05');
    expect(q('Urodziny Ani 3 grudnia').due).toBe('2026-12-03');
    expect(q('Egzamin 12 lut').due).toBe('2027-02-12');
    expect(q('Termin 2026-12-24').due).toBe('2026-12-24');
    // nieistniejąca data zostaje w tytule
    expect(q('Coś 31.11')).toMatchObject({ title: 'Coś 31.11', due: null });
  });

  it('„za N dni/tygodni/miesięcy”', () => {
    expect(q('Przegląd za 3 dni').due).toBe('2026-11-17');
    expect(q('Przegląd za tydzień').due).toBe('2026-11-21');
    expect(q('Przegląd za 2 tygodnie').due).toBe('2026-11-28');
    expect(q('Przegląd za miesiąc').due).toBe('2026-12-14');
    // „za” bez liczby i jednostki to zwykłe słowo
    expect(q('Zapłacić za prąd')).toMatchObject({ title: 'Zapłacić za prąd', due: null });
  });

  it('godziny: „o 18”, „o 9:30”, „18:00”, „o 10.12” (godzina, nie data), pory dnia', () => {
    expect(q('Dentysta jutro o 18')).toMatchObject({ title: 'Dentysta', due: '2026-11-15', time: '18:00' });
    expect(q('Dentysta jutro o 9:30').time).toBe('09:30');
    expect(q('Call 15:45 w poniedziałek')).toMatchObject({ title: 'Call', due: '2026-11-16', time: '15:45' });
    expect(q('Zebranie o 11.12')).toMatchObject({ title: 'Zebranie', due: '2026-11-14', time: '11:12' });
    expect(q('Bieganie rano jutro')).toMatchObject({ title: 'Bieganie', time: '08:00' });
    expect(q('Kino wieczorem').time).toBe('19:00');
  });

  it('sama godzina = dziś, a gdy już minęła – jutro', () => {
    expect(q('Zadzwonić o 18')).toMatchObject({ due: '2026-11-14', time: '18:00' });
    expect(q('Zadzwonić o 9')).toMatchObject({ due: '2026-11-15', time: '09:00' });
  });

  it('priorytet: !1, p2, „pilne”', () => {
    expect(q('Podatek !1')).toMatchObject({ title: 'Podatek', priority: 1 });
    expect(q('Podatek p2')).toMatchObject({ title: 'Podatek', priority: 2 });
    expect(q('Pilne: oddzwonić do szefa')).toMatchObject({ title: 'oddzwonić do szefa', priority: 1 });
  });

  it('projekt po #: dokładnie, po początku nazwy albo słowa; nieznany zostaje w tytule', () => {
    expect(q('Raport #praca')).toMatchObject({ title: 'Raport', projectId: 'p-praca' });
    expect(q('Skosić trawę #ogrod')).toMatchObject({ title: 'Skosić trawę', projectId: 'p-dom' });
    expect(q('Lista #stud')).toMatchObject({ projectId: 'p-studia' });
    expect(q('Tweet o #hashtagach')).toMatchObject({ title: 'Tweet o #hashtagach', projectId: null });
  });

  it('powtarzanie: codziennie, w dni robocze, co piątek, co miesiąc', () => {
    // 8:00 już minęła (jest 10:30) – pierwszy raz jutro
    expect(q('Witaminy codziennie rano')).toMatchObject({ title: 'Witaminy', repeat: 'daily', due: '2026-11-15', time: '08:00' });
    expect(q('Trening codziennie o 18')).toMatchObject({ title: 'Trening', repeat: 'daily', due: '2026-11-14', time: '18:00' });
    // sobota → najbliższy dzień roboczy to poniedziałek
    expect(q('Standup w dni robocze o 9:15')).toMatchObject({ title: 'Standup', repeat: 'weekdays', due: '2026-11-16', time: '09:15' });
    expect(q('Odkurzanie co piątek')).toMatchObject({ title: 'Odkurzanie', repeat: 'weekly', due: '2026-11-20' });
    expect(q('Czynsz co miesiąc 10.12')).toMatchObject({ title: 'Czynsz', repeat: 'monthly', due: '2026-12-10' });
  });

  it('rutyny: co N dni/tygodni/miesięcy, słownie i liczbą', () => {
    expect(q('Golenie co 2 dni')).toMatchObject({ title: 'Golenie', repeat: 'daily', every: 2, due: '2026-11-14' });
    expect(q('Golenie co drugi dzień rano')).toMatchObject({ title: 'Golenie', repeat: 'daily', every: 2, time: '08:00' });
    expect(q('Fryzjer co 2 tygodnie')).toMatchObject({ title: 'Fryzjer', repeat: 'weekly', every: 2 });
    expect(q('Fryzjer co dwa tygodnie')).toMatchObject({ title: 'Fryzjer', repeat: 'weekly', every: 2 });
    expect(q('Przegląd co 6 miesięcy')).toMatchObject({ title: 'Przegląd', repeat: 'monthly', every: 6 });
    expect(q('Ubezpieczenie co 2 lata')).toMatchObject({ title: 'Ubezpieczenie', repeat: 'yearly', every: 2 });
    expect(q('Fryzjer co 2 tygodnie').tokens[0].label).toBe('Co 2 tygodnie');
    // zwykłe „co” zostaje w tytule
    expect(q('Co kupić na obiad')).toMatchObject({ title: 'Co kupić na obiad', repeat: null });
  });

  it('rutyny w wybrane dni tygodnia – pierwszy raz w najbliższy z nich', () => {
    // sobota 14.11 → najbliższy z (pon, czw) to poniedziałek 16.11
    expect(q('Siłownia w poniedziałki i czwartki o 18')).toMatchObject({ title: 'Siłownia', repeat: 'weekly', repeatDays: [0, 3], due: '2026-11-16', time: '18:00' });
    expect(q('Basen co pon, śr, pt')).toMatchObject({ title: 'Basen', repeat: 'weekly', repeatDays: [0, 2, 4] });
    expect(q('Rower w soboty')).toMatchObject({ title: 'Rower', repeat: 'weekly', repeatDays: [5], due: '2026-11-14' });
    expect(q('Sprzątanie w weekendy')).toMatchObject({ title: 'Sprzątanie', repeat: 'weekly', repeatDays: [5, 6] });
    expect(q('Basen co pon, śr, pt').tokens[0].label).toBe('Co tydzień: pon, śr, pt');
    // „do soboty” to nadal termin, a „co piątek” – jeden dzień
    expect(q('Raport do soboty')).toMatchObject({ due: '2026-11-14', repeat: null });
    expect(q('Odkurzanie co piątek')).toMatchObject({ repeat: 'weekly', repeatDays: [], due: '2026-11-20' });
  });

  it('czas trwania: „przez 2h”, „1,5 h”, „45 min”, „1h30”, „półtorej godziny” – ale nie „za 30 min”', () => {
    expect(q('Siłownia o 18 przez 2h')).toMatchObject({ title: 'Siłownia', time: '18:00', duration: 120 });
    expect(q('Nauka 1,5 h jutro')).toMatchObject({ title: 'Nauka', duration: 90, due: '2026-11-15' });
    expect(q('Nauka 1.5h')).toMatchObject({ title: 'Nauka', duration: 90, due: null });
    expect(q('Spacer 45 min')).toMatchObject({ title: 'Spacer', duration: 45 });
    expect(q('Film 1h30 wieczorem')).toMatchObject({ title: 'Film', duration: 90, time: '19:00' });
    expect(q('Film 2 godz. 15 min')).toMatchObject({ title: 'Film', duration: 135 });
    expect(q('Sprzątanie przez półtorej godziny')).toMatchObject({ title: 'Sprzątanie', duration: 90 });
    expect(q('Wyjść za 30 min')).toMatchObject({ title: 'Wyjść za 30 min', duration: null });
  });

  it('wszystko naraz + rozpoznane fragmenty do podglądu', () => {
    const r = q('Raport kwartalny w piątek o 10 !1 #praca');
    expect(r).toMatchObject({ title: 'Raport kwartalny', due: '2026-11-20', time: '10:00', priority: 1, projectId: 'p-praca' });
    expect(r.tokens.map((t) => [t.kind, t.text, t.label])).toEqual([
      ['time', 'o 10', '10:00'],
      ['date', 'w piątek', 'pt 20.11'],
      ['priority', '!1', 'Pilne'],
      ['project', '#praca', 'Praca'],
    ]);
  });

  it('wyłączony rodzaj zostaje w tytule (np. „Jutro” jako nazwa)', () => {
    expect(q('Przeczytać „Jutro” jutro', ['date'])).toMatchObject({ title: 'Przeczytać „Jutro” jutro', due: null });
  });

  it('porządkuje interpunkcję po wycięciu fragmentów', () => {
    expect(q('Zadzwonić do mamy, jutro o 18')).toMatchObject({ title: 'Zadzwonić do mamy', due: '2026-11-15', time: '18:00' });
    expect(q('jutro – odebrać garnitur')).toMatchObject({ title: 'odebrać garnitur' });
  });
});
