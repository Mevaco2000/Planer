import { describe, expect, it } from 'vitest';
import { addMonths, fmtDue } from '../../src/lib/dates';
import { normSettings, normTask } from '../../src/lib/norm';
import {
  blankTask,
  blockedSteps,
  compareTasks,
  completionPatch,
  isOverdue,
  layoutDay,
  nextDue,
  occursOn,
  reminderAt,
  reorder,
  repeatLabel,
  skipPatch,
  statusPatch,
  timePatch,
  upcomingReminders,
} from '../../src/lib/tasks';
import type { Project, Task } from '../../src/types';

const base: Task = blankTask('t', 1, { title: 'Zadanie' });
const task = (p: Partial<Task>): Task => ({ ...base, ...p });
const today = '2026-11-14'; // sobota

describe('daty', () => {
  it('opis terminu względem dziś', () => {
    expect(fmtDue('2026-11-14', today)).toBe('Dziś');
    expect(fmtDue('2026-11-15', today)).toBe('Jutro');
    expect(fmtDue('2026-11-13', today)).toBe('Wczoraj');
    expect(fmtDue('2026-11-18', today)).toBe('śr 18.11');
    expect(fmtDue('2026-12-03', today)).toBe('3 gru');
    expect(fmtDue('2027-01-05', today)).toBe('5 sty 2027');
  });

  it('miesiąc później bez przeskoku na kolejny miesiąc', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
  });
});

describe('kolejność i zaległe', () => {
  it('termin → godzina (bez godziny na końcu dnia) → priorytet; bez terminu na końcu', () => {
    const list = [
      task({ id: 'brak', due: null, priority: 1 }),
      task({ id: 'jutro', due: '2026-11-15' }),
      task({ id: 'dzis-bez', due: today, priority: 1 }),
      task({ id: 'dzis-18', due: today, time: '18:00' }),
      task({ id: 'dzis-9', due: today, time: '09:00', priority: 3 }),
      task({ id: 'dzis-bez-p3', due: today, priority: 3 }),
    ].sort(compareTasks);
    expect(list.map((t) => t.id)).toEqual(['dzis-9', 'dzis-18', 'dzis-bez', 'dzis-bez-p3', 'jutro', 'brak']);
  });

  it('zaległe = termin przed dziś i nie zrobione', () => {
    expect(isOverdue(task({ due: '2026-11-13' }), today)).toBe(true);
    expect(isOverdue(task({ due: today }), today)).toBe(false);
    expect(isOverdue(task({ due: '2026-11-13', completedAt: 5 }), today)).toBe(false);
  });
});

