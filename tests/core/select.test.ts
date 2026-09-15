import { describe, it, expect } from 'vitest';
import { reduce } from '../../src/core/reducer';
import { createEmptyData, INBOX_ID } from '../../src/core/defaults';
import {
  todayView,
  currentTask,
  tasksInList,
  isSnoozed,
  nextOrder,
  orderBetween,
  planCandidates,
  dayStats,
  todayTasks,
  upcomingGroups,
  tasksWithTag,
  logbook
} from '../../src/core/select';
import { dayKeyForRollover, addDays, ymd } from '../../src/core/dates';
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

describe('planCandidates (Task 2.3)', () => {
  const yesterday = t0 - 24 * 60 * 60 * 1000;
  const todayKey = dayKeyForRollover(t0);
  const overdueKey = addDays(todayKey, -3);

  it('groups rolled-over, due, overdue, then Inbox, in that order, each ordered by order/createdAt', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = reduce(d, { type: 'task/add', id: 'rolled', now: yesterday, title: 'Rolled', today: true });
    d = reduce(d, { type: 'task/add', id: 'due', now: t0, title: 'Due', due: { date: todayKey } });
    d = reduce(d, { type: 'task/add', id: 'overdue', now: t0, title: 'Overdue', due: { date: overdueKey } });
    d = reduce(d, { type: 'task/add', id: 'inbox1', now: t0, title: 'Inbox1' });
    d = reduce(d, { type: 'task/add', id: 'inbox2', now: t0 + 1, title: 'Inbox2' });

    const result = planCandidates(d, t0);
    expect(result.map((c) => [c.task.id, c.reason])).toEqual([
      ['rolled', 'rolled-over'],
      ['due', 'due'],
      ['overdue', 'overdue'],
      ['inbox1', 'inbox'],
      ['inbox2', 'inbox']
    ]);
  });

  it('a task is never listed twice: rolled-over takes precedence over due/overdue/inbox', () => {
    let d = createEmptyData(yesterday, '2.0.0');
    // today: true, created yesterday (rolled-over), also due today AND in the Inbox list.
    d = reduce(d, { type: 'task/add', id: 'a', now: yesterday, title: 'A', today: true, due: { date: todayKey } });
    const result = planCandidates(d, t0);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ task: { id: 'a' }, reason: 'rolled-over' });
  });

  it('excludes done tasks, sub-tasks, and snoozed tasks', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = reduce(d, { type: 'task/add', id: 'done', now: t0, title: 'Done' });
    d = reduce(d, { type: 'task/complete', id: 'done', now: t0, by: 'user' });
    d = reduce(d, { type: 'task/add', id: 'parent', now: t0, title: 'Parent' });
    d = reduce(d, { type: 'task/add', id: 'sub', now: t0, title: 'Sub', parentId: 'parent' });
    d = reduce(d, { type: 'task/add', id: 'snoozed', now: t0, title: 'Snoozed' });
    d = reduce(d, { type: 'task/snooze', id: 'snoozed', now: t0, until: t0 + 60_000 });

    const result = planCandidates(d, t0);
    expect(result.map((c) => c.task.id)).toEqual(['parent']);
  });

  it('caps Inbox candidates at 10', () => {
    let d = createEmptyData(t0, '2.0.0');
    for (let i = 0; i < 15; i++) {
      d = reduce(d, { type: 'task/add', id: `i${i}`, now: t0 + i, title: `I${i}` });
    }
    const result = planCandidates(d, t0);
    expect(result).toHaveLength(10);
    expect(result.every((c) => c.reason === 'inbox')).toBe(true);
  });

  it('a task created "now" (never before the current rollover cutoff) with today: true is not rolled-over', () => {
    // t0 always falls WITHIN the period `dayKeyForRollover(t0)` names (by construction of
    // dayKeyForRollover), so a task created at exactly `now` can never be `< cutoff` —
    // it falls through to the Inbox group instead (its listId defaults to Inbox).
    let d = createEmptyData(t0, '2.0.0');
    d = reduce(d, { type: 'task/add', id: 'a', now: t0, title: 'A', today: true });
    const result = planCandidates(d, t0);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ task: { id: 'a' }, reason: 'inbox' });
  });
});

