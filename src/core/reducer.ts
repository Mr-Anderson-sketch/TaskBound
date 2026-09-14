// core/reducer — the single place Data changes. Pure: no Electron, no Node, no Date.now().
// Every action carries `now`; every new id comes from the caller. Unknown or
// not-yet-implemented actions are a no-op and return the same `Data` reference
// (immer's `produce` does this automatically when the recipe makes no changes).
import { produce } from 'immer';
import type { Data, Action, Task, Rule, Settings } from './types';
import { INBOX_ID } from './defaults';
import { addDays } from './dates';
import { nextOrder } from './select';

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
        const listId = action.listId ?? INBOX_ID;
        const siblings = draft.tasks.filter((t) => t.listId === listId && t.parentId === action.parentId);
        const task: Task = {
          id: action.id,
          title: action.title,
          listId,
          parentId: action.parentId,
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

        if (task.timer?.runningSince !== undefined) {
          const elapsed = Math.max(0, action.now - task.timer.runningSince) / 1000;
          task.timer.spentSeconds = Math.round(task.timer.spentSeconds + elapsed);
          task.timer.runningSince = undefined;
        }

        task.status = 'done';
        task.completedAt = action.now;
        task.completedBy = action.by;
        task.updatedAt = action.now;

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

      case 'timer/start': // implemented in Task 3.1
      case 'timer/pause': // implemented in Task 3.1
      case 'timer/stop': // implemented in Task 3.1
      case 'timer/addTime': // implemented in Task 3.1
        break;

      case 'list/add': // implemented in Task 4.3
      case 'list/rename': // implemented in Task 4.3
      case 'list/delete': // implemented in Task 4.3
        break;

      case 'day/rollover': // implemented in Task 2.3
      case 'day/close': // implemented in Task 2.3
        break;

      default: {
        const _exhaustive: never = action;
        void _exhaustive;
      }
    }
    return undefined;
  }) as Data;
}