describe('powtarzanie', () => {
  it('następny termin – po dziś i po dotychczasowym terminie', () => {
    expect(nextDue(today, 'daily', today)).toBe('2026-11-15');
    // zaległe codzienne: od jutra, bez „nadrabiania” zaległych dni
    expect(nextDue('2026-11-10', 'daily', today)).toBe('2026-11-15');
    // odhaczone przed terminem: kolejny termin po obecnym
    expect(nextDue('2026-11-20', 'weekly', today)).toBe('2026-11-27');
    expect(nextDue('2026-11-13', 'weekly', today)).toBe('2026-11-20');
    // piątek → poniedziałek, sobota (dziś) → poniedziałek
    expect(nextDue('2026-11-13', 'weekdays', today)).toBe('2026-11-16');
    expect(nextDue('2026-01-31', 'monthly', '2026-01-31')).toBe('2026-02-28');
    expect(nextDue('2026-10-10', 'monthly', today)).toBe('2026-12-10');
    expect(nextDue('2026-02-01', 'yearly', today)).toBe('2027-02-01');
  });

  it('odhaczenie: powtarzane dostaje nowy termin i czyste podzadania, zwykłe staje się zrobione', () => {
    const r = task({ due: today, repeat: 'daily', subtasks: [{ id: 'a', title: 'x', done: true }], doneCount: 2 });
    expect(completionPatch(r, 100, today)).toEqual({
      due: '2026-11-15',
      status: 'todo',
      completedAt: null,
      lastDone: 100,
      doneCount: 3,
      subtasks: [{ id: 'a', title: 'x', done: false }],
    });
    expect(completionPatch(task({ due: today }), 100, today)).toEqual({ status: 'done', completedAt: 100, lastDone: 100 });
    // powtarzanie bez terminu nie ma od czego liczyć – zwykłe odhaczenie
    expect(completionPatch(task({ repeat: 'daily' }), 100, today)).toEqual({ status: 'done', completedAt: 100, lastDone: 100 });
  });

  it('co N dni / tygodni / miesięcy – rytm od terminu, bez nadrabiania', () => {
    // co 2 dni od 10.11: 12, 14 (dziś – już nie), 16
    expect(nextDue('2026-11-10', { repeat: 'daily', every: 2 }, today)).toBe('2026-11-16');
    expect(nextDue(today, { repeat: 'daily', every: 2 }, today)).toBe('2026-11-16');
    expect(nextDue('2026-11-13', { repeat: 'weekly', every: 2 }, today)).toBe('2026-11-27');
    expect(nextDue('2026-01-31', { repeat: 'monthly', every: 3 }, '2026-01-31')).toBe('2026-04-30');
    expect(nextDue('2026-02-01', { repeat: 'yearly', every: 2 }, today)).toBe('2028-02-01');
  });

  it('od zrobienia: odstęp liczony od dnia odhaczenia (np. fryzjer 2 tyg. po wizycie)', () => {
    // termin był w czwartek 12.11, poszedłem dziś (sobota) – następny raz za 2 tygodnie od dziś
    expect(nextDue('2026-11-12', { repeat: 'weekly', every: 2, repeatFrom: 'done' }, today)).toBe('2026-11-28');
    // zrobione przed terminem – też od dziś
    expect(nextDue('2026-11-20', { repeat: 'daily', every: 2, repeatFrom: 'done' }, today)).toBe('2026-11-16');
    expect(nextDue('2026-11-01', { repeat: 'monthly', every: 1, repeatFrom: 'done' }, today)).toBe('2026-12-14');
  });

  it('wybrane dni tygodnia, także co 2 tygodnie', () => {
    const monThu = { repeat: 'weekly' as const, repeatDays: [0, 3] };
    // pon 16.11 → czw 19.11 → pon 23.11
    expect(nextDue('2026-11-16', monThu, '2026-11-16')).toBe('2026-11-19');
    expect(nextDue('2026-11-19', monThu, '2026-11-19')).toBe('2026-11-23');
    // zaległe z poniedziałku 9.11, dziś sobota 14.11 → najbliższy pon 16.11
    expect(nextDue('2026-11-09', monThu, today)).toBe('2026-11-16');
    // co 2 tygodnie w pon i czw: pon 16.11 → czw 19.11 → pon 30.11 (tydzień 23.11 pominięty)
    const biweekly = { ...monThu, every: 2 };
    expect(nextDue('2026-11-16', biweekly, '2026-11-16')).toBe('2026-11-19');
    expect(nextDue('2026-11-19', biweekly, '2026-11-19')).toBe('2026-11-30');
  });

  it('podgląd przyszłych powtórzeń w planie dnia', () => {
    const shave = task({ due: today, repeat: 'daily', every: 2 });
    expect(occursOn(shave, '2026-11-15')).toBe(false);
    expect(occursOn(shave, '2026-11-16')).toBe(true);
    expect(occursOn(shave, '2026-11-30')).toBe(true);
    expect(occursOn(shave, today)).toBe(false); // w dniu terminu to zwykłe zadanie, nie podgląd
    const gym = task({ due: '2026-11-16', repeat: 'weekly', repeatDays: [0, 3], every: 2 });
    expect(['2026-11-19', '2026-11-23', '2026-11-26', '2026-11-30'].map((d) => occursOn(gym, d))).toEqual([true, false, false, true]);
  });

  it('pominięcie rutyny przesuwa termin bez liczenia jako zrobione', () => {
    expect(skipPatch(task({ due: today, repeat: 'daily', every: 2, doneCount: 4 }), today)).toEqual({ due: '2026-11-16' });
    expect(skipPatch(task({ due: today }), today)).toEqual({});
  });

  it('opis powtarzania', () => {
    expect(repeatLabel('daily', today)).toBe('Codziennie');
    expect(repeatLabel({ repeat: 'daily', every: 2 }, today)).toBe('Co 2 dni');
    expect(repeatLabel({ repeat: 'weekly', every: 2 }, '2026-11-20')).toBe('Co 2 tygodnie (pt)');
    expect(repeatLabel({ repeat: 'weekly', every: 5 }, null)).toBe('Co 5 tygodni');
    expect(repeatLabel({ repeat: 'weekly', repeatDays: [0, 2, 4] }, today)).toBe('Co tydzień: pon, śr, pt');
    expect(repeatLabel({ repeat: 'monthly', every: 3 }, '2026-11-15')).toBe('Co 3 miesiące (15.)');
    expect(repeatLabel({ repeat: 'weekly', every: 2, repeatFrom: 'done' }, today)).toBe('Co 2 tygodnie od zrobienia');
  });

  it('zmiana statusu na tablicy', () => {
    expect(statusPatch(task({}), 'doing', 100, today)).toEqual({ status: 'doing', completedAt: null });
    expect(statusPatch(task({}), 'done', 100, today)).toEqual({ status: 'done', completedAt: 100, lastDone: 100 });
    expect(statusPatch(task({ status: 'done', completedAt: 50 }), 'todo', 100, today)).toEqual({ status: 'todo', completedAt: null });
    expect(statusPatch(task({ status: 'done', completedAt: 50 }), 'done', 100, today)).toEqual({});
  });
});