describe('dayStats (Task 2.3)', () => {
  it('zeros/undefined when no day record exists yet, but planned/done reflect the live Today set', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A');
    d = reduce(d, { type: 'task/complete', id: 'a', now: t0, by: 'user' }); // this DOES create a days[] record
    const stats = dayStats(d, 'never-recorded', t0);
    expect(stats).toMatchObject({ date: 'never-recorded', completed: 0, focusSeconds: 0, rolledOver: 0, note: undefined, closedAt: undefined });
  });

  it('pulls completed/focusSeconds/rolledOver/note/closedAt from the matching days[] record', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A');
    d = add(d, 'b', 'B');
    d = reduce(d, { type: 'task/complete', id: 'a', now: t0, by: 'user' });
    const date = d.days[0].date;
    d = reduce(d, { type: 'day/close', now: t0 + 10, date, note: 'Solid day' });

    const stats = dayStats(d, date, t0);
    expect(stats).toMatchObject({ date, completed: 1, rolledOver: 0, note: 'Solid day', closedAt: t0 + 10 });
    expect(stats.planned).toBe(2); // todayView().total: both Today tasks, done or not
    expect(stats.done).toBe(1);
  });
});

describe('todayTasks (Task 4.1)', () => {
  it('current/upNext mirror todayView candidates, uncapped', () => {
    let d = createEmptyData(t0, '2.0.0');
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) d = add(d, id, id);
    const { current, upNext } = todayTasks(d, t0);
    expect(current?.id).toBe('a');
    expect(upNext.map((t) => t.id)).toEqual(['b', 'c', 'd', 'e', 'f', 'g']); // not capped at 5
  });

  it('current is undefined when Today is unplanned (falls back to Inbox for the strip, but not the planner)', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A', { today: false }); // Inbox task, no Today tasks at all
    const view = todayTasks(d, t0);
    expect(view.current).toBeUndefined();
    expect(view.upNext).toEqual([]);
  });

  it('done: Today tasks completed on the current rollover day, newest completedAt first', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A');
    d = add(d, 'b', 'B');
    d = reduce(d, { type: 'task/complete', id: 'a', now: t0, by: 'user' });
    d = reduce(d, { type: 'task/complete', id: 'b', now: t0 + 1000, by: 'user' });
    const { done } = todayTasks(d, t0);
    expect(done.map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('done excludes a Today task completed on an earlier rollover day', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A');
    const yesterday = t0 - 24 * 60 * 60 * 1000;
    d = reduce(d, { type: 'task/complete', id: 'a', now: yesterday, by: 'user' });
    const { done } = todayTasks(d, t0);
    expect(done).toEqual([]);
  });
});

