// core/reducer — the single place Data changes. Pure: no Electron, no Node, no Date.now().
// Every action carries `now`; every new id comes from the caller. Unknown or
// not-yet-implemented actions are a no-op and return the same `Data` reference
// (immer's `produce` does this automatically when the recipe makes no changes).
import { produce } from 'immer';
import type { Data, Action, Task, Rule, Settings, DayRecord, Ymd } from './types';
import { INBOX_ID } from './defaults';
import { addDays, rolloverCutoffMs, ymd } from './dates';
import { nextOrder, orderBetween } from './select';
import { elapsedSeconds } from './timer';
import { nextOccurrence } from './recur';

const NOTE_MAX_LENGTH = 500;
const MIN_ADD_TIME_SECONDS = 60;
const MAX_ADD_TIME_SECONDS = 14400;

/** Finds `draft.days`' record for `date`, creating (and inserting, keeping `days`
 * sorted by date) a zeroed one if it doesn't exist yet. Used by `task/complete`,
 * `task/uncomplete`, `day/rollover`, `day/close`, and `foldTimerSegment` (so, since
 * Task 3.1, by `timer/pause` and `timer/stop` too) — the only places a `DayRecord`
 * is ever created or touched. */
function upsertDay(draft: Data, date: Ymd): DayRecord {
  let rec = draft.days.find((d) => d.date === date);
  if (!rec) {
    rec = { date, completed: 0, focusSeconds: 0, rolledOver: 0 };
    draft.days.push(rec);
    draft.days.sort((a, b) => a.date.localeCompare(b.date));
  }
  return rec;
}

/** Folds a running timer's segment (from `task.timer.runningSince` up to `at`) into
 * `spentSeconds`, clears `runningSince`, and records the folded seconds on
 * `days[ymd(clampedAt)].focusSeconds` (via `upsertDay`). `at` is clamped to
 * `>= runningSince` first (a clock moved backwards, or an explicit `at` before the
 * timer started, folds 0 — Task 3.1 rulings 2/5). No-op (returns 0, no day touched)
 * when `task` has no timer or it isn't running. The elapsed math itself is
 * `elapsedSeconds` from `./timer` (spentSeconds: 0 baseline) so this and every other
 * "fold the running segment" site — `task/complete` included — share one
 * implementation. Simplification (documented per ruling 5): a segment that spans
 * local midnight (e.g. 23:50 → 00:10) is recorded wholly on `ymd(at)`, not split
 * across the two calendar days. */
function foldTimerSegment(draft: Data, task: Task, at: number): number {
  const timer = task.timer;
  if (!timer || timer.runningSince === undefined) return 0;
  const clampedAt = Math.max(at, timer.runningSince);
  const elapsed = elapsedSeconds({ spentSeconds: 0, runningSince: timer.runningSince }, clampedAt);
  timer.spentSeconds += elapsed;
  timer.runningSince = undefined;
  upsertDay(draft, ymd(clampedAt)).focusSeconds += elapsed;
  return elapsed;
}

/** `id` plus every descendant of `id` in `tasks` (recursive, grown iteratively like
 * `task/delete`'s own cascade — Task 4.2 factors that cascade out to here so
 * `task/move`'s listId case can share it). */
