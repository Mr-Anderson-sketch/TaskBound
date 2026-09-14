// core/select — read-only queries over Data. No mutation, no Date.now(): callers pass `now`.
import type { Data, Task, Id } from './types';
import { INBOX_ID } from './defaults';

export interface TodayView {
  current?: Task;
  next: Task[];
  done: number;
  total: number;
  unplanned: boolean /* Today empty, current came from Inbox */;
}

const NEXT_LIMIT = 5;

/** Whether `t` is snoozed at instant `now` (strict: exactly at snoozedUntil is no longer snoozed). */
export function isSnoozed(t: Task, now: number): boolean {
  return t.snoozedUntil !== undefined && t.snoozedUntil > now;
}

function byOrderThenCreated(a: Task, b: Task): number {
  return a.order - b.order || a.createdAt - b.createdAt;
}

function candidates(data: Data, now: number, predicate: (t: Task) => boolean): Task[] {
  return data.tasks
    .filter((t) => t.status === 'open' && t.parentId === undefined && !isSnoozed(t, now) && predicate(t))
    .sort(byOrderThenCreated);
}

/**
 * The strip's view of "what's current": open, top-level, non-snoozed tasks marked
 * `today`, ordered by `order` then `createdAt`. If none exist, falls back to the
 * Inbox list and flags `unplanned`. `done`/`total` always describe the full set of
 * Today tasks (any status), not just the candidates above.
 */
export function todayView(data: Data, now: number): TodayView {
  const todayTasks = data.tasks.filter((t) => t.today);
  const done = todayTasks.filter((t) => t.status === 'done').length;
  const total = todayTasks.length;

  const todayCandidates = candidates(data, now, (t) => t.today);
  if (todayCandidates.length > 0) {
    const [current, ...rest] = todayCandidates;
    return { current, next: rest.slice(0, NEXT_LIMIT), done, total, unplanned: false };
  }

  const inboxCandidates = candidates(data, now, (t) => t.listId === INBOX_ID);
  if (inboxCandidates.length > 0) {
    const [current, ...rest] = inboxCandidates;
    return { current, next: rest.slice(0, NEXT_LIMIT), done, total, unplanned: true };
  }

  return { current: undefined, next: [], done, total, unplanned: false };
}

export function currentTask(data: Data, now: number): Task | undefined {
  return todayView(data, now).current;
}

/** Open, top-level tasks in a list, ordered by `order` then `createdAt`. */
export function tasksInList(data: Data, listId: Id): Task[] {
  return data.tasks
    .filter((t) => t.status === 'open' && t.parentId === undefined && t.listId === listId)
    .sort(byOrderThenCreated);
}

/** Next order value after the given tasks: max(order)+1000, or 1000 when empty. */
export function nextOrder(tasks: Task[]): number {
  if (tasks.length === 0) return 1000;
  return Math.max(...tasks.map((t) => t.order)) + 1000;
}

/** Fractional-insert order between two neighbors (either may be absent). */
export function orderBetween(a?: number, b?: number): number {
  if (a === undefined && b === undefined) return 1000;
  if (a === undefined) return b! - 1000;
  if (b === undefined) return a + 1000;
  return (a + b) / 2;
}