describe('upcomingGroups (Task 4.1)', () => {
  const today = ymd(t0);

  it('groups open, top-level tasks due tomorrow through today+14 by date, ascending', () => {
    let d = createEmptyData(t0, '2.0.0');
    const tomorrow = addDays(today, 1);
    const in3 = addDays(today, 3);
    d = reduce(d, { type: 'task/add', id: 'a', now: t0, title: 'A', due: { date: in3 } });
    d = reduce(d, { type: 'task/add', id: 'b', now: t0, title: 'B', due: { date: tomorrow } });
    d = reduce(d, { type: 'task/add', id: 'c', now: t0, title: 'C', due: { date: tomorrow }, tags: [] });

    const groups = upcomingGroups(d, t0);
    expect(groups.map((g) => g.date)).toEqual([tomorrow, in3]);
    expect(groups[0].tasks.map((t) => t.id)).toEqual(['b', 'c']);
  });

  it('excludes a task due today, beyond the window, snoozed-irrelevant (no snooze filter), sub-tasks, and done tasks', () => {
    let d = createEmptyData(t0, '2.0.0');
    const tomorrow = addDays(today, 1);
    const tooFar = addDays(today, 15);
    d = reduce(d, { type: 'task/add', id: 'today', now: t0, title: 'Today', due: { date: today } });
    d = reduce(d, { type: 'task/add', id: 'far', now: t0, title: 'Far', due: { date: tooFar } });
    d = reduce(d, { type: 'task/add', id: 'sub-parent', now: t0, title: 'Parent', due: { date: tomorrow } });
    d = reduce(d, { type: 'task/add', id: 'sub', now: t0, title: 'Sub', due: { date: tomorrow }, parentId: 'sub-parent' });
    d = reduce(d, { type: 'task/add', id: 'done', now: t0, title: 'Done', due: { date: tomorrow } });
    d = reduce(d, { type: 'task/complete', id: 'done', now: t0, by: 'user' });

    const groups = upcomingGroups(d, t0);
    const ids = groups.flatMap((g) => g.tasks.map((t) => t.id));
    expect(ids).toEqual(['sub-parent']);
  });

  it('within a group, orders by due.time then order/createdAt (no time sorts first)', () => {
    let d = createEmptyData(t0, '2.0.0');
    const tomorrow = addDays(today, 1);
    d = reduce(d, { type: 'task/add', id: 'late', now: t0, title: 'Late', due: { date: tomorrow, time: '15:00' } });
    d = reduce(d, { type: 'task/add', id: 'early', now: t0, title: 'Early', due: { date: tomorrow, time: '09:00' } });
    d = reduce(d, { type: 'task/add', id: 'allday', now: t0, title: 'All day', due: { date: tomorrow } });

    const groups = upcomingGroups(d, t0);
    expect(groups[0].tasks.map((t) => t.id)).toEqual(['allday', 'early', 'late']);
  });

  it('respects a custom `days` window', () => {
    let d = createEmptyData(t0, '2.0.0');
    const in20 = addDays(today, 20);
    d = reduce(d, { type: 'task/add', id: 'a', now: t0, title: 'A', due: { date: in20 } });
    expect(upcomingGroups(d, t0, 14)).toEqual([]);
    expect(upcomingGroups(d, t0, 20).map((g) => g.date)).toEqual([in20]);
  });
});

describe('tasksWithTag (Task 4.1)', () => {
  it('returns open, top-level tasks carrying the tag, ordered', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = reduce(d, { type: 'task/add', id: 'a', now: t0, title: 'A', tags: ['work'] });
    d = reduce(d, { type: 'task/add', id: 'b', now: t0 + 1, title: 'B', tags: ['home'] });
    d = reduce(d, { type: 'task/add', id: 'c', now: t0 + 2, title: 'C', tags: ['work', 'deep'] });
    expect(tasksWithTag(d, 'work').map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('excludes sub-tasks and done tasks', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = reduce(d, { type: 'task/add', id: 'p', now: t0, title: 'P', tags: ['x'] });
    d = reduce(d, { type: 'task/add', id: 'sub', now: t0, title: 'Sub', tags: ['x'], parentId: 'p' });
    d = reduce(d, { type: 'task/add', id: 'done', now: t0, title: 'Done', tags: ['x'] });
    d = reduce(d, { type: 'task/complete', id: 'done', now: t0, by: 'user' });
    expect(tasksWithTag(d, 'x').map((t) => t.id)).toEqual(['p']);
  });

  it('returns an empty array for an unused tag', () => {
    expect(tasksWithTag(createEmptyData(t0, '2.0.0'), 'nope')).toEqual([]);
  });
});

describe('logbook (Task 4.1)', () => {
  it('returns done tasks, newest completedAt first', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A');
    d = add(d, 'b', 'B');
    d = reduce(d, { type: 'task/complete', id: 'a', now: t0, by: 'user' });
    d = reduce(d, { type: 'task/complete', id: 'b', now: t0 + 1000, by: 'user' });
    expect(logbook(d).map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('excludes open tasks', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A');
    expect(logbook(d)).toEqual([]);
  });
});
