import { describe, expect, it } from 'vitest';
import { reducer, tickDelta, MAX_TICK_GAP_MS, type AppAction } from '../src/renderer/store/reducer';
import { createEmptyState, ensureAlignedTasks } from '../src/shared/stateHelpers';
import type { AppState, Task } from '../src/shared/types';

const T0 = '2026-10-16T10:00:00.000Z';

const task = (id: string, seconds?: number, extra: Partial<Task> = {}): Task => ({
  id,
  title: `Task ${id}`,
  createdAt: T0,
  updatedAt: T0,
  timeAssignedSeconds: seconds,
  remainingSeconds: seconds,
  status: 'pending',
  history: [],
  ...extra
});

const stateWith = (tasks: Task[], patch: Partial<AppState> = {}): AppState => ({
  ...createEmptyState('test', new Date(T0)),
  tasks: ensureAlignedTasks(tasks),
  ...patch
});

const run = (state: AppState, ...actions: AppAction[]): AppState => actions.reduce(reducer, state);
const tick = (now = T0): AppAction => ({ type: 'tick', now });

describe('tick', () => {
  it('counts down only the first open task', () => {
    const next = run(stateWith([task('a', 3), task('b', 60)]), tick());
    expect(next.tasks[0].remainingSeconds).toBe(2);
    expect(next.tasks[0].status).toBe('in_progress');
    expect(next.tasks[1].remainingSeconds).toBe(60);
    expect(next.tasks[1].status).toBe('pending');
  });

  it('does not count down a paused task', () => {
    const next = run(stateWith([task('a', 3, { isPaused: true })]), tick());
    expect(next.tasks[0].remainingSeconds).toBe(3);
  });

  it('does nothing when the current task has no time', () => {
    const start = stateWith([task('a'), task('b', 60)]);
    expect(run(start, tick())).toBe(start);
  });

  it('strikes the task at zero, awards +1, counts it, and starts the next one', () => {
    const next = run(stateWith([task('a', 1), task('b', 60)], { score: 5 }), tick());
    expect(next.tasks[0].status).toBe('struck');
    expect(next.tasks[0].history.at(-1)?.type).toBe('auto_complete');
    expect(next.score).toBe(6);
    expect(next.stats.totalCompleted).toBe(1);
    expect(next.tasks[1].status).toBe('in_progress');
  });

  it('dates completions by the local calendar day, not UTC', () => {
    // 20:00 UTC on the 16th is 01:30 on the 17th in India.
    const next = run(stateWith([task('a', 1)]), tick('2026-10-16T20:00:00.000Z'));
    expect(next.stats.lastCompletionDate).toBe('2026-10-17');
    expect(next.stats.todayCompleted).toBe(1);
  });

  it('resets the today counter on the first completion of a new day', () => {
    const start = stateWith([task('a', 1)], { stats: { totalCompleted: 9, todayCompleted: 4, lastCompletionDate: '2026-10-15' } });
    const next = run(start, tick());
    expect(next.stats).toEqual({ totalCompleted: 10, todayCompleted: 1, lastCompletionDate: '2026-10-16' });
  });
});

describe('tickDelta', () => {
  it('charges whole seconds and carries the remainder', () => {
    expect(tickDelta(0, 2500, 0)).toEqual({ elapsed: 2, carry: 500 });
    expect(tickDelta(2500, 3000, 500)).toEqual({ elapsed: 1, carry: 0 });
  });

  it('charges nothing for a sleep-sized gap', () => {
    expect(tickDelta(0, MAX_TICK_GAP_MS + 1, 0)).toEqual({ elapsed: 0, carry: 0 });
  });

  it('charges nothing when the clock goes backwards', () => {
    expect(tickDelta(10_000, 5_000, 0)).toEqual({ elapsed: 0, carry: 0 });
  });
});

