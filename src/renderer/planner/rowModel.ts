// renderer/planner/rowModel — pure helpers for the flattened row model TaskList uses to
// render a section's open sub-tasks indented directly under their parent (Task 4.3
// addendum ruling 2). No DOM, no dispatch: TaskList.tsx supplies `data` (already has it
// from `resolveView`) and renders whatever this returns.
import type { Data, Task } from '../../core/types';
import { childrenOf } from '../../core/select';

export interface FlatRow {
  task: Task;
  /** 0 for a top-level row, 1 for an indented sub-task row. */
  depth: 0 | 1;
}

/**
 * Expands `tasks` (a section's own already-ordered top-level tasks) into a flat row
 * list that inserts each task's OPEN children immediately after it, indented — done
 * children aren't rendered as their own row (ruling 2: "not counted as top-level
 * rows"), but still count toward `childProgress`. Callers that never show children
 * (Upcoming, Logbook) simply don't call this — `tasks.map(t => ({ task: t, depth: 0 }))`
 * is the degenerate case.
 */
export function flattenWithChildren(tasks: Task[], data: Data): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const task of tasks) {
    rows.push({ task, depth: 0 });
    for (const child of childrenOf(data, task.id)) {
      if (child.status === 'open') rows.push({ task: child, depth: 1 });
    }
  }
  return rows;
}

/**
 * `"<done>/<total>"` for `taskId`'s children (open + done), or `undefined` when it has
 * none — the small progress text shown after a parent's title once it has children
 * (ruling 2).
 */
export function childProgress(data: Data, taskId: string): string | undefined {
  const children = childrenOf(data, taskId);
  if (children.length === 0) return undefined;
  const done = children.filter((c) => c.status === 'done').length;
  return `${done}/${children.length}`;
}
