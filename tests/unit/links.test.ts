import { describe, expect, it } from 'vitest';
import { dayItems, fmtWeek, monthGrid, weekDays } from '../../src/lib/calendar';
import { buildGraph } from '../../src/lib/graph';
import {
  addDistinct,
  canLink,
  childrenMap,
  findDuplicates,
  findSimilar,
  isSimilar,
  mergeRefs,
  pairKey,
  refKey,
  titleKey,
  undoChange,
  unlinkDeleted,
  type Ref,
} from '../../src/lib/links';
import { parseQuickAdd } from '../../src/lib/quickAdd';
import { blankTask } from '../../src/lib/tasks';
import type { Project, Stage, Task } from '../../src/types';

const today = '2026-11-17'; // wtorek
let seq = 0;
const task = (p: Partial<Task>): Task => blankTask(p.id ?? `t${++seq}`, 1000 + ++seq, { title: 'Zadanie', ...p });
const sub = (id: string, title: string, done = false) => ({ id, title, done });
const opts = { newId: () => 'nowe', now: 5_000, today };

describe('podobne nazwy', () => {
  it('upraszcza nazwy do porównań', () => {
    expect(titleKey('  Kupić  KABEL, HDMI! ')).toBe('kupic kabel hdmi');
  });

  it('rozpoznaje to samo zadanie inaczej zapisane', () => {
    expect(isSimilar('Kupić kabel HDMI', 'kupic kabel hdmi')).toBe(true);
    expect(isSimilar('kabel HDMI kupić', 'Kupić kabel HDMI')).toBe(true);
    expect(isSimilar('Zadzwonić do hydraulika', 'Zadzwonic do hydraulka')).toBe(true);
  });

  it('nie myli różnych zadań', () => {
    expect(isSimilar('Napisać rozdział 3', 'Napisać rozdział 4')).toBe(false);
    expect(isSimilar('Zadzwonić do mamy', 'Zadzwonić do taty')).toBe(false);
    expect(isSimilar('Kupić mleko', 'Kupić mleko i chleb')).toBe(false);
    expect(isSimilar('Pies', 'Pas')).toBe(false);
  });
});

describe('duplikaty', () => {
  const tv = task({ id: 'tv', title: 'Podłączyć TV', subtasks: [sub('a', 'Kupić kabel HDMI')] });
  const prez = task({ id: 'prez', title: 'Prezentacja', subtasks: [sub('b', 'kupić kabel hdmi'), sub('c', 'Slajdy')] });
  const kabel = task({ id: 'kabel', title: 'Kupic kabel HDMI' });

  it('znajduje pary zadań i podzadań, pomija „różne” i zrobione', () => {
    const pairs = findDuplicates([tv, prez, kabel], []);
    const keys = pairs.map((p) => p.key).sort();
    expect(keys).toEqual(
      [pairKey('s:tv:a', 's:prez:b'), pairKey('t:kabel', 's:tv:a'), pairKey('t:kabel', 's:prez:b')].sort(),
    );
    // zadanie zawsze przed podzadaniem
    expect(pairs.find((p) => p.key === pairKey('t:kabel', 's:tv:a'))!.a.kind).toBe('task');
    expect(findDuplicates([tv, prez, kabel], [pairKey('s:tv:a', 's:prez:b'), pairKey('t:kabel', 's:tv:a'), pairKey('t:kabel', 's:prez:b')])).toEqual([]);
    expect(findDuplicates([tv, prez, { ...kabel, completedAt: 1, status: 'done' }], []).map((p) => p.key)).toEqual([pairKey('s:tv:a', 's:prez:b')]);
  });

  it('nie pyta o zadanie i jego własne podzadanie ani o powiązane zadania', () => {
    const self = task({ id: 's', title: 'Raport', subtasks: [sub('x', 'raport')] });
    const parent = task({ id: 'p', title: 'Umowa' });
    const child = task({ id: 'c', title: 'Umowa', parentIds: ['p'] });
    expect(findDuplicates([self, parent, child], [])).toEqual([]);
  });

  it('przy dodawaniu wskazuje najbardziej podobną pozycję', () => {
    expect(refKey(findSimilar('kupić kabel HDMI', [tv, prez, kabel])!)).toBe('t:kabel');
    expect(findSimilar('kupić kabel HDMI', [tv], { taskId: 'tv' })).toBeNull();
    expect(findSimilar('Coś zupełnie innego', [tv, prez, kabel])).toBeNull();
  });
});

