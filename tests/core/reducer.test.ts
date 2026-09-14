import { describe, it, expect } from 'vitest';
import { reduce } from '../../src/core/reducer';
import { createEmptyData, INBOX_ID } from '../../src/core/defaults';
import { todayView } from '../../src/core/select';
const t0 = 1_700_000_000_000;
const add = (d: any, id: string, title: string, extra = {}) => reduce(d, { type: 'task/add', id, now: t0, title, today: true, ...extra });
describe('reducer: tasks', () => {
  it('adds to inbox with increasing order', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A'); d = add(d, 'b', 'B');
    expect(d.tasks.map(t => [t.id, t.listId, t.order])).toEqual([['a', INBOX_ID, 1000], ['b', INBOX_ID, 2000]]);
  });
  it('makeCurrent moves a task to the front of Today', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A'); d = add(d, 'b', 'B');
    d = reduce(d, { type: 'task/makeCurrent', id: 'b', now: t0 });
    expect(todayView(d, t0).current?.id).toBe('b');
  });
  it('complete records who completed and advances', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A'); d = add(d, 'b', 'B');
    d = reduce(d, { type: 'task/complete', id: 'a', now: t0 + 5, by: 'user' });
    const a = d.tasks.find(t => t.id === 'a')!;
    expect([a.status, a.completedBy, a.completedAt]).toEqual(['done', 'user', t0 + 5]);
    expect(todayView(d, t0 + 5).current?.id).toBe('b');
    expect(todayView(d, t0 + 5)).toMatchObject({ done: 1, total: 2 });
  });
  it('snoozed tasks are skipped until the time passes', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A'); d = add(d, 'b', 'B');
    d = reduce(d, { type: 'task/snooze', id: 'a', now: t0, until: t0 + 60_000 });
    expect(todayView(d, t0).current?.id).toBe('b');
    expect(todayView(d, t0 + 60_001).current?.id).toBe('a');
  });
  it('falls back to Inbox when Today is empty and flags unplanned', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A', { today: false });
    expect(todayView(d, t0)).toMatchObject({ unplanned: true });
    expect(todayView(d, t0).current?.id).toBe('a');
  });
  it('delete removes children', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A'); d = add(d, 'a1', 'A1', { parentId: 'a' });
    d = reduce(d, { type: 'task/delete', id: 'a', now: t0 });
    expect(d.tasks).toHaveLength(0);
  });
  it('delete removes grandchildren too', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A'); d = add(d, 'a1', 'A1', { parentId: 'a' }); d = add(d, 'a1a', 'A1A', { parentId: 'a1' });
    d = reduce(d, { type: 'task/delete', id: 'a', now: t0 });
    expect(d.tasks).toHaveLength(0);
  });
  it('unknown actions are a no-op', () => {
    const d = createEmptyData(t0, '2.0.0');
    expect(reduce(d, { type: 'nope' } as any)).toBe(d);
  });
  it('never mutates its input', () => {
    const d = createEmptyData(t0, '2.0.0');
    const frozen = JSON.parse(JSON.stringify(d));
    reduce(d, { type: 'task/add', id: 'a', now: t0, title: 'A' });
    expect(d).toEqual(frozen);
  });
  it('not-yet-implemented actions return the same reference', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A');
    const before = d;
    expect(reduce(d, { type: 'task/edit', id: 'a', now: t0, patch: { title: 'x' } })).toBe(before);
    expect(reduce(d, { type: 'task/move', id: 'a', now: t0 })).toBe(before);
    expect(reduce(d, { type: 'timer/start', id: 'a', now: t0 })).toBe(before);
    expect(reduce(d, { type: 'timer/pause', id: 'a', now: t0 })).toBe(before);
    expect(reduce(d, { type: 'timer/stop', id: 'a', now: t0 })).toBe(before);
    expect(reduce(d, { type: 'timer/addTime', id: 'a', now: t0, seconds: 5 })).toBe(before);
    expect(reduce(d, { type: 'list/add', id: 'l1', now: t0, name: 'Work' })).toBe(before);
    expect(reduce(d, { type: 'list/rename', id: INBOX_ID, now: t0, name: 'Inbox2' })).toBe(before);
    expect(reduce(d, { type: 'list/delete', id: INBOX_ID, now: t0, moveTasksTo: INBOX_ID })).toBe(before);
    expect(reduce(d, { type: 'day/rollover', now: t0, date: '2026-09-14' })).toBe(before);
    expect(reduce(d, { type: 'day/close', now: t0, date: '2026-09-14' })).toBe(before);
  });
  it('uncomplete reopens a task and clears completion fields', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A');
    d = reduce(d, { type: 'task/complete', id: 'a', now: t0 + 5, by: 'user' });
    d = reduce(d, { type: 'task/uncomplete', id: 'a', now: t0 + 10 });
    const a = d.tasks.find(t => t.id === 'a')!;
    expect([a.status, a.completedAt, a.completedBy, a.updatedAt]).toEqual(['open', undefined, undefined, t0 + 10]);
  });
  it('skip pushes a Today task behind the others', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A'); d = add(d, 'b', 'B');
    d = reduce(d, { type: 'task/skip', id: 'a', now: t0 });
    expect(todayView(d, t0).current?.id).toBe('b');
    const a = d.tasks.find(t => t.id === 'a')!;
    const b = d.tasks.find(t => t.id === 'b')!;
    expect(a.order).toBeGreaterThan(b.order);
  });
  it('setToday flips the today flag on a batch of ids', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A', { today: false }); d = add(d, 'b', 'B', { today: false });
    d = reduce(d, { type: 'task/setToday', ids: ['a', 'b'], now: t0, today: true });
    expect(d.tasks.every(t => t.today)).toBe(true);
    d = reduce(d, { type: 'task/setToday', ids: ['a'], now: t0, today: false });
    expect(d.tasks.find(t => t.id === 'a')!.today).toBe(false);
    expect(d.tasks.find(t => t.id === 'b')!.today).toBe(true);
  });
  it('complete folds a running timer into spentSeconds and clears runningSince', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = reduce(d, { type: 'task/add', id: 'a', now: t0, title: 'A', plannedSeconds: 1500 });
    // timer/start is a no-op until Task 3.1; set runningSince directly to exercise task/complete's fold.
    d = { ...d, tasks: d.tasks.map(t => t.id === 'a' ? { ...t, timer: { ...t.timer!, runningSince: t0 } } : t) };
    d = reduce(d, { type: 'task/complete', id: 'a', now: t0 + 12_000, by: 'timer' });
    const a = d.tasks.find(t => t.id === 'a')!;
    expect(a.timer).toEqual({ plannedSeconds: 1500, spentSeconds: 12, runningSince: undefined });
  });
  it('complete spawns the next daily occurrence via the temporary stub', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = reduce(d, { type: 'task/add', id: 'a', now: t0, title: 'A', today: true, recurrence: { kind: 'daily' }, due: { date: '2026-09-14' } });
    d = reduce(d, { type: 'task/complete', id: 'a', now: t0 + 5, by: 'user', spawnId: 'a-2' });
    const spawned = d.tasks.find(t => t.id === 'a-2')!;
    expect(spawned).toBeDefined();
    expect([spawned.status, spawned.today, spawned.due?.date]).toEqual(['open', false, '2026-09-15']);
  });
  it('complete does not spawn for non-daily recurrence yet', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = reduce(d, { type: 'task/add', id: 'a', now: t0, title: 'A', recurrence: { kind: 'weekdays' }, due: { date: '2026-09-14' } });
    d = reduce(d, { type: 'task/complete', id: 'a', now: t0 + 5, by: 'user', spawnId: 'a-2' });
    expect(d.tasks.map(t => t.id)).toEqual(['a']);
  });
  it('complete increments score.value when enabled and completed by the user', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = reduce(d, { type: 'settings/patch', now: t0, patch: { score: { enabled: true } } });
    d = add(d, 'a', 'A');
    d = reduce(d, { type: 'task/complete', id: 'a', now: t0 + 5, by: 'user' });
    expect(d.settings.score.value).toBe(1);
    d = add(d, 'b', 'B');
    d = reduce(d, { type: 'task/complete', id: 'b', now: t0 + 5, by: 'timer' });
    expect(d.settings.score.value).toBe(1);
  });
  it('score is untouched when scoring is disabled', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A');
    d = reduce(d, { type: 'task/complete', id: 'a', now: t0 + 5, by: 'user' });
    expect(d.settings.score.value).toBe(0);
  });
});
describe('reducer: settings/patch', () => {
  it('deep merges nested settings without clobbering siblings', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = reduce(d, { type: 'settings/patch', now: t0, patch: { strip: { edge: 'top' } } });
    expect(d.settings.strip.edge).toBe('top');
    expect(d.settings.strip.width).toBe(420); // untouched sibling
    expect(d.settings.theme).toEqual({ name: 'ledger', mode: 'system' }); // untouched top-level sibling
  });
  it('replaces positions whole rather than merging per key', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = reduce(d, { type: 'settings/patch', now: t0, patch: { strip: { positions: { d1: { x: 1, y: 2 } } } } });
    d = reduce(d, { type: 'settings/patch', now: t0, patch: { strip: { positions: { d2: { x: 3, y: 4 } } } } });
    expect(d.settings.strip.positions).toEqual({ d2: { x: 3, y: 4 } });
  });
});
describe('reducer: data/replace', () => {
  it('replaces the whole data object', () => {
    const d1 = createEmptyData(t0, '2.0.0');
    const d2 = createEmptyData(t0 + 1, '2.0.1');
    const result = reduce(d1, { type: 'data/replace', now: t0, data: d2 });
    expect(result).toBe(d2);
  });
});
