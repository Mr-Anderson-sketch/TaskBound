import { describe, expect, it } from 'vitest';
import { parseQuickAdd, parseTaskLines } from '../src/renderer/utils/parse';
import { reducer, promoteDueTasks, type AppAction } from '../src/renderer/store/reducer';
import { createEmptyState, ensureAlignedTasks, isQueued, isScheduled } from '../src/shared/stateHelpers';
import type { AppState, Task } from '../src/shared/types';

// Local wall-clock dates so the expectations hold in any time zone.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute, 0, 0);
const NOW = at(23, 10); // Monday 23 Nov 2026, 10:00 local
const iso = (date: Date) => date.toISOString();

describe('parseQuickAdd start times', () => {
  it.each([
    ['Deep work 1h30 at 9:00 pm', 'Deep work', 90 * 60, at(23, 21)],
    ['Deep work at 2pm 1h30', 'Deep work', 90 * 60, at(23, 14)],
    ['Gym 6pm 45m', 'Gym', 45 * 60, at(23, 18)],
    ['Standup @11:30 15m', 'Standup', 15 * 60, at(23, 11, 30)],
    ['Review 21:00 20m', 'Review', 20 * 60, at(23, 21)]
  ])('%s', (input, title, seconds, start) => {
    expect(parseQuickAdd(input, NOW)).toEqual({ title, seconds, startAt: iso(start) });
  });

  it('reads a start time without a duration', () => {
    expect(parseQuickAdd('Call Priya at 3', NOW)).toEqual({ title: 'Call Priya', startAt: iso(at(23, 15)) });
  });

  it('reads hours without am/pm as working hours', () => {
    expect(parseQuickAdd('A at 7', NOW).startAt).toBe(iso(at(24, 7))); // 7 AM has passed today
    expect(parseQuickAdd('A at 11', NOW).startAt).toBe(iso(at(23, 11)));
    expect(parseQuickAdd('A at 12', NOW).startAt).toBe(iso(at(23, 12)));
    expect(parseQuickAdd('A at 6', NOW).startAt).toBe(iso(at(23, 18)));
    expect(parseQuickAdd('A at 0:30', NOW).startAt).toBe(iso(at(24, 0, 30)));
  });

  it('rolls a time that has passed today over to tomorrow', () => {
    expect(parseQuickAdd('Plan 9am', NOW).startAt).toBe(iso(at(24, 9)));
  });

  it('understands today and tomorrow on either side', () => {
    expect(parseQuickAdd('Gym tomorrow 6pm', NOW)).toEqual({ title: 'Gym', startAt: iso(at(24, 18)) });
    expect(parseQuickAdd('Gym 6pm tomorrow', NOW)).toEqual({ title: 'Gym', startAt: iso(at(24, 18)) });
    expect(parseQuickAdd('Gym tomorrow at 7 30m', NOW)).toEqual({ title: 'Gym', seconds: 30 * 60, startAt: iso(at(24, 7)) });
    // "today" keeps a passed time today, so it starts at once.
    expect(parseQuickAdd('Plan today 9am', NOW).startAt).toBe(iso(at(23, 9)));
  });

  it('never reads a bare number as a time', () => {
    expect(parseQuickAdd('Read chapter 2', NOW)).toEqual({ title: 'Read chapter 2' });
    expect(parseQuickAdd('Call 3 people', NOW)).toEqual({ title: 'Call 3 people' });
    expect(parseQuickAdd('Q4 plan', NOW)).toEqual({ title: 'Q4 plan' });
  });

  it('rejects impossible clock times', () => {
    expect(parseQuickAdd('A 13pm', NOW)).toEqual({ title: 'A 13pm' });
    expect(parseQuickAdd('A at 25', NOW)).toEqual({ title: 'A at 25' });
  });

  it('needs a title left over', () => {
    expect(parseQuickAdd('at 9pm', NOW)).toEqual({ title: 'at 9pm' });
  });

  it('keeps the legacy duration formats working', () => {
    expect(parseQuickAdd('Write report [01:30]', NOW)).toEqual({ title: 'Write report', seconds: 90 * 60 });
    expect(parseQuickAdd('Testing; 15', NOW)).toEqual({ title: 'Testing', seconds: 15 * 60 });
  });

  it('applies to each line of a bulk add', () => {
    expect(parseTaskLines('A 10m at 2pm\nB', NOW)).toEqual([
      { title: 'A', seconds: 600, startAt: iso(at(23, 14)) },
      { title: 'B' }
    ]);
  });
});

const T0 = iso(NOW);
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
  ...createEmptyState('test', NOW),
  tasks: ensureAlignedTasks(tasks),
  ...patch
});
const run = (state: AppState, ...actions: AppAction[]): AppState => actions.reduce(reducer, state);
const ids = (tasks: Task[]) => tasks.map((t) => t.id);

