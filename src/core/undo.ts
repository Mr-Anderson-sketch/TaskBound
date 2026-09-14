// core/undo — an undo/redo ring of whole `Data` snapshots (immer structural
// sharing makes this cheap). The store calls `push(prev, label)` BEFORE
// applying an undoable action, then applies it. Pure: no Electron, no Node.
import type { Action, Data } from './types';

interface Entry {
  data: Data;
  label: string;
}

export class UndoStack {
  private undoEntries: Entry[] = [];
  private redoEntries: Entry[] = [];

  constructor(private limit = 50) {}

  /** Called before applying an undoable action; clears the redo stack. */
  push(prev: Data, label: string): void {
    this.clearRedo();
    this.undoEntries.push({ data: prev, label });
    if (this.undoEntries.length > this.limit) {
      this.undoEntries.shift();
    }
  }

  /** Pops the newest undo entry, pushes `current` onto redo, and returns the popped entry. */
  undo(current: Data): { data: Data; label: string } | undefined {
    const entry = this.undoEntries.pop();
    if (!entry) return undefined;
    this.redoEntries.push({ data: current, label: entry.label });
    return { data: entry.data, label: entry.label };
  }

  /** Mirrors `undo`: pops the newest redo entry, pushes `current` onto undo. */
  redo(current: Data): { data: Data; label: string } | undefined {
    const entry = this.redoEntries.pop();
    if (!entry) return undefined;
    this.undoEntries.push({ data: current, label: entry.label });
    return { data: entry.data, label: entry.label };
  }

  clearRedo(): void {
    this.redoEntries = [];
  }

  get canUndo(): boolean {
    return this.undoEntries.length > 0;
  }

  get canRedo(): boolean {
    return this.redoEntries.length > 0;
  }
}

export const UNDOABLE = new Set<Action['type']>([
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
]);

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
 * is missing (e.g. the id was never added, or a property test's random id). */
export function labelFor(action: Action, data: Data): string {
  switch (action.type) {
    case 'task/add':
      return `Added "${truncate(action.title)}"`;
    case 'task/edit': {
      const title = titleFor(data, action.id);
      return title ? `Edited "${truncate(title)}"` : 'Edited task';
    }
    case 'task/complete': {
      const title = titleFor(data, action.id);
      return title ? `Completed "${truncate(title)}"` : 'Completed task';
    }
    case 'task/uncomplete': {
      const title = titleFor(data, action.id);
      return title ? `Reopened "${truncate(title)}"` : 'Reopened task';
    }
    case 'task/delete': {
      const title = titleFor(data, action.id);
      return title ? `Deleted "${truncate(title)}"` : 'Deleted task';
    }
    case 'task/move': {
      const title = titleFor(data, action.id);
      return title ? `Moved "${truncate(title)}"` : 'Moved task';
    }
    case 'task/makeCurrent': {
      const title = titleFor(data, action.id);
      return title ? `Made "${truncate(title)}" current` : 'Made task current';
    }
    case 'task/skip': {
      const title = titleFor(data, action.id);
      return title ? `Skipped "${truncate(title)}"` : 'Skipped task';
    }
    case 'task/snooze': {
      const title = titleFor(data, action.id);
      return title ? `Snoozed "${truncate(title)}"` : 'Snoozed task';
    }
    case 'task/setToday':
      return 'Updated today list';
    case 'timer/stop': {
      const title = titleFor(data, action.id);
      return title ? `Stopped timer on "${truncate(title)}"` : 'Stopped timer';
    }
    case 'timer/addTime': {
      const title = titleFor(data, action.id);
      return title ? `Added time to "${truncate(title)}"` : 'Added time';
    }
    case 'list/add':
      return `Added list "${truncate(action.name)}"`;
    case 'list/rename':
      return 'Renamed list';
    case 'list/delete':
      return 'Deleted list';
    case 'day/close':
      return 'Closed the day';
    default:
      return 'Made a change';
  }
}
