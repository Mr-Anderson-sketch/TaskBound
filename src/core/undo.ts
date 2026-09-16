// core/undo — undo/redo by REPLAY (final-review fix 4). Each undo entry keeps the
// `Data` from just before an undoable action, the action itself, and every
// NON-undoable data-changing action dispatched after it (timers, settings, rollover…).
// Undoing the newest entry rebuilds `before` + those later actions — skipping only the
// undone one — so undo never rolls back a timer session or a settings change that
// happened afterwards. Reducers are pure and every action carries `now` and its ids,
// so replay is deterministic. Redo re-applies the undone action to the CURRENT data.
// Immer's structural sharing keeps the `before` snapshots cheap. Pure: no Electron, no Node.
import type { Action, Data } from './types';
import { reduce } from './reducer';

interface UndoEntry {
  before: Data;
  action: Action;
  label: string;
  /** Non-undoable data-changing actions dispatched after `action`, in order. */
  after: Action[];
}

interface RedoEntry {
  action: Action;
  label: string;
}

/** Most non-undoable actions one undo entry replays. Past this the whole undo/redo
 * history is cleared rather than grown without bound (e.g. hours of timer ticks and
 * settings drags since the last undoable action). */
export const UNDO_AFTER_LIMIT = 1000;

export class UndoStack {
  private undoEntries: UndoEntry[] = [];
  private redoEntries: RedoEntry[] = [];

  constructor(
    private limit = 50,
    private afterLimit = UNDO_AFTER_LIMIT
  ) {}

  /** Records an undoable `action` that just changed `before` into new data; clears redo. */
  push(before: Data, action: Action, label: string): void {
    this.clearRedo();
    this.pushEntry({ before, action, label, after: [] });
  }

  /** Records a NON-undoable, data-changing `action` so undoing the newest entry
   * replays it instead of discarding it. Leaves redo alone (redo re-applies onto
   * whatever the data is by then). Clears all history past `afterLimit`. */
  recordNonUndoable(action: Action): void {
    const newest = this.undoEntries[this.undoEntries.length - 1];
    if (!newest) return;
    newest.after.push(action);
    if (newest.after.length > this.afterLimit) this.clear();
  }

  /** Undoes the newest entry: `before` plus a replay of its `after` actions. Those
   * replayed actions now follow the previous entry, so they carry over to it. */
  undo(): { data: Data; label: string } | undefined {
    const entry = this.undoEntries.pop();
    if (!entry) return undefined;
    const data = entry.after.reduce(reduce, entry.before);
    const previous = this.undoEntries[this.undoEntries.length - 1];
    if (previous && entry.after.length > 0) {
      previous.after.push(...entry.after);
      if (previous.after.length > this.afterLimit) {
        this.clear();
        return { data, label: entry.label };
      }
    }
    this.redoEntries.push({ action: entry.action, label: entry.label });
    return { data, label: entry.label };
  }

  /** Re-applies the newest undone action to `current`, making it undoable again. */
  redo(current: Data): { data: Data; label: string } | undefined {
    const entry = this.redoEntries.pop();
    if (!entry) return undefined;
    const data = reduce(current, entry.action);
    this.pushEntry({ before: current, action: entry.action, label: entry.label, after: [] });
    return { data, label: entry.label };
  }

  clearRedo(): void {
    this.redoEntries = [];
  }

  clear(): void {
    this.undoEntries = [];
    this.redoEntries = [];
  }

  get canUndo(): boolean {
    return this.undoEntries.length > 0;
  }

  get canRedo(): boolean {
    return this.redoEntries.length > 0;
  }

  private pushEntry(entry: UndoEntry): void {
    this.undoEntries.push(entry);
    if (this.undoEntries.length > this.limit) {
      this.undoEntries.shift();
    }
  }
}

export const UNDOABLE_TYPES = [
  'task/add',
  'task/edit',
  'task/complete',
  'task/uncomplete',
  'task/delete',
  'task/move',
  'task/makeCurrent',
  'task/skip',
  'task/snooze',
  'task/setToday',
  'timer/stop',
  'timer/addTime',
  'list/add',
  'list/rename',
  'list/delete',
  'day/close'
] as const;

export type UndoableType = (typeof UNDOABLE_TYPES)[number];

export const UNDOABLE: ReadonlySet<Action['type']> = new Set(UNDOABLE_TYPES);

export type UndoableAction = Extract<Action, { type: UndoableType }>;

export function isUndoable(action: Action): action is UndoableAction {
  return UNDOABLE.has(action.type);
}

const MAX_TITLE_LENGTH = 40;

function truncate(title: string): string {
  return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH)}…` : title;
}

function titleFor(data: Data, id: string): string | undefined {
  return data.tasks.find((t) => t.id === id)?.title;
}

/** Human, sentence-case copy for the undo/redo toast. Looks the title up in
 * `data.tasks` by `action.id` (BEFORE the action is applied — callers must
 * call this before `reduce`); falls back to a title-less noun when the task
 * is missing (e.g. the id was never added, or a property test's random id).
 * The switch below is over `UndoableAction`, so the compiler enforces that
 * every member of `UNDOABLE_TYPES` has a case here — adding a type to the
 * set without adding a case is a type error, not a silent fallthrough. */
export function labelFor(action: Action, data: Data): string {
  if (!isUndoable(action)) return 'Made a change';
  switch (action.type) {
    case 'task/add':
      return `Added "${truncate(action.title)}"`;
    case 'task/edit': {
      const title = titleFor(data, action.id);
      return title !== undefined ? `Edited "${truncate(title)}"` : 'Edited task';
    }
    case 'task/complete': {
      const title = titleFor(data, action.id);
      return title !== undefined ? `Completed "${truncate(title)}"` : 'Completed task';
    }
    case 'task/uncomplete': {
      const title = titleFor(data, action.id);
      return title !== undefined ? `Reopened "${truncate(title)}"` : 'Reopened task';
    }
    case 'task/delete': {
      const title = titleFor(data, action.id);
      return title !== undefined ? `Deleted "${truncate(title)}"` : 'Deleted task';
    }
    case 'task/move': {
      const title = titleFor(data, action.id);
      return title !== undefined ? `Moved "${truncate(title)}"` : 'Moved task';
    }
    case 'task/makeCurrent': {
      const title = titleFor(data, action.id);
      return title !== undefined ? `Made "${truncate(title)}" current` : 'Made task current';
    }
    case 'task/skip': {
      const title = titleFor(data, action.id);
      return title !== undefined ? `Skipped "${truncate(title)}"` : 'Skipped task';
    }
    case 'task/snooze': {
      const title = titleFor(data, action.id);
      return title !== undefined ? `Snoozed "${truncate(title)}"` : 'Snoozed task';
    }
    case 'task/setToday':
      return 'Updated today list';
    case 'timer/stop': {
      const title = titleFor(data, action.id);
      return title !== undefined ? `Stopped timer on "${truncate(title)}"` : 'Stopped timer';
    }
    case 'timer/addTime': {
      const title = titleFor(data, action.id);
      return title !== undefined ? `Added time to "${truncate(title)}"` : 'Added time';
    }
    case 'list/add':
      return `Added list "${truncate(action.name)}"`;
    case 'list/rename':
      return 'Renamed list';
    case 'list/delete':
      return 'Deleted list';
    case 'day/close':
      return 'Closed the day';
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}