describe('scheduled tasks', () => {
  const later = iso(at(23, 11));

  it('wait outside the queue and never become current early', () => {
    const state = stateWith([task('s', 600, { scheduledAt: later }), task('a', 60)]);
    expect(state.tasks[0].status).toBe('pending');
    expect(state.tasks[1].status).toBe('in_progress');
    expect(isScheduled(state.tasks[0])).toBe(true);
    expect(isQueued(state.tasks[0])).toBe(false);
    const next = run(state, { type: 'tick', now: T0 });
    expect(next.tasks.find((t) => t.id === 's')?.remainingSeconds).toBe(600);
    expect(next.tasks.find((t) => t.id === 'a')?.remainingSeconds).toBe(59);
  });

  it('start at their time, ahead of what was running, which keeps its time', () => {
    const state = stateWith([task('a', 300, { remainingSeconds: 120 }), task('s', 600, { scheduledAt: later })]);
    const next = run(state, { type: 'tick', now: later });
    expect(ids(next.tasks)).toEqual(['s', 'a']);
    const s = next.tasks[0];
    expect(s.scheduledAt).toBeUndefined();
    expect(s.status).toBe('in_progress');
    expect(s.remainingSeconds).toBe(599);
    expect(s.history.at(-1)?.type).toBe('scheduled_start');
    expect(next.tasks[1]).toMatchObject({ status: 'pending', remainingSeconds: 120 });
  });

  it('start in time order when several are overdue', () => {
    const state = stateWith([task('late', 60, { scheduledAt: iso(at(23, 9, 30)) }), task('early', 60, { scheduledAt: iso(at(23, 9)) })]);
    expect(ids(promoteDueTasks(state, T0).tasks)).toEqual(['early', 'late']);
  });

  it('unpause when they start', () => {
    const state = stateWith([task('s', 60, { scheduledAt: T0, isPaused: true })]);
    expect(promoteDueTasks(state, T0).tasks[0].isPaused).toBe(false);
  });

  it('leave state untouched when nothing is due', () => {
    const state = stateWith([task('s', 60, { scheduledAt: later })]);
    expect(promoteDueTasks(state, T0)).toBe(state);
  });

  it('can be added with a start time', () => {
    const next = run(stateWith([task('a', 60)]), { type: 'addTask', payload: { id: 'n', title: 'New', seconds: 60, startAt: later, now: T0 } });
    expect(next.tasks.find((t) => t.id === 'n')).toMatchObject({ scheduledAt: later, status: 'pending' });
    expect(next.tasks[0].status).toBe('in_progress');
  });

  it('can be rescheduled or cleared by editing, and an edit without startAt keeps it', () => {
    const base = stateWith([task('s', 60, { scheduledAt: later })]);
    const moved = run(base, { type: 'updateTask', payload: { taskId: 's', title: 'S', seconds: 60, startAt: iso(at(23, 12)), now: T0 } });
    expect(moved.tasks[0].scheduledAt).toBe(iso(at(23, 12)));
    const kept = run(base, { type: 'updateTask', payload: { taskId: 's', title: 'S', seconds: 60, now: T0 } });
    expect(kept.tasks[0].scheduledAt).toBe(later);
    const cleared = run(base, { type: 'updateTask', payload: { taskId: 's', title: 'S', seconds: 60, startAt: null, now: T0 } });
    expect(cleared.tasks[0].scheduledAt).toBeUndefined();
    expect(cleared.tasks[0].status).toBe('in_progress');
  });

  it('scheduling the current task hands the slot to the next one', () => {
    const base = stateWith([task('a', 60), task('b', 60)]);
    const next = run(base, { type: 'updateTask', payload: { taskId: 'a', title: 'A', seconds: 60, startAt: later, now: T0 } });
    expect(next.tasks.find((t) => t.id === 'a')?.status).toBe('pending');
    expect(next.tasks.find((t) => t.id === 'b')?.status).toBe('in_progress');
  });

  it('"Start now" clears the schedule and makes it current; "Unschedule" sends it to the back', () => {
    const base = stateWith([task('a', 60), task('s', 60, { scheduledAt: later }), task('b', 60)]);
    const now = run(base, { type: 'unschedule', payload: { taskId: 's', to: 'front', now: T0 } });
    expect(ids(now.tasks)).toEqual(['s', 'a', 'b']);
    expect(now.tasks[0]).toMatchObject({ scheduledAt: undefined, status: 'in_progress' });
    const end = run(base, { type: 'unschedule', payload: { taskId: 's', to: 'end', now: T0 } });
    expect(ids(end.tasks)).toEqual(['a', 'b', 's']);
    expect(end.tasks[2].scheduledAt).toBeUndefined();
  });
});

describe('allowSite', () => {
  it('lets a site through for the task and costs a point, once', () => {
    const base = stateWith([task('a', 60)], { score: 4 });
    const once = run(base, { type: 'allowSite', payload: { taskId: 'a', site: 'youtube.com', now: T0 } });
    expect(once.score).toBe(3);
    expect(once.tasks[0].allowedSites).toEqual(['youtube.com']);
    expect(once.tasks[0].history.at(-1)).toMatchObject({ type: 'allow_site', site: 'youtube.com' });
    const twice = run(once, { type: 'allowSite', payload: { taskId: 'a', site: 'youtube.com', now: T0 } });
    expect(twice).toBe(once);
  });

  it('does nothing for a finished task', () => {
    const base = stateWith([task('a', 60, { status: 'completed' })]);
    expect(run(base, { type: 'allowSite', payload: { taskId: 'a', site: 'x.com', now: T0 } })).toBe(base);
  });
});

describe('parseQuickAdd "at" handling', () => {
  it('drops a dangling "at" but keeps words that end in "at"', () => {
    expect(parseQuickAdd('Call Priya at 9pm', NOW)).toEqual({ title: 'Call Priya', startAt: iso(at(23, 21)) });
    expect(parseQuickAdd('Feed the cat 9pm', NOW)).toEqual({ title: 'Feed the cat', startAt: iso(at(23, 21)) });
    expect(parseQuickAdd('Gym tomorrow at 6pm', NOW)).toEqual({ title: 'Gym', startAt: iso(at(24, 18)) });
  });
});
