// tests/renderer/planner-detail — pure helpers behind Task 4.3's detail pane: the
// flattened row model (rowModel.ts) and the recurrence editor's state <-> Rule
// conversion (recurrenceModel.ts). No DOM, no React rendering — see
// tests/renderer/planner.test.ts's header comment for why.
import { describe, it, expect } from 'vitest';
import { reduce } from '../../src/core/reducer';
import { createEmptyData } from '../../src/core/defaults';
import { flattenWithChildren, childProgress } from '../../src/renderer/planner/rowModel';
import { ruleToState, stateToRule } from '../../src/renderer/planner/recurrenceModel';
import type { Rule } from '../../src/core/types';

const t0 = 1_700_000_000_000;

describe('flattenWithChildren (Task 4.3)', () => {
  it('inserts a task\'s open children immediately after it, indented', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = reduce(d, { type: 'task/add', id: 'p1', now: t0, title: 'P1', today: true });
    d = reduce(d, { type: 'task/add', id: 'p2', now: t0 + 1, title: 'P2', today: true });
    d = reduce(d, { type: 'task/add', id: 'c1', now: t0 + 2, title: 'C1', parentId: 'p1' });
    d = reduce(d, { type: 'task/add', id: 'c2', now: t0 + 3, title: 'C2', parentId: 'p1' });

    const rows = flattenWithChildren([d.tasks.find((t) => t.id === 'p1')!, d.tasks.find((t) => t.id === 'p2')!], d);
    expect(rows.map((r) => [r.task.id, r.depth])).toEqual([
      ['p1', 0],
      ['c1', 1],
      ['c2', 1],
      ['p2', 0]
    ]);
  });

  it('omits DONE children as their own row', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = reduce(d, { type: 'task/add', id: 'p', now: t0, title: 'P' });
    d = reduce(d, { type: 'task/add', id: 'c', now: t0 + 1, title: 'C', parentId: 'p' });
    d = reduce(d, { type: 'task/complete', id: 'c', now: t0 + 2, by: 'user' });

    const rows = flattenWithChildren([d.tasks.find((t) => t.id === 'p')!], d);
    expect(rows.map((r) => r.task.id)).toEqual(['p']);
  });

  it('a task with no children produces just its own row', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = reduce(d, { type: 'task/add', id: 'p', now: t0, title: 'P' });
    const rows = flattenWithChildren([d.tasks.find((t) => t.id === 'p')!], d);
    expect(rows).toEqual([{ task: d.tasks[0], depth: 0 }]);
  });
});

describe('childProgress (Task 4.3)', () => {
  it('returns "<done>/<total>" counting both open and done children', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = reduce(d, { type: 'task/add', id: 'p', now: t0, title: 'P' });
    d = reduce(d, { type: 'task/add', id: 'c1', now: t0 + 1, title: 'C1', parentId: 'p' });
    d = reduce(d, { type: 'task/add', id: 'c2', now: t0 + 2, title: 'C2', parentId: 'p' });
    d = reduce(d, { type: 'task/complete', id: 'c1', now: t0 + 3, by: 'user' });
    expect(childProgress(d, 'p')).toBe('1/2');
  });

  it('returns undefined for a task with no children', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = reduce(d, { type: 'task/add', id: 'p', now: t0, title: 'P' });
    expect(childProgress(d, 'p')).toBeUndefined();
  });
});

describe('ruleToState / stateToRule round-trip (Task 4.3)', () => {
  it('undefined rule -> "never" state -> undefined rule', () => {
    const state = ruleToState(undefined);
    expect(state.kind).toBe('never');
    expect(stateToRule(state, '2026-09-15')).toBeUndefined();
  });

  it('daily round-trips', () => {
    const rule: Rule = { kind: 'daily' };
    expect(stateToRule(ruleToState(rule), '2026-09-15')).toEqual(rule);
  });

  it('weekdays round-trips', () => {
    const rule: Rule = { kind: 'weekdays' };
    expect(stateToRule(ruleToState(rule), '2026-09-15')).toEqual(rule);
  });

  it('weekly round-trips days, sorted and deduped', () => {
    const rule: Rule = { kind: 'weekly', days: [3, 1] };
    const state = ruleToState(rule);
    expect(state.weeklyDays).toEqual([3, 1]);
    expect(stateToRule({ ...state, weeklyDays: [3, 1, 1] }, '2026-09-15')).toEqual({ kind: 'weekly', days: [1, 3] });
  });

  it('weekly with no days selected converts to undefined (save-blocking case, defensive)', () => {
    const state = ruleToState(undefined);
    expect(stateToRule({ ...state, kind: 'weekly', weeklyDays: [] }, '2026-09-15')).toBeUndefined();
  });

  it('monthly round-trips and clamps dayOfMonth to 1..31', () => {
    const rule: Rule = { kind: 'monthly', dayOfMonth: 31 };
    expect(stateToRule(ruleToState(rule), '2026-09-15')).toEqual(rule);
    const state = ruleToState(rule);
    expect(stateToRule({ ...state, monthlyDay: 99 }, '2026-09-15')).toEqual({ kind: 'monthly', dayOfMonth: 31 });
    expect(stateToRule({ ...state, monthlyDay: 0 }, '2026-09-15')).toEqual({ kind: 'monthly', dayOfMonth: 1 });
  });

  it('everyN round-trips n/unit and applies the given anchor', () => {
    const rule: Rule = { kind: 'everyN', n: 3, unit: 'week', anchor: '2026-01-01' };
    const state = ruleToState(rule);
    expect(state).toMatchObject({ kind: 'everyN', everyN: 3, everyUnit: 'week' });
    expect(stateToRule(state, '2026-09-15')).toEqual({ kind: 'everyN', n: 3, unit: 'week', anchor: '2026-09-15' });
  });

  it('everyN clamps n to 1..365', () => {
    const state = ruleToState(undefined);
    expect(stateToRule({ ...state, kind: 'everyN', everyN: 400 }, '2026-09-15')).toEqual({
      kind: 'everyN',
      n: 365,
      unit: 'day',
      anchor: '2026-09-15'
    });
    expect(stateToRule({ ...state, kind: 'everyN', everyN: 0 }, '2026-09-15')).toEqual({
      kind: 'everyN',
      n: 1,
      unit: 'day',
      anchor: '2026-09-15'
    });
  });
});