describe('przypomnienia', () => {
  const settings = { morningHour: 9, defaultRemind: 0, remindersOn: true };

  it('z godziną – minuty przed; bez godziny – o porannej godzinie; bez terminu albo zrobione – brak', () => {
    expect(reminderAt(task({ due: today, time: '18:00', remind: 30 }), settings)).toBe(new Date(2026, 10, 14, 17, 30).getTime());
    expect(reminderAt(task({ due: today, remind: 0 }), settings)).toBe(new Date(2026, 10, 14, 9, 0).getTime());
    expect(reminderAt(task({ due: today, remind: 1440 }), settings)).toBe(new Date(2026, 10, 13, 9, 0).getTime());
    expect(reminderAt(task({ remind: 0 }), settings)).toBeNull();
    expect(reminderAt(task({ due: today, time: '18:00', remind: null }), settings)).toBeNull();
    expect(reminderAt(task({ due: today, time: '18:00', remind: 0, completedAt: 1 }), settings)).toBeNull();
  });

  it('lista dla Workera: tylko przyszłe (do 60 dni), z opisem terminu i projektu', () => {
    const now = new Date(2026, 10, 14, 10, 30).getTime();
    const projects = new Map<string, Project>([['p', { id: 'p', name: 'Praca', color: '#000000', order: 0, createdAt: 0, groupId: null, sequential: false }]]);
    const list = upcomingReminders(
      [
        task({ id: 'a', title: 'Raport', due: today, time: '18:00', remind: 0, projectId: 'p' }),
        task({ id: 'b', title: 'Minęło', due: today, time: '08:00', remind: 0 }),
        task({ id: 'c', title: 'Jutro rano', due: '2026-11-15', remind: 0 }),
        task({ id: 'd', title: 'Za daleko', due: '2027-03-01', remind: 0 }),
      ],
      projects,
      settings,
      now,
      today,
    );
    expect(list.map((r) => [r.taskId, r.body])).toEqual([
      ['a', 'Dziś 18:00 · Praca'],
      ['c', 'Jutro'],
    ]);
  });
});

describe('plan dnia', () => {
  it('ustawienie godziny – nowa godzina dostaje domyślne przypomnienie, zdjęcie godziny – przypomnienie rano', () => {
    expect(timePatch(task({ due: today }), today, '14:00', { defaultRemind: 10 })).toEqual({ due: today, time: '14:00', remind: 10 });
    expect(timePatch(task({ due: today, time: '09:00', remind: 30 }), '2026-11-15', '14:00', { defaultRemind: 10 })).toEqual({ due: '2026-11-15', time: '14:00', remind: 30 });
    expect(timePatch(task({ due: today, time: '09:00', remind: 30 }), today, null, { defaultRemind: 10 })).toEqual({ due: today, time: null, remind: 0 });
  });

  it('nachodzące bloki stają obok siebie', () => {
    const r = layoutDay([
      { start: 540, end: 600 }, // 9:00–10:00
      { start: 570, end: 630 }, // 9:30–10:30 – nachodzi
      { start: 600, end: 660 }, // 10:00–11:00 – nachodzi na drugi, mieści się w kolumnie pierwszego
      { start: 720, end: 750 }, // 12:00 – osobno
    ]);
    expect(r).toEqual([
      { col: 0, cols: 2 },
      { col: 1, cols: 2 },
      { col: 0, cols: 2 },
      { col: 0, cols: 1 },
    ]);
  });
});