describe('łączenie „to samo”', () => {
  it('dwa podzadania → jedno zadanie wpływające na oba większe', () => {
    const a = task({ id: 'A', title: 'Podłączyć TV', projectId: 'dom', stageId: 'salon', subtasks: [sub('x', 'Kupić kabel'), sub('y', 'Antena')] });
    const b = task({ id: 'B', title: 'Prezentacja', projectId: 'praca', subtasks: [sub('z', 'kupić kabel', true)] });
    const m = mergeRefs({ kind: 'sub', task: a, sub: a.subtasks[0] }, { kind: 'sub', task: b, sub: b.subtasks[0] }, [a, b], opts);
    expect(m.kept).toMatchObject({ id: 'nowe', title: 'Kupić kabel', projectId: 'dom', stageId: 'salon', parentIds: ['A', 'B'], status: 'done', completedAt: 5_000 });
    const byId = new Map(m.change.put.map((t) => [t.id, t]));
    expect(byId.get('A')!.subtasks.map((s) => s.id)).toEqual(['y']);
    expect(byId.get('B')!.subtasks).toEqual([]);
    expect(m.change.del).toEqual([]);
  });

  it('zadanie i podzadanie → zadanie wpływa też na właściciela podzadania', () => {
    const owner = task({ id: 'O', title: 'Remont', projectId: 'dom', subtasks: [sub('k', 'Kupić farbę')] });
    const t = task({ id: 'T', title: 'Kupić farbę' });
    const m = mergeRefs({ kind: 'task', task: t }, { kind: 'sub', task: owner, sub: owner.subtasks[0] }, [owner, t], opts);
    expect(m.kept).toMatchObject({ id: 'T', parentIds: ['O'], projectId: 'dom' });
    expect(m.change.put.find((x) => x.id === 'O')!.subtasks).toEqual([]);
  });

  it('dwa zadania → jedno z terminem, podzadaniami i powiązaniami obu', () => {
    const p1 = task({ id: 'P1', title: 'Duże 1' });
    const p2 = task({ id: 'P2', title: 'Duże 2' });
    const x = task({ id: 'X', title: 'Zamówić części', parentIds: ['P1'], notes: 'sklep A', subtasks: [sub('1', 'Lista')], priority: 3 });
    const y = task({ id: 'Y', title: 'zamowic czesci', projectId: 'auto', parentIds: ['P2'], due: '2026-11-20', time: '10:00', subtasks: [sub('1', 'lista', true), sub('2', 'Zapłacić')], priority: 2 });
    const kid = task({ id: 'K', title: 'Sprawdzić numer', parentIds: ['X'] });
    const m = mergeRefs({ kind: 'task', task: x }, { kind: 'task', task: y }, [p1, p2, x, y, kid], opts);
    // zostaje zadanie z projektem
    expect(m.kept).toMatchObject({ id: 'Y', projectId: 'auto', due: '2026-11-20', time: '10:00', priority: 2 });
    expect(m.kept.parentIds.sort()).toEqual(['P1', 'P2']);
    expect(m.kept.notes).toBe('sklep A');
    expect(m.kept.subtasks.map((s) => [s.title, s.done])).toEqual([
      ['lista', true],
      ['Zapłacić', false],
    ]);
    expect(m.change.del).toEqual(['X']);
    expect(m.change.put.find((t) => t.id === 'K')!.parentIds).toEqual(['Y']);
  });

  it('cofnięcie przywraca stan sprzed połączenia', () => {
    const a = task({ id: 'A', title: 'A', subtasks: [sub('x', 'Kabel')] });
    const b = task({ id: 'B', title: 'B', subtasks: [sub('z', 'kabel')] });
    const before = new Map([a, b].map((t) => [t.id, t]));
    const m = mergeRefs({ kind: 'sub', task: a, sub: a.subtasks[0] } as Ref, { kind: 'sub', task: b, sub: b.subtasks[0] }, [a, b], opts);
    const back = undoChange(m.change, before);
    expect(back.del).toEqual(['nowe']);
    expect(back.put.map((t) => t.id).sort()).toEqual(['A', 'B']);
    expect(back.put.find((t) => t.id === 'A')!.subtasks).toHaveLength(1);
  });
});

describe('powiązania', () => {
  const a = task({ id: 'a', title: 'A' });
  const b = task({ id: 'b', title: 'B', parentIds: ['a'] });
  const c = task({ id: 'c', title: 'C', parentIds: ['b'] });
  const map = new Map([a, b, c].map((t) => [t.id, t]));

  it('nie pozwala na zapętlenie', () => {
    expect(canLink('c', 'a', map)).toBe(true);
    expect(canLink('a', 'c', map)).toBe(false);
    expect(canLink('a', 'a', map)).toBe(false);
  });

  it('mapa mniejszych zadań i usuwanie', () => {
    expect(childrenMap([a, b, c]).get('a')!.map((t) => t.id)).toEqual(['b']);
    expect(unlinkDeleted('b', [a, b, c])).toEqual([{ ...c, parentIds: [] }]);
  });

  it('pamięta pary „różne” bez powtórzeń', () => {
    expect(addDistinct(['x', 'y'], 'x')).toEqual(['y', 'x']);
  });
});

