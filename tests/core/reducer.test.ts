import { describe, it, expect } from 'vitest';
import { reduce } from '../../src/core/reducer';
import { createEmptyData, INBOX_ID } from '../../src/core/defaults';
import { todayView } from '../../src/core/select';
import { ymd, dayKeyForRollover, addDays, rolloverCutoffMs } from '../../src/core/dates';
const t0 = 1_700_000_000_000;
const add = (d: any, id: string, title: string, extra = {}) => reduce(d, { type: 'task/add', id, now: t0, title, today: true, ...extra });
describe('reducer: tasks', () => {
  it('adds to inbox with increasing order', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A'); d = add(d, 'b', 'B');
    expect(d.tasks.map(t => [t.id, t.listId, t.order])).toEqual([['a', INBOX_ID, 1000], ['b', INBOX_ID, 2000]]);
  });
  // Fix round 1, defect 1b (controller ruling, defence in depth): a task/add whose
  // listId doesn't reference a real list (e.g. a paired list/add for the same new list
  // was no-op'd by the reducer because an earlier line in the same paste already
  // created it) must not silently produce a task pointing at a list that doesn't exist.
  it('task/add falls back to Inbox when listId does not reference an existing list', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = reduce(d, { type: 'task/add', id: 'a', now: t0, title: 'A', listId: 'ghost-list' });
    expect(d.tasks[0].listId).toBe(INBOX_ID);
  });
  it('task/add drops parentId when it does not reference an existing task', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = reduce(d, { type: 'task/add', id: 'a', now: t0, title: 'A', parentId: 'ghost-task' });
    expect(d.tasks[0].parentId).toBeUndefined();
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
    expect(reduce(d, { type: 'list/rename', id: INBOX_ID, now: t0, name: 'Inbox2' })).toBe(before);
    expect(reduce(d, { type: 'list/delete', id: INBOX_ID, now: t0, moveTasksTo: INBOX_ID })).toBe(before);
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
describe('reducer: list/add', () => {
  it('appends a list with order = max(order)+1000 and createdAt = now', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = reduce(d, { type: 'list/add', id: 'l1', now: t0 + 1, name: 'Work' });
    expect(d.lists).toEqual([
      { id: INBOX_ID, name: 'Inbox', order: 1000, createdAt: t0 },
      { id: 'l1', name: 'Work', order: 2000, createdAt: t0 + 1 }
    ]);
  });
  it('trims the name', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = reduce(d, { type: 'list/add', id: 'l1', now: t0, name: '  Work  ' });
    expect(d.lists.find(l => l.id === 'l1')!.name).toBe('Work');
  });
  it('order is 1000 when there are no existing lists', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = { ...d, lists: [] };
    d = reduce(d, { type: 'list/add', id: 'l1', now: t0, name: 'Work' });
    expect(d.lists).toEqual([{ id: 'l1', name: 'Work', order: 1000, createdAt: t0 }]);
  });
  it('no-ops when a list with the same id already exists', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = reduce(d, { type: 'list/add', id: 'l1', now: t0, name: 'Work' });
    const before = d;
    d = reduce(d, { type: 'list/add', id: 'l1', now: t0 + 1, name: 'Other name' });
    expect(d).toBe(before);
  });
  it('no-ops when a list with the same name already exists (case-insensitive)', () => {
    let d = createEmptyData(t0, '2.0.0');
    const before = d;
    d = reduce(d, { type: 'list/add', id: 'l2', now: t0, name: 'inbox' });
    expect(d).toBe(before);
    expect(d.lists).toHaveLength(1);
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

describe('reducer: task/complete and task/uncomplete record the day (Task 2.3)', () => {
  it('complete upserts days[ymd(now)]: completed += 1, focusSeconds += 0 with no running timer', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A');
    d = reduce(d, { type: 'task/complete', id: 'a', now: t0, by: 'user' });
    expect(d.days).toEqual([{ date: ymd(t0), completed: 1, focusSeconds: 0, rolledOver: 0 }]);
  });
  it("complete folds a running timer into the day's focusSeconds", () => {
    let d = createEmptyData(t0, '2.0.0');
    d = reduce(d, { type: 'task/add', id: 'a', now: t0, title: 'A' });
    d = { ...d, tasks: d.tasks.map((t) => (t.id === 'a' ? { ...t, timer: { spentSeconds: 0, runningSince: t0 } } : t)) };
    d = reduce(d, { type: 'task/complete', id: 'a', now: t0 + 12_000, by: 'timer' });
    const rec = d.days.find((r) => r.date === ymd(t0 + 12_000))!;
    expect(rec).toMatchObject({ completed: 1, focusSeconds: 12 });
  });
  // Fix round 1, reviewer Important 2: the previous version of this test started
  // spentSeconds at 0, so it couldn't tell "focusSeconds gets the ELAPSED segment"
  // apart from "focusSeconds gets the task's TOTAL spentSeconds" — both would have
  // produced 12. Pin it with a task that already carries prior time.
  it("complete folds only the RUNNING SEGMENT's elapsed time into focusSeconds, not the task's pre-existing spentSeconds", () => {
    let d = createEmptyData(t0, '2.0.0');
    d = reduce(d, { type: 'task/add', id: 'a', now: t0, title: 'A' });
    d = { ...d, tasks: d.tasks.map((t) => (t.id === 'a' ? { ...t, timer: { spentSeconds: 300, runningSince: t0 } } : t)) };
    d = reduce(d, { type: 'task/complete', id: 'a', now: t0 + 12_000, by: 'timer' });
    const task = d.tasks.find((t) => t.id === 'a')!;
    expect(task.timer?.spentSeconds).toBe(312); // 300 pre-existing + 12 elapsed
    const rec = d.days.find((r) => r.date === ymd(t0 + 12_000))!;
    expect(rec.focusSeconds).toBe(12); // NOT 312 — only the elapsed segment
  });
  it('two completions on the same day accumulate into one record', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A');
    d = add(d, 'b', 'B');
    d = reduce(d, { type: 'task/complete', id: 'a', now: t0, by: 'user' });
    d = reduce(d, { type: 'task/complete', id: 'b', now: t0 + 1000, by: 'user' });
    expect(d.days).toHaveLength(1);
    expect(d.days[0].completed).toBe(2);
  });
  it('days stays sorted by date as records from different days are added', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A');
    d = add(d, 'b', 'B');
    const oneDayMs = 24 * 60 * 60 * 1000;
    d = reduce(d, { type: 'task/complete', id: 'b', now: t0 + oneDayMs, by: 'user' });
    d = reduce(d, { type: 'task/complete', id: 'a', now: t0, by: 'user' });
    expect(d.days.map((r) => r.date)).toEqual([ymd(t0), ymd(t0 + oneDayMs)].sort((a, b) => a.localeCompare(b)));
  });
  it('uncomplete decrements completed on the ORIGINAL completion day, floored at 0, and leaves focus alone', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A');
    d = reduce(d, { type: 'task/complete', id: 'a', now: t0, by: 'user' });
    d = reduce(d, { type: 'task/uncomplete', id: 'a', now: t0 + 1000 });
    const rec = d.days.find((r) => r.date === ymd(t0))!;
    expect(rec).toMatchObject({ completed: 0, focusSeconds: 0 });
  });
  it('uncomplete never drives completed below 0', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A');
    d = reduce(d, { type: 'task/complete', id: 'a', now: t0, by: 'user' });
    d = reduce(d, { type: 'task/uncomplete', id: 'a', now: t0 + 1 });
    d = reduce(d, { type: 'task/uncomplete', id: 'a', now: t0 + 2 }); // already open: reducer no-ops (completedAt undefined)
    const rec = d.days.find((r) => r.date === ymd(t0))!;
    expect(rec.completed).toBe(0);
  });
  it('uncomplete is a no-op on the day record when the task was never completed', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A');
    d = reduce(d, { type: 'task/uncomplete', id: 'a', now: t0 });
    expect(d.days).toEqual([]);
  });
});

