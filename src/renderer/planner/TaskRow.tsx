// renderer/planner/TaskRow — one 34 px task row (DESIGN.md "Planner": "Rows 34 px with
// a 16 px radio; current task 500 weight with accent radio; done rows struck in muted").
// Task 4.1 addendum ruling 3. Rows are `role="option"` inside a section's
// `role="listbox"` (see TaskList.tsx); a row click selects (selection lives in
// PlannerApp), the radio toggles complete/uncomplete independently (stopPropagation so
// it doesn't also select).
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
}

export function TaskRow({ task, now, current, selected, posinset, setsize, onSelect, onToggle }: TaskRowProps) {
  const done = task.status === 'done';
  // Only ticks (setInterval) while THIS task's timer is actually running (see
  // useDisplayTime) — safe to call per-row even in a 500-row virtualised Logbook.
  const display = useDisplayTime(task.timer);
  const timerLabel = display.mode !== 'none' ? fmtClock(display.seconds) : undefined;
  const due = task.due !== undefined ? dueInfo(task.due, now) : undefined;

  return (
    <div
      role="option"
      aria-selected={Boolean(selected)}
      aria-posinset={posinset}
      aria-setsize={setsize}
      className={['task', current && 'cur', done && 'done', selected && 'sel'].filter(Boolean).join(' ')}
      onClick={() => onSelect(task)}
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
      <span className="t">{task.title}</span>
      {!done && (
        <>
          {task.tags.slice(0, 2).map((tag) => (
            <span className="tag" key={tag}>
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
    </div>
  );
}
