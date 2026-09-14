import { describe, it, expect } from 'vitest';
import { reduce } from '../../src/core/reducer';
import { createEmptyData, INBOX_ID } from '../../src/core/defaults';
import { todayView, currentTask, tasksInList, isSnoozed, nextOrder, orderBetween } from '../../src/core/select';
import type { Task } from '../../src/core/types';

const t0 = 1_700_000_000_000;
const add = (d: any, id: string, title: string, extra = {}) => reduce(d, { type: 'task/add', id, now: t0, title, today: true, ...extra });

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'x', title: 'X', listId: INBOX_ID, tags: [], order: 1000, today: false,
    status: 'open', createdAt: t0, updatedAt: t0, ...overrides
  };
}

describe('todayView', () => {
  it('current/next come from Today candidates ordered by order then createdAt, capped at 5', () => {
    let d = createEmptyData(t0, '2.0.0');
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) d = add(d, id, id);
    const view = todayView(d, t0);
    expect(view.current?.id).toBe('a');
    expect(view.next.map(t => t.id)).toEqual(['b', 'c', 'd', 'e', 'f']);
    expect(view.next).toHaveLength(5);
    expect(view.unplanned).toBe(false);
  });
  it('done/total count all Today tasks regardless of status', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A'); d = add(d, 'b', 'B'); d = add(d, 'c', 'C');
    d = reduce(d, { type: 'task/complete', id: 'a', now: t0, by: 'user' });
    const view = todayView(d, t0);
    expect(view.total).toBe(3);
    expect(view.done).toBe(1);
  });
  it('excludes sub-tasks (non top-level) from candidates', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A'); d = add(d, 'a1', 'A1', { parentId: 'a' });
    const view = todayView(d, t0);
    expect(view.current?.id).toBe('a');
    expect(view.next).toHaveLength(0);
  });
  it('excludes done tasks from current/next candidates', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A'); d = add(d, 'b', 'B');
    d = reduce(d, { type: 'task/complete', id: 'a', now: t0, by: 'user' });
    expect(todayView(d, t0).current?.id).toBe('b');
  });
  it('falls back to Inbox candidates, ordered, capped at 5, when no open Today task exists', () => {
    let d = createEmptyData(t0, '2.0.0');
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) d = add(d, id, id, { today: false });
    const view = todayView(d, t0);
    expect(view.unplanned).toBe(true);
    expect(view.current?.id).toBe('a');
    expect(view.next.map(t => t.id)).toEqual(['b', 'c', 'd', 'e', 'f']);
  });
  it('a Today task that is snoozed does not block the fallback to Inbox', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A');
    d = add(d, 'b', 'B', { today: false });
    d = reduce(d, { type: 'task/snooze', id: 'a', now: t0, until: t0 + 60_000 });
    const view = todayView(d, t0);
    expect(view.unplanned).toBe(true);
    expect(view.current?.id).toBe('b');
  });
  it('no candidates anywhere yields an empty view', () => {
    const d = createEmptyData(t0, '2.0.0');
    expect(todayView(d, t0)).toMatchObject({ current: undefined, next: [], done: 0, total: 0, unplanned: false });
  });
});

describe('currentTask', () => {
  it('mirrors todayView(...).current', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A');
    expect(currentTask(d, t0)?.id).toBe('a');
    expect(currentTask(createEmptyData(t0, '2.0.0'), t0)).toBeUndefined();
  });
});

describe('tasksInList', () => {
  it('returns open, top-level tasks for a list, ordered', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A', { today: false }); d = add(d, 'b', 'B', { today: false }); d = add(d, 'a1', 'A1', { today: false, parentId: 'a' });
    d = reduce(d, { type: 'task/complete', id: 'b', now: t0, by: 'user' });
    const list = tasksInList(d, INBOX_ID);
    expect(list.map(t => t.id)).toEqual(['a']);
  });
  it('returns an empty array for a list with no open top-level tasks', () => {
    const d = createEmptyData(t0, '2.0.0');
    expect(tasksInList(d, 'no-such-list')).toEqual([]);
  });
});

describe('isSnoozed', () => {
  it('is true strictly before snoozedUntil and false at/after it', () => {
    const t = makeTask({ snoozedUntil: t0 + 100 });
    expect(isSnoozed(t, t0)).toBe(true);
    expect(isSnoozed(t, t0 + 99)).toBe(true);
    expect(isSnoozed(t, t0 + 100)).toBe(false);
    expect(isSnoozed(t, t0 + 101)).toBe(false);
  });
  it('is false when snoozedUntil is unset', () => {
    expect(isSnoozed(makeTask(), t0)).toBe(false);
  });
});

describe('nextOrder', () => {
  it('is 1000 for an empty list and max+1000 otherwise', () => {
    expect(nextOrder([])).toBe(1000);
    expect(nextOrder([makeTask({ order: 500 }), makeTask({ order: 2000 })])).toBe(3000);
  });
});

describe('orderBetween', () => {
  it('midpoints when both sides given, offsets by 1000 when one side is missing, 1000 when both missing', () => {
    expect(orderBetween(1000, 2000)).toBe(1500);
    expect(orderBetween(undefined, 2000)).toBe(1000);
    expect(orderBetween(1000, undefined)).toBe(2000);
    expect(orderBetween(undefined, undefined)).toBe(1000);
  });
});
