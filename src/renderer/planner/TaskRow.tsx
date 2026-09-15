// renderer/planner/TaskRow — one 34 px task row (DESIGN.md "Planner": "Rows 34 px with
// a 16 px radio; current task 500 weight with accent radio; done rows struck in muted").
// Task 4.1 addendum ruling 3. Rows are `role="option"` inside a section's
// `role="listbox"` (see TaskList.tsx); a row click selects (selection lives in
// PlannerApp), the radio toggles complete/uncomplete independently (stopPropagation so
// it doesn't also select).
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useDisplayTime } from '../lib/useDisplayTime';
import { fmtClock } from '../../core/timer';
import { describeRule } from '../../core/recur';
import { ymd, parseYmd } from '../../core/dates';
import type { Task, Due, Ymd } from '../../core/types';

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Wed 16 Sep" — the same weekday-short/day/month-short order as core/parse.ts's
 * (unexported) dateLabel, kept in lockstep by convention. Exported for reuse by
 * TaskList.tsx's Upcoming group headers. */
export function shortDateLabel(date: Ymd): string {
  const d = parseYmd(date);
  return `${DOW_SHORT[d.getDay()]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
}

export interface DueInfo {
  text: string;
  overdue: boolean;
}

/** Addendum ruling 3: `due 9:00` for a same-day due with a time, `Wed 16 Sep` otherwise
 * (date only, or a time on a different day — the date carries more information than the
 * time there). `overdue` is a separate flag (due.date < today) applied as styling, not a
 * text change. Exported for unit testing (Task 4.1 fix round 1, item 4). */
export function dueInfo(due: Due, now: number): DueInfo {
  const today = ymd(now);
  const overdue = due.date < today;
  if (due.date === today && due.time !== undefined) return { text: `due ${due.time}`, overdue };
  return { text: shortDateLabel(due.date), overdue };
}

/** The DOM id a row's root element carries — used by `aria-activedescendant` and by
 * `usePlannerKeys`' non-virtualised scroll-into-view fallback (Task 4.2 addendum
 * rulings 2, 6). */
export function rowDomId(taskId: string): string {
  return `task-row-${taskId}`;
}

export interface TaskRowProps {
  task: Task;
  now: number;
  /** Renders with the "current task" styling (accent radio, 500-weight title). */
  current?: boolean;
  selected?: boolean;
  /** 1-based position within the enclosing section's listbox (fix round 1, item 3). */
  posinset: number;
  /** The enclosing section's total task count. */
  setsize: number;
  onSelect: (task: Task) => void;
  onToggle: (task: Task) => void;
  /** Task 4.2 addendum ruling 2: `e` swaps the title for an inline input. `true` when
   * THIS row is the one currently being edited. */
  editing?: boolean;
  /** Called on Enter or blur with the (untrimmed) new title — the caller trims/no-ops an
   * empty result via `task/edit`'s own rules. Not called when the value is unchanged. */
  onEditSave?: (task: Task, title: string) => void;
  onEditCancel?: () => void;
  /** Task 4.3 addendum ruling 3: opens the detail pane for this task — wired to a
   * double-click on the row and its own "Open details" chevron button. */
  onOpenDetail?: (task: Task) => void;
  /** Task 4.3 addendum ruling 6: clicking a tag chip navigates to that tag's view. */
  onTagClick?: (tag: string) => void;
  /** 1 for an indented sub-task row, 0 (default) for a top-level row (Task 4.3 addendum
   * ruling 2). */
  depth?: 0 | 1;
  /** "<done>/<total>" shown after the title once this task has children (ruling 2). */
  progress?: string;
}

export function TaskRow({
  task,
  now,
  current,
  selected,
  posinset,
  setsize,
  onSelect,
  onToggle,
  editing,
  onEditSave,
  onEditCancel,
  onOpenDetail,
  onTagClick,
  depth,
  progress
}: TaskRowProps) {
  const done = task.status === 'done';
  // Only ticks (setInterval) while THIS task's timer is actually running (see
  // useDisplayTime) — safe to call per-row even in a 500-row virtualised Logbook.
  const display = useDisplayTime(task.timer);
  const timerLabel = display.mode !== 'none' ? fmtClock(display.seconds) : undefined;
  const due = task.due !== undefined ? dueInfo(task.due, now) : undefined;

  const [editValue, setEditValue] = useState(task.title);
  const editInputRef = useRef<HTMLInputElement>(null);
  const savedRef = useRef(false);

  useEffect(() => {
    if (!editing) return;
    setEditValue(task.title);
    savedRef.current = false;
    // Focus + select-all so typing immediately replaces the title (a common inline-rename
    // expectation), on the next tick so the input has mounted.
    const id = requestAnimationFrame(() => {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [editing, task.title]);

  const commitEdit = (): void => {
    if (savedRef.current) return;
    savedRef.current = true;
    onEditSave?.(task, editValue);
  };

  const onEditKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      savedRef.current = true; // blur fires after this; don't also save
      onEditCancel?.();
    }
  };

  return (
    <div
      id={rowDomId(task.id)}
      data-row-id={task.id}
      role="option"
      aria-selected={Boolean(selected)}
      aria-posinset={posinset}
      aria-setsize={setsize}
      className={['task', current && 'cur', done && 'done', selected && 'sel', depth === 1 && 'sub'].filter(Boolean).join(' ')}
      onClick={() => onSelect(task)}
      onDoubleClick={() => onOpenDetail?.(task)}
    >
      <button
        type="button"
        className="cb"
        aria-label={done ? `Mark "${task.title}" not done` : `Complete "${task.title}"`}
        onClick={(e) => {
          e.stopPropagation();
          onToggle(task);
        }}
      />
      {editing ? (
        <input
          ref={editInputRef}
          type="text"
          className="edit-title"
          value={editValue}
          aria-label="Task title"
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={onEditKeyDown}
          onBlur={commitEdit}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="t">{task.title}</span>
      )}
      {progress && !editing && <span className="progress">{progress}</span>}
      {!done && !editing && (
        <>
          {task.tags.slice(0, 2).map((tag) => (
            <span
              className="tag"
              key={tag}
              onClick={
                onTagClick &&
                ((e) => {
                  e.stopPropagation();
                  onTagClick(tag);
                })
              }
            >
              #{tag}
            </span>
          ))}
          {due && <span className={due.overdue ? 'due over' : 'due'}>{due.text}</span>}
          {timerLabel && <span className="tm">{timerLabel}</span>}
          {task.recurrence && (
            <span className="rpt" title={describeRule(task.recurrence)}>
              ↻
            </span>
          )}
        </>
      )}
      {onOpenDetail && !editing && (
        <button
          type="button"
          className="chev"
          aria-label="Open details"
          onClick={(e) => {
            e.stopPropagation();
            onOpenDetail(task);
          }}
        >
          ›
        </button>
      )}
    </div>
  );
}