describe('reducer: day/rollover (Task 2.3)', () => {
  it("increments the PREVIOUS day's rolledOver once per open, top-level, today task created before the cutoff", () => {
    const yesterday = t0 - 24 * 60 * 60 * 1000;
    let d = createEmptyData(yesterday, '2.0.0');
    d = reduce(d, { type: 'task/add', id: 'a', now: yesterday, title: 'A', today: true });
    d = reduce(d, { type: 'task/add', id: 'b', now: yesterday, title: 'B', today: true });
    const todayKey = dayKeyForRollover(t0);
    const prevKey = addDays(todayKey, -1);
    d = reduce(d, { type: 'day/rollover', now: t0, date: todayKey });
    const rec = d.days.find((r) => r.date === prevKey);
    expect(rec?.rolledOver).toBe(2);
    expect(d.tasks.every((t) => t.today)).toBe(true); // tasks keep today: true
  });

  it('does not count a task created today (after the cutoff)', () => {
    const todayKey = dayKeyForRollover(t0);
    const prevKey = addDays(todayKey, -1);
    let d = createEmptyData(t0, '2.0.0');
    d = reduce(d, { type: 'task/add', id: 'a', now: t0, title: 'A', today: true });
    d = reduce(d, { type: 'day/rollover', now: t0, date: todayKey });
    const rec = d.days.find((r) => r.date === prevKey);
    expect(rec?.rolledOver ?? 0).toBe(0);
  });

  it('is idempotent for the same date: a second dispatch is a no-op (same reference)', () => {
    const yesterday = t0 - 24 * 60 * 60 * 1000;
    const todayKey = dayKeyForRollover(t0);
    let d = createEmptyData(yesterday, '2.0.0');
    d = reduce(d, { type: 'task/add', id: 'a', now: yesterday, title: 'A', today: true });
    d = reduce(d, { type: 'day/rollover', now: t0, date: todayKey });
    const after1 = d;
    d = reduce(d, { type: 'day/rollover', now: t0 + 1, date: todayKey });
    expect(d).toBe(after1);
  });

  it('ensures a DayRecord exists for `date` with rolloverAppliedAt set', () => {
    const todayKey = dayKeyForRollover(t0);
    let d = createEmptyData(t0, '2.0.0');
    d = reduce(d, { type: 'day/rollover', now: t0, date: todayKey });
    const rec = d.days.find((r) => r.date === todayKey);
    expect(rec?.rolloverAppliedAt).toBe(t0);
  });

  it('days stays sorted after rollover creates records', () => {
    const todayKey = dayKeyForRollover(t0);
    const yesterday = t0 - 24 * 60 * 60 * 1000;
    let d = createEmptyData(yesterday, '2.0.0');
    d = reduce(d, { type: 'task/add', id: 'a', now: yesterday, title: 'A', today: true });
    d = reduce(d, { type: 'day/rollover', now: t0, date: todayKey });
    const dates = d.days.map((r) => r.date);
    const sorted = [...dates].sort((a, b) => a.localeCompare(b));
    expect(dates).toEqual(sorted);
    expect(dates).toEqual([addDays(todayKey, -1), todayKey].sort((a, b) => a.localeCompare(b)));
  });

  it('ignores done and sub-tasks even if today: true and created before the cutoff', () => {
    const yesterday = t0 - 24 * 60 * 60 * 1000;
    const todayKey = dayKeyForRollover(t0);
    const prevKey = addDays(todayKey, -1);
    let d = createEmptyData(yesterday, '2.0.0');
    d = reduce(d, { type: 'task/add', id: 'a', now: yesterday, title: 'A', today: true });
    d = reduce(d, { type: 'task/add', id: 'a1', now: yesterday, title: 'A1', today: true, parentId: 'a' });
    d = reduce(d, { type: 'task/complete', id: 'a', now: yesterday, by: 'user' });
    d = reduce(d, { type: 'day/rollover', now: t0, date: todayKey });
    const rec = d.days.find((r) => r.date === prevKey);
    expect(rec?.rolledOver ?? 0).toBe(0);
  });

  // Fix round 1: controller ruling on reviewer Minor 1 (no code change) — a task
  // that stays planned (today: true, still open) across several days counts toward
  // `rolledOver` on EACH day it carries over from, not just once. Pins three
  // consecutive rollovers for the SAME still-open task, each landing on a different
  // day's record.
  it('a task that stays today:true and open across several days counts toward rolledOver on EACH day it carries over from', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = reduce(d, { type: 'task/add', id: 'a', now: t0, title: 'A', today: true });

    const key0 = dayKeyForRollover(t0);
    const day1 = rolloverCutoffMs(addDays(key0, 1)) + 1000; // safely inside day 1's own period
    const key1 = dayKeyForRollover(day1);
    const day2 = rolloverCutoffMs(addDays(key1, 1)) + 1000;
    const key2 = dayKeyForRollover(day2);
    const day3 = rolloverCutoffMs(addDays(key2, 1)) + 1000;
    const key3 = dayKeyForRollover(day3);

    d = reduce(d, { type: 'day/rollover', now: day1, date: key1 });
    d = reduce(d, { type: 'day/rollover', now: day2, date: key2 });
    d = reduce(d, { type: 'day/rollover', now: day3, date: key3 });

    expect(d.days.find((r) => r.date === key0)?.rolledOver).toBe(1);
    expect(d.days.find((r) => r.date === key1)?.rolledOver).toBe(1);
    expect(d.days.find((r) => r.date === key2)?.rolledOver).toBe(1);
    expect(d.tasks.find((t) => t.id === 'a')?.today).toBe(true); // still carrying forward
  });
});