describe('manual completion and time changes', () => {
  it('completing early awards +2 and advances', () => {
    const next = run(stateWith([task('a', 600), task('b', 60)]), { type: 'manualComplete', now: T0 });
    expect(next.score).toBe(2);
    expect(next.tasks[0].status).toBe('completed');
    expect(next.tasks[0].history.at(-1)).toMatchObject({ type: 'manual_complete', amountSeconds: 600 });
    expect(next.tasks[1].status).toBe('in_progress');
  });

  it('adding time costs a point only when the task already had time', () => {
    const withTime = run(stateWith([task('a', 600)]), { type: 'addTime', payload: { taskId: 'a', seconds: 300, now: T0 } });
    expect(withTime.score).toBe(-1);
    expect(withTime.tasks[0].remainingSeconds).toBe(900);
    const fresh = run(stateWith([task('a')]), { type: 'addTime', payload: { taskId: 'a', seconds: 300, now: T0 } });
    expect(fresh.score).toBe(0);
    expect(fresh.tasks[0].status).toBe('in_progress');
  });

  it('editing time up costs a point, editing down does not', () => {
    const up = run(stateWith([task('a', 600)]), { type: 'updateTask', payload: { taskId: 'a', title: 'x', seconds: 900, now: T0 } });
    expect(up.score).toBe(-1);
    expect(up.tasks[0].remainingSeconds).toBe(900);
    const down = run(stateWith([task('a', 600)]), { type: 'updateTask', payload: { taskId: 'a', title: 'x', seconds: 300, now: T0 } });
    expect(down.score).toBe(0);
    expect(down.tasks[0].remainingSeconds).toBe(300);
  });
});

describe("time's up → +5 min", () => {
  it('undoes the automatic completion and makes the task current again', () => {
    const expired = run(stateWith([task('a', 1), task('b', 60)], { score: 10 }), tick());
    expect(expired.score).toBe(11);
    const reopened = run(expired, { type: 'reopenWithTime', payload: { taskId: 'a', seconds: 300, now: T0 } });
    expect(reopened.tasks[0].id).toBe('a');
    expect(reopened.tasks[0].status).toBe('in_progress');
    expect(reopened.tasks[0].remainingSeconds).toBe(300);
    expect(reopened.tasks[1].status).toBe('pending');
    // Back to the original 10, minus the usual point for adding time.
    expect(reopened.score).toBe(9);
    expect(reopened.stats.totalCompleted).toBe(0);
    expect(reopened.stats.todayCompleted).toBe(0);
  });

  it('ignores tasks that did not run out of time', () => {
    const start = stateWith([task('a', 60)]);
    expect(run(start, { type: 'reopenWithTime', payload: { taskId: 'a', seconds: 300, now: T0 } })).toBe(start);
  });
});

describe('list management', () => {
  it('reorders and keeps unlisted tasks at the end', () => {
    const next = run(stateWith([task('a', 60), task('b', 60), task('c', 60)]), {
      type: 'reorderTasks',
      payload: { orderedTaskIds: ['c', 'a'], now: T0 }
    });
    expect(next.tasks.map((t) => t.id)).toEqual(['c', 'a', 'b']);
    expect(next.tasks[0].status).toBe('in_progress');
    expect(next.tasks[1].status).toBe('pending');
  });

  it('deletes several tasks at once and re-picks the current task', () => {
    const next = run(stateWith([task('a', 60), task('b', 60), task('c', 60)]), {
      type: 'deleteTasks',
      payload: { taskIds: ['a', 'b'], now: T0 }
    });
    expect(next.tasks.map((t) => t.id)).toEqual(['c']);
    expect(next.tasks[0].status).toBe('in_progress');
  });

  it('clears only finished tasks and keeps the counters', () => {
    const start = stateWith([task('a', 60, { status: 'completed' }), task('b', 60)], {
      stats: { totalCompleted: 3, todayCompleted: 1, lastCompletionDate: '2026-10-16' }
    });
    const next = run(start, { type: 'clearFinished', now: T0 });
    expect(next.tasks.map((t) => t.id)).toEqual(['b']);
    expect(next.stats.totalCompleted).toBe(3);
  });
});

describe('preferences', () => {
  it('switches theme and remembers or forgets a focus position', () => {
    let next = run(stateWith([]), { type: 'setTheme', payload: { theme: 'light' } });
    expect(next.preferences.theme).toBe('light');
    next = run(next, { type: 'setFocusPosition', payload: { theme: 'light', position: { x: 10, y: 20 } } });
    expect(next.preferences.focusPositions?.light).toEqual({ x: 10, y: 20 });
    next = run(next, { type: 'setFocusPosition', payload: { theme: 'light', position: null } });
    expect(next.preferences.focusPositions?.light).toBeUndefined();
  });
});
