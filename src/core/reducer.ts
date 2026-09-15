// core/reducer — the single place Data changes. Pure: no Electron, no Node, no Date.now().
// Every action carries `now`; every new id comes from the caller. Unknown or
// not-yet-implemented actions are a no-op and return the same `Data` reference
// (immer's `produce` does this automatically when the recipe makes no changes).
import { produce } from 'immer';
import type { Data, Action, Task, Rule, Settings, DayRecord, Ymd } from './types';
import { INBOX_ID } from './defaults';
import { addDays, rolloverCutoffMs, ymd } from './dates';
import { nextOrder } from './select';
import { elapsedSeconds } from './timer';

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

        // TEMPORARY stub, replaced by nextOccurrence in Task 3.3: only handles
        // `daily` recurrence on a task with a due date; every other kind spawns nothing yet.
        if (task.recurrence && action.spawnId && task.recurrence.kind === 'daily' && task.due) {
          const next: Task = {
            id: action.spawnId,
            title: task.title,
            notes: task.notes,
            listId: task.listId,
            parentId: task.parentId,
            tags: [...task.tags],
            order: task.order,
            today: false,
            due: { ...task.due, date: addDays(task.due.date, 1) },
            recurrence: { ...task.recurrence } as Rule,
            timer: task.timer?.plannedSeconds !== undefined ? { plannedSeconds: task.timer.plannedSeconds, spentSeconds: 0 } : undefined,
            status: 'open',
            createdAt: action.now,
            updatedAt: action.now
          };
          draft.tasks.push(next);
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
        const toDelete = new Set<string>([action.id]);
        let grew = true;
        while (grew) {
          grew = false;
          for (const t of draft.tasks) {
            if (t.parentId !== undefined && toDelete.has(t.parentId) && !toDelete.has(t.id)) {
              toDelete.add(t.id);
              grew = true;
            }
          }
        }
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

      // Every action below this line is a deliberate no-op for now: the draft is
      // left untouched, so immer's `produce` returns the original `data` reference.
      case 'task/edit': // implemented in Task 4.3
      case 'task/move': // implemented in Task 4.3
        break;

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