describe('reducer: day/close (Task 2.3)', () => {
  it('upserts days[date] with closedAt and a trimmed note', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = reduce(d, { type: 'day/close', now: t0 + 5, date: ymd(t0), note: '  Good day  ' });
    const rec = d.days.find((r) => r.date === ymd(t0))!;
    expect(rec).toMatchObject({ closedAt: t0 + 5, note: 'Good day' });
  });
  it('an empty/whitespace-only note becomes undefined', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = reduce(d, { type: 'day/close', now: t0, date: ymd(t0), note: '   ' });
    expect(d.days.find((r) => r.date === ymd(t0))!.note).toBeUndefined();
  });
  it('a note over 500 chars is truncated', () => {
    let d = createEmptyData(t0, '2.0.0');
    const long = 'x'.repeat(600);
    d = reduce(d, { type: 'day/close', now: t0, date: ymd(t0), note: long });
    expect(d.days.find((r) => r.date === ymd(t0))!.note).toHaveLength(500);
  });
  it('no note given leaves note undefined', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = reduce(d, { type: 'day/close', now: t0, date: ymd(t0) });
    const rec = d.days.find((r) => r.date === ymd(t0))!;
    expect(rec.closedAt).toBe(t0);
    expect(rec.note).toBeUndefined();
  });
});