describe('kroki projektu', () => {
  const steps = [
    { id: 'a', order: 1024 },
    { id: 'b', order: 2048 },
    { id: 'c', order: 3072 },
  ];

  it('przeniesienie zmienia tylko przeniesiony krok', () => {
    expect(reorder(steps, 'c', 'a', false)).toEqual([{ id: 'c', order: 0 }]);
    expect(reorder(steps, 'a', 'b', true)).toEqual([{ id: 'a', order: 2560 }]);
    expect(reorder(steps, 'a', 'c', true)).toEqual([{ id: 'a', order: 4096 }]);
    expect(reorder(steps, 'b', 'a', true)).toEqual([]); // już tam jest
  });

  it('gdy brakuje miejsca między sąsiadami – numeracja od nowa', () => {
    const tight = [
      { id: 'a', order: 1 },
      { id: 'b', order: 1.0001 },
      { id: 'c', order: 5 },
    ];
    expect(reorder(tight, 'c', 'b', false)).toEqual([
      { id: 'a', order: 1024 },
      { id: 'c', order: 2048 },
      { id: 'b', order: 3072 },
    ]);
  });

  it('projekt „po kolei”: otwarte kroki poza pierwszym czekają na pierwszy', () => {
    const tasks = [
      task({ id: 's1', projectId: 'p', order: 1, completedAt: 5 }),
      task({ id: 's2', projectId: 'p', order: 2 }),
      task({ id: 's3', projectId: 'p', order: 3 }),
      task({ id: 'x', projectId: 'q', order: 1 }),
      task({ id: 'y', projectId: 'q', order: 2 }),
    ];
    const blocked = blockedSteps(tasks, [
      { id: 'p', sequential: true },
      { id: 'q', sequential: false },
    ]);
    expect([...blocked].map(([id, by]) => [id, by.id])).toEqual([['s3', 's2']]);
  });
});

describe('normalizacja', () => {
  it('stare zadania dostają wartości domyślne nowych pól', () => {
    expect(normTask('z', { title: 'Stare', createdAt: 77, repeat: 'weekly' })).toMatchObject({ every: 1, repeatDays: [], repeatFrom: 'due', duration: null, order: 77, lastDone: null });
    expect(normTask('w', { repeat: 'daily', every: 0, repeatDays: [1], duration: 2 })).toMatchObject({ every: 1, repeatDays: [], duration: null });
    expect(normTask('v', { repeat: 'weekly', every: 2, repeatDays: [4, 0, 4, 9], duration: 45 })).toMatchObject({ every: 2, repeatDays: [0, 4], duration: 45 });
  });

  it('naprawia niespójne dokumenty', () => {
    const t = normTask('x', { title: 'A', status: 'done', completedAt: null, priority: 9, due: '2026-02-30', time: '25:00', subtasks: [{ title: 'p' }, { title: '' }] });
    expect(t).toMatchObject({ status: 'todo', priority: 4, due: null, time: null, subtasks: [{ id: 's0', title: 'p', done: false }] });
    expect(normTask('y', { completedAt: 5, status: 'todo' }).status).toBe('done');
    expect(normSettings({ morningHour: 30, defaultRemind: null })).toEqual({ morningHour: 9, defaultRemind: null, remindersOn: false, distinct: [] });
  });

  it('etap tylko w projekcie, powiązania bez siebie samego i powtórzeń', () => {
    expect(normTask('a', { title: 'A' })).toMatchObject({ stageId: null, parentIds: [] });
    expect(normTask('a', { title: 'A', stageId: 's1' }).stageId).toBeNull();
    expect(normTask('a', { title: 'A', projectId: 'p', stageId: 's1' }).stageId).toBe('s1');
    expect(normTask('a', { title: 'A', parentIds: ['b', 'a', 'b', 3, ''] }).parentIds).toEqual(['b']);
  });
});