function withDescendants(tasks: Task[], id: string): Set<string> {
  const ids = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of tasks) {
      if (t.parentId !== undefined && ids.has(t.parentId) && !ids.has(t.id)) {
        ids.add(t.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** Whether `candidateId` IS `ancestorId` or a descendant of it (walks `candidateId`'s own
 * `parentId` chain upward) — Task 4.2 addendum ruling 1's `task/move` rejection: a
 * task cannot become its own parent, nor a descendant of itself. Bounded by `tasks.length`
 * so a corrupt cyclic parentId chain can't loop forever. */
function isSelfOrDescendant(tasks: Task[], ancestorId: string, candidateId: string): boolean {
  let current = tasks.find((t) => t.id === candidateId);
  for (let i = 0; i < tasks.length && current; i++) {
    if (current.id === ancestorId) return true;
    current = current.parentId !== undefined ? tasks.find((t) => t.id === current!.parentId) : undefined;
  }
  return false;
}

/** Move a task to the front of Today: `today = true`, order below every other open Today task. */
function applyMakeCurrent(draft: Data, id: string, now: number): void {
  const task = draft.tasks.find((t) => t.id === id);
  if (!task) return;
  const others = draft.tasks.filter((t) => t.today && t.status === 'open' && t.id !== id);
  if (others.length > 0) {
    task.order = Math.min(...others.map((t) => t.order)) - 1000;
  }
  task.today = true;
  task.updatedAt = now;
}

// Deep-merges a settings patch into the draft, except `positions`, which is a
// Record<string, StripPosition> and is replaced whole rather than merged per key
// (a partial position entry is meaningless — see types.ts's DeepPartial comment).
function mergeSettingsPatch(target: any, patch: any): void {
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (value === undefined) continue;
    if (key === 'positions' || value === null || typeof value !== 'object' || Array.isArray(value)) {
      target[key] = value;
      continue;
    }
    if (target[key] !== null && typeof target[key] === 'object') {
      mergeSettingsPatch(target[key], value);
    } else {
      target[key] = value;
    }
  }
}

export function reduce(data: Data, action: Action): Data {
  return produce(data, (draft) => {
    switch (action.type) {
      case 'task/add': {
        // Controller ruling (fix round 1, defect 1b, defence in depth): a listId/parentId
        // that doesn't reference anything real (e.g. a paste's second line reused a
        // /list name whose paired list/add the reducer just no-op'd because an earlier
        // line in the same paste already created it) must not silently persist a
        // dangling reference — fall back to Inbox, and drop an unresolvable parentId.
        const requestedListId = action.listId ?? INBOX_ID;
        const listId = draft.lists.some((l) => l.id === requestedListId) ? requestedListId : INBOX_ID;
        const parentId = action.parentId !== undefined && draft.tasks.some((t) => t.id === action.parentId) ? action.parentId : undefined;
        const siblings = draft.tasks.filter((t) => t.listId === listId && t.parentId === parentId);
        const task: Task = {
          id: action.id,
          title: action.title,
          listId,
          parentId,
          tags: action.tags ?? [],
          order: nextOrder(siblings),
          today: action.makeCurrent ? true : (action.today ?? false),
          due: action.due,
          recurrence: action.recurrence,
          timer: action.plannedSeconds !== undefined ? { plannedSeconds: action.plannedSeconds, spentSeconds: 0 } : undefined,
          status: 'open',
          createdAt: action.now,
          updatedAt: action.now
        };
        draft.tasks.push(task);
        if (action.makeCurrent) applyMakeCurrent(draft, task.id, action.now);
        break;
      }

      case 'task/complete': {
        const task = draft.tasks.find((t) => t.id === action.id);
        if (!task) break;

        // Task 2.3, addendum ruling 2: the seconds folded into spentSeconds by THIS
        // completion (0 if no timer was running) also land in the day's focusSeconds.
        // Task 3.1 ruling 3: routed through the shared `foldTimerSegment` helper —
        // the same one `timer/pause`/`timer/stop` use — so this logic lives in one
        // place. It already records the folded seconds on `days[ymd(now)]`.
        foldTimerSegment(draft, task, action.now);

        task.status = 'done';
        task.completedAt = action.now;
        task.completedBy = action.by;
        task.updatedAt = action.now;

        const completionDay = upsertDay(draft, ymd(action.now));
        completionDay.completed += 1;

        if (draft.settings.score.enabled && action.by === 'user') {
          draft.settings.score.value += 1;
        }

        // Task 3.3: a recurring task with a `spawnId` schedules its next occurrence.
        // `after` is the later of the completed task's due date and today (string
        // compare on Ymd) so completing early doesn't spawn a duplicate for the same
        // date, and completing a task that's days overdue still spawns from today,
        // not from the stale due date. A task with `recurrence` but no `spawnId`
        // (e.g. a programmatic completion that opted out) spawns nothing.
        if (task.recurrence && action.spawnId) {
          const todayYmd = ymd(action.now);
          const dueOrToday = task.due?.date ?? todayYmd;
          const after = dueOrToday > todayYmd ? dueOrToday : todayYmd;
          const nextDate = nextOccurrence(task.recurrence, after);
          const parentStillExists = task.parentId !== undefined && draft.tasks.some((t) => t.id === task.parentId);
          const parentId = parentStillExists ? task.parentId : undefined;
          const siblings = draft.tasks.filter((t) => t.listId === task.listId && t.parentId === parentId);
          const spawned: Task = {
            id: action.spawnId,
            title: task.title,
            notes: task.notes,
            listId: task.listId,
            parentId,
            tags: [...task.tags],
            order: nextOrder(siblings),
            today: false,
            due: { date: nextDate, time: task.due?.time },
            recurrence: { ...task.recurrence } as Rule,
            timer: task.timer?.plannedSeconds !== undefined ? { plannedSeconds: task.timer.plannedSeconds, spentSeconds: 0 } : undefined,
            status: 'open',
            createdAt: action.now,
            updatedAt: action.now
          };
          draft.tasks.push(spawned);
        }
        break;
      }

      case 'task/uncomplete': {
        const task = draft.tasks.find((t) => t.id === action.id);
        if (!task) break;
        // Addendum ruling 2: decrement the ORIGINAL completion day's `completed`
        // (floor 0), read BEFORE completedAt is cleared below. Leaves focusSeconds
        // alone — the focus time was genuinely spent regardless of the reopen.
        if (task.completedAt !== undefined) {
          const rec = draft.days.find((d) => d.date === ymd(task.completedAt!));
          if (rec) rec.completed = Math.max(0, rec.completed - 1);
        }
        task.status = 'open';
        task.completedAt = undefined;
        task.completedBy = undefined;
        task.updatedAt = action.now;
        break;
      }

      case 'task/delete': {
        if (!draft.tasks.some((t) => t.id === action.id)) break;
        const toDelete = withDescendants(draft.tasks, action.id);
        draft.tasks = draft.tasks.filter((t) => !toDelete.has(t.id));
        break;
      }

      case 'task/makeCurrent': {
        applyMakeCurrent(draft, action.id, action.now);
        break;
      }

      case 'task/skip': {
        const task = draft.tasks.find((t) => t.id === action.id);
        if (!task) break;
        const todayOpen = draft.tasks.filter((t) => t.today && t.status === 'open');
        task.order = nextOrder(todayOpen);
        task.updatedAt = action.now;
        break;
      }

      case 'task/snooze': {
        const task = draft.tasks.find((t) => t.id === action.id);
        if (!task) break;
        task.snoozedUntil = action.until;
        task.updatedAt = action.now;
        break;
      }

      case 'task/setToday': {
        for (const id of action.ids) {
          const task = draft.tasks.find((t) => t.id === id);
          if (!task) continue;
          task.today = action.today;
          task.updatedAt = action.now;
        }
        break;
      }

      case 'settings/patch': {
        mergeSettingsPatch(draft.settings as unknown as Record<string, unknown>, action.patch as unknown as Record<string, unknown>);
        break;
      }

      case 'data/replace': {
        return action.data;
      }

      // Task 4.2 addendum ruling 1: patch fields are applied only when actually present
      // in `action.patch` (`'x' in patch`, not `patch.x !== undefined` — a present key
      // with value `undefined` is how a caller clears `due`/`notes`/`recurrence`, which
      // are all optional Task fields). `touched` tracks whether anything actually
      // changed so a patch that changes nothing (e.g. `{}`, or `{ title: '   ' }` alone)
      // leaves `draft` untouched and `produce` returns the same `Data` reference.
      case 'task/edit': {
        const task = draft.tasks.find((t) => t.id === action.id);
        if (!task) break;
        const patch = action.patch;
        let touched = false;

        if ('title' in patch && patch.title !== undefined) {
          const title = patch.title.trim();
          if (title !== '') {
            task.title = title;
            touched = true;
          }
        }
        if ('notes' in patch) {
          task.notes = patch.notes;
          touched = true;
        }
        if ('listId' in patch && patch.listId !== undefined) {
          task.listId = draft.lists.some((l) => l.id === patch.listId) ? patch.listId : INBOX_ID;
          touched = true;
        }
        if ('tags' in patch && patch.tags !== undefined) {
          const seen = new Set<string>();
          const tags: string[] = [];
          for (const raw of patch.tags) {
            const tag = raw.toLowerCase();
            if (seen.has(tag)) continue;
            seen.add(tag);
            tags.push(tag);
            if (tags.length >= 20) break;
          }
          task.tags = tags;
          touched = true;
        }
        if ('due' in patch) {
          task.due = patch.due;
          touched = true;
        }
        if ('recurrence' in patch) {
          task.recurrence = patch.recurrence;
          touched = true;
        }
        if (patch.today !== undefined) {
          task.today = patch.today;
          touched = true;
        }
        if ('plannedSeconds' in patch) {
          if (patch.plannedSeconds === null) {
            if (task.timer) {
              const keepTimer = task.timer.spentSeconds > 0 || task.timer.runningSince !== undefined;
              task.timer = keepTimer ? { ...task.timer, plannedSeconds: undefined } : undefined;
              touched = true;
            }
          } else if (patch.plannedSeconds !== undefined) {
            if (!task.timer) task.timer = { spentSeconds: 0 };
            task.timer.plannedSeconds = patch.plannedSeconds;
            touched = true;
          }
        }

        if (touched) task.updatedAt = action.now;
        break;
      }

      case 'task/move': {
        const task = draft.tasks.find((t) => t.id === action.id);
        if (!task) break;

        // 1. listId — cascades to every descendant too (ruling: "moves the task and its
        // children to that list"); applied first so a combined listId+afterId move scopes
        // the afterId step's sibling group to the NEW list, not the old one.
        if (action.listId !== undefined) {
          const listId = draft.lists.some((l) => l.id === action.listId) ? action.listId : INBOX_ID;
          if (listId !== task.listId) {
            const moved = withDescendants(draft.tasks, task.id);
            for (const t of draft.tasks) {
              if (moved.has(t.id)) t.listId = listId;
            }
            task.updatedAt = action.now;
          }
        }

        // 2. parentId — null detaches; an id attaches, rejecting (no-op) a target that is
        // this task itself, one of its own descendants, or itself a sub-task (only
        // top-level tasks may be parents).
        if (action.parentId !== undefined) {
          if (action.parentId === null) {
            if (task.parentId !== undefined) {
              task.parentId = undefined;
              task.updatedAt = action.now;
            }
          } else {
            const parentId = action.parentId;
            const target = draft.tasks.find((t) => t.id === parentId);
            const rejected = !target || target.parentId !== undefined || isSelfOrDescendant(draft.tasks, task.id, parentId);
            if (!rejected && task.parentId !== parentId) {
              task.parentId = parentId;
              task.updatedAt = action.now;
            }
          }
        }

        // 3. afterId — reorders within the task's CURRENT sibling group (same listId and
        // parentId as the task now has, after steps 1-2 above): null moves to the front
        // (order = min - 1000, or 1000 when the group is otherwise empty); an id places the
        // task immediately after that sibling via `orderBetween`. An `afterId` that isn't
        // (or is no longer, e.g. after a rejected/absent parentId move) an actual sibling is
        // a no-op for ordering.
        if (action.afterId !== undefined) {
          const siblings = draft.tasks
            .filter((t) => t.id !== task.id && t.listId === task.listId && t.parentId === task.parentId)
            .sort((a, b) => a.order - b.order);
          if (action.afterId === null) {
            const order = siblings.length > 0 ? siblings[0].order - 1000 : 1000;
            if (order !== task.order) {
              task.order = order;
              task.updatedAt = action.now;
            }
          } else {
            const idx = siblings.findIndex((t) => t.id === action.afterId);
            if (idx !== -1) {
              const order = orderBetween(siblings[idx].order, siblings[idx + 1]?.order);
              if (order !== task.order) {
                task.order = order;
                task.updatedAt = action.now;
              }
            }
          }
        }
        break;
      }

      case 'timer/start': {
        const task = draft.tasks.find((t) => t.id === action.id);
        if (!task || task.status === 'done') break;
        if (task.timer?.runningSince !== undefined) break; // already running: no-op

        // Any OTHER task with a running timer is paused first — fold its segment
        // into spent and into that day's focus (Task 3.1 ruling 3).
        for (const other of draft.tasks) {
          if (other.id === task.id || other.timer?.runningSince === undefined) continue;
          foldTimerSegment(draft, other, action.now);
          other.updatedAt = action.now;
        }

        // Controller clarification: create `{ spentSeconds: 0 }` with `plannedSeconds`
        // left undefined — pomodoro/default durations are applied elsewhere, not here.
        if (!task.timer) task.timer = { spentSeconds: 0 };
        task.timer.runningSince = action.now;
        task.timer.pausedAtSuspend = undefined;
        task.updatedAt = action.now;
        break;
      }

      case 'timer/startSession': {
        // Task 3.2 fix round 1 (supersedes addendum ruling 3): a pomodoro work
        // session always gets a FULL `seconds`-long plan, regardless of any prior
        // spentSeconds/plannedSeconds — a task that already finished one session
        // (spentSeconds >= its old plannedSeconds) must not expire at 0 ms on the
        // next Start. `plannedSeconds = spentSeconds + seconds` makes the REMAINING
        // time exactly `seconds`, the same invariant `expiryAt` already assumes.
        const task = draft.tasks.find((t) => t.id === action.id);
        if (!task || task.status === 'done') break;
        if (task.timer?.runningSince !== undefined) break; // already running: no-op

        // Any OTHER task with a running timer is paused first, exactly like timer/start.
        for (const other of draft.tasks) {
          if (other.id === task.id || other.timer?.runningSince === undefined) continue;
          foldTimerSegment(draft, other, action.now);
          other.updatedAt = action.now;
        }

        if (!task.timer) task.timer = { spentSeconds: 0 };
        task.timer.plannedSeconds = task.timer.spentSeconds + action.seconds;
        task.timer.runningSince = action.now;
        task.timer.pausedAtSuspend = undefined;
        task.updatedAt = action.now;
        break;
      }

      case 'timer/pause': {
        const task = draft.tasks.find((t) => t.id === action.id);
        if (!task || task.timer?.runningSince === undefined) break;
        const at = Math.min(action.at ?? action.now, action.now); // foldTimerSegment clamps at >= runningSince
        foldTimerSegment(draft, task, at);
        task.updatedAt = action.now;
        break;
      }

      case 'timer/stop': {
        const task = draft.tasks.find((t) => t.id === action.id);
        if (!task || task.timer?.runningSince === undefined) break;
        // Controller clarification: identical to timer/pause at `now`, plus clearing
        // pausedAtSuspend. plannedSeconds/spentSeconds are otherwise unchanged.
        foldTimerSegment(draft, task, action.now);
        task.timer.pausedAtSuspend = undefined;
        task.updatedAt = action.now;
        break;
      }

      case 'timer/addTime': {
        const task = draft.tasks.find((t) => t.id === action.id);
        if (!task) break;
        // The zod schema doesn't bound `seconds` (schema.ts's TimerAddTimeSchema is a
        // plain z.number()); clamp here per the brief (60..14400).
        const seconds = Math.min(MAX_ADD_TIME_SECONDS, Math.max(MIN_ADD_TIME_SECONDS, action.seconds));
        if (!task.timer) task.timer = { spentSeconds: 0 };
        task.timer.plannedSeconds = (task.timer.plannedSeconds ?? 0) + seconds;
        task.updatedAt = action.now;
        if (draft.settings.score.enabled) draft.settings.score.value -= 1;
        break;
      }

      case 'list/add': {
        const name = action.name.trim();
        const idExists = draft.lists.some((l) => l.id === action.id);
        const nameExists = draft.lists.some((l) => l.name.toLowerCase() === name.toLowerCase());
        if (idExists || nameExists) break;
        const order = draft.lists.length > 0 ? Math.max(...draft.lists.map((l) => l.order)) + 1000 : 1000;
        draft.lists.push({ id: action.id, name, order, createdAt: action.now });
        break;
      }

      case 'list/rename': // implemented in Task 4.3
      case 'list/delete': // implemented in Task 4.3
        break;

      case 'day/rollover': {
        // Addendum ruling 3: idempotent per `date` — a record already carrying
        // `rolloverAppliedAt` means this exact date's rollover already ran; leave the
        // draft untouched so `produce` returns the same `Data` reference.
        const existing = draft.days.find((d) => d.date === action.date);
        if (existing?.rolloverAppliedAt !== undefined) break;

        // "Belonged to an earlier day": created before 04:00 local on `date`'s
        // calendar day.
        const cutoff = rolloverCutoffMs(action.date);
        const rolledCount = draft.tasks.filter(
          (t) => t.status === 'open' && t.parentId === undefined && t.today && t.createdAt < cutoff
        ).length;

        if (rolledCount > 0) {
          const prevDay = upsertDay(draft, addDays(action.date, -1));
          prevDay.rolledOver += rolledCount;
        }

        const today = upsertDay(draft, action.date);
        today.rolloverAppliedAt = action.now;
        break;
      }

      case 'day/close': {
        const rec = upsertDay(draft, action.date);
        rec.closedAt = action.now;
        const trimmed = action.note?.trim();
        rec.note = trimmed && trimmed.length > 0 ? trimmed.slice(0, NOTE_MAX_LENGTH) : undefined;
        break;
      }

      default: {
        const _exhaustive: never = action;
        void _exhaustive;
      }
    }
    return undefined;
  }) as Data;
}