describe('graf zadań', () => {
  const projects: Project[] = [{ id: 'dom', name: 'Dom', color: '#0e9f6e', order: 1, createdAt: 1, groupId: null, sequential: false }];
  const stages: Stage[] = [{ id: 'st', projectId: 'dom', name: 'Salon', order: 1, createdAt: 1, due: null }];
  const tv = task({ id: 'tv', title: 'Podłączyć TV', projectId: 'dom', stageId: 'st', subtasks: [sub('s1', 'Antena')] });
  const prez = task({ id: 'prez', title: 'Prezentacja', projectId: 'dom' });
  const kabel = task({ id: 'kabel', title: 'Kupić kabel', projectId: 'dom', parentIds: ['tv', 'prez'] });
  const inbox = task({ id: 'ib', title: 'Luźne' });

  it('projekt → etap → zadanie → mniejsze zadanie; wspólne zadanie ma dodatkową linię', () => {
    const g = buildGraph({ projects, stages, tasks: [tv, prez, kabel, inbox], today, showDone: false, showSubtasks: true });
    const n = new Map(g.nodes.map((x) => [x.id, x]));
    expect(n.get('p:dom')!.depth).toBe(0);
    expect(n.get('s:st')!.depth).toBe(1);
    expect(n.get('t:tv')!.depth).toBe(2);
    expect(n.get('t:prez')!.depth).toBe(1);
    expect(n.get('t:kabel')!.depth).toBe(3);
    expect(n.get('t:kabel')!.shared).toBe(true);
    expect(n.get('u:tv:s1')!.depth).toBe(3);
    expect(n.get('inbox')).toBeTruthy();
    expect(g.edges).toContainEqual({ from: 't:tv', to: 't:kabel', kind: 'tree' });
    expect(g.edges).toContainEqual({ from: 't:prez', to: 't:kabel', kind: 'link' });
    // węzły w tej samej kolumnie nie nachodzą na siebie
    for (const x of g.nodes)
      for (const y of g.nodes)
        if (x !== y && x.depth === y.depth) expect(x.y + x.h <= y.y || y.y + y.h <= x.y).toBe(true);
  });

  it('graf projektu pokazuje powiązane zadania spoza niego', () => {
    const other = task({ id: 'o', title: 'Z innego projektu', projectId: 'praca', parentIds: ['prez'] });
    const g = buildGraph({ projects, stages, tasks: [tv, prez, kabel, other, inbox], today, projectId: 'dom', showDone: false, showSubtasks: false });
    const ids = g.nodes.map((x) => x.id);
    expect(ids).toContain('t:o');
    expect(ids).not.toContain('t:ib');
    expect(g.nodes.find((x) => x.id === 't:o')!.external).toBe(true);
    expect(ids.some((id) => id.startsWith('u:'))).toBe(false);
  });
});

describe('kalendarz', () => {
  it('siatka miesiąca od poniedziałku, pełne tygodnie', () => {
    const g = monthGrid('2026-11-17');
    expect(g[0]).toBe('2026-10-26');
    expect(g[g.length - 1]).toBe('2026-12-06');
    expect(g.length % 7).toBe(0);
    expect(weekDays('2026-11-19')).toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']);
    expect(fmtWeek('2026-11-19')).toBe('16–22 listopada 2026');
  });

  it('zadania dnia: otwarte, powtórzenia rutyn, zrobione', () => {
    const open = task({ id: 'o', title: 'Otwarte', due: '2026-11-20', time: '10:00' });
    const untimed = task({ id: 'u', title: 'Bez godziny', due: '2026-11-20' });
    const routine = task({ id: 'r', title: 'Golenie', due: '2026-11-18', repeat: 'daily', every: 2 });
    const done = task({ id: 'd', title: 'Zrobione', due: '2026-11-20', completedAt: 1, status: 'done' });
    expect(dayItems([open, untimed, routine, done], '2026-11-20', today, true).map((i) => `${i.kind}:${i.task.id}`)).toEqual(['task:o', 'task:u', 'next:r', 'done:d']);
    expect(dayItems([routine], '2026-11-20', today, false)).toEqual([]);
    expect(dayItems([routine], '2026-11-19', today, true)).toEqual([]);
  });
});

describe('szybkie dodawanie z etapem', () => {
  const projects = [{ id: 'p-dom', name: 'Dom' }];
  const stages = [
    { id: 's-salon', projectId: 'p-dom', name: 'Salon' },
    { id: 's-inny', projectId: 'p-x', name: 'Salon' },
  ];
  it('„#dom/salon” ustawia projekt i etap', () => {
    const r = parseQuickAdd('Pomalować ściany #dom/salon jutro', new Date(2026, 10, 17, 9), projects, [], stages);
    expect(r).toMatchObject({ title: 'Pomalować ściany', projectId: 'p-dom', stageId: 's-salon', due: '2026-11-18' });
    expect(r.tokens.find((t) => t.kind === 'project')!.label).toBe('Dom › Salon');
    expect(parseQuickAdd('Coś #dom', new Date(2026, 10, 17, 9), projects, [], stages)).toMatchObject({ projectId: 'p-dom', stageId: null });
  });
});
