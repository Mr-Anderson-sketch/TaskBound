// renderer/planner/TaskList — resolves a planner `ViewId` into rendered sections
// (Task 4.1 addendum rulings 1 and 4) and renders them, virtualising any section over
// 60 rows (always, for the Logbook) with `@tanstack/react-virtual`.
import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Data, Task } from '../../core/types';
import { INBOX_ID } from '../../core/defaults';
import { todayTasks, upcomingGroups, tasksInList, tasksWithTag, logbook, dayStats } from '../../core/select';
import { ymd, addDays, dayKeyForRollover } from '../../core/dates';
import { longDayLabel } from '../lib/dateLabels';
import { TaskRow, shortDateLabel } from './TaskRow';

export type ViewId = 'today' | 'upcoming' | 'inbox' | 'logbook' | `list:${string}` | `tag:${string}`;

export interface TaskListSection {
  key: string;
  label?: string;
  ariaLabel: string;
  tasks: Task[];
  /** The single task (if any) to render with the "current" row styling. */
  currentId?: string;
  forceVirtual?: boolean;
}

export interface ResolvedView {
  title: string;
  meta: string;
  sections: TaskListSection[];
  isEmpty: boolean;
}

const ROW_HEIGHT = 34;
const VIRTUALIZE_THRESHOLD = 60;
const OVERSCAN = 10;

function formatFocus(seconds: number): string {
  const totalMinutes = Math.floor(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Turns a `ViewId` into the sections TaskList renders, plus the main pane's title and
 * date/counts line (DESIGN.md "Planner": view title in Instrument Serif with the date
 * and counts beside it). Pure — no dispatch, no DOM. */
export function resolveView(view: ViewId, data: Data, now: number): ResolvedView {
  if (view === 'today') {
    const { current, upNext, done } = todayTasks(data, now);
    const sections: TaskListSection[] = [];
    if (current) sections.push({ key: 'current', label: 'Current', ariaLabel: 'Current', tasks: [current], currentId: current.id });
    if (upNext.length > 0) sections.push({ key: 'upnext', label: 'Up next', ariaLabel: 'Up next', tasks: upNext });
    if (done.length > 0) sections.push({ key: 'done', label: 'Done', ariaLabel: 'Done', tasks: done });
    const stats = dayStats(data, dayKeyForRollover(now), now);
    const meta = `${longDayLabel(now)} · ${stats.done} of ${stats.planned} done · ${formatFocus(stats.focusSeconds)} focused`;
    return { title: 'Today', meta, sections, isEmpty: !current && upNext.length === 0 && done.length === 0 };
  }

  if (view === 'upcoming') {
    const groups = upcomingGroups(data, now, 14);
    const tomorrow = addDays(ymd(now), 1);
    const sections: TaskListSection[] = groups.map((g) => {
      const label = g.date === tomorrow ? 'Tomorrow' : shortDateLabel(g.date);
      return { key: g.date, label, ariaLabel: label, tasks: g.tasks };
    });
    const total = groups.reduce((n, g) => n + g.tasks.length, 0);
    return { title: 'Upcoming', meta: `${total} open`, sections, isEmpty: total === 0 };
  }

  if (view === 'inbox') {
    const tasks = tasksInList(data, INBOX_ID);
    return { title: 'Inbox', meta: `${tasks.length} open`, sections: [{ key: 'inbox', ariaLabel: 'Inbox', tasks }], isEmpty: tasks.length === 0 };
  }

  if (view === 'logbook') {
    const tasks = logbook(data);
    return {
      title: 'Logbook',
      meta: `${tasks.length} completed`,
      sections: [{ key: 'logbook', ariaLabel: 'Logbook', tasks, forceVirtual: true }],
      isEmpty: tasks.length === 0
    };
  }

  if (view.startsWith('list:')) {
    const listId = view.slice('list:'.length);
    const list = data.lists.find((l) => l.id === listId);
    const title = list?.name ?? 'List';
    const tasks = tasksInList(data, listId);
    return { title, meta: `${tasks.length} open`, sections: [{ key: listId, ariaLabel: title, tasks }], isEmpty: tasks.length === 0 };
  }

  const tag = view.slice('tag:'.length);
  const title = `#${tag}`;
  const tasks = tasksWithTag(data, tag);
  return { title, meta: `${tasks.length} open`, sections: [{ key: `tag:${tag}`, ariaLabel: title, tasks }], isEmpty: tasks.length === 0 };
}

interface SectionProps {
  section: TaskListSection;
  now: number;
  selectedId?: string;
  onSelect: (task: Task) => void;
  onToggle: (task: Task) => void;
  fill: boolean;
}

function Section({ section, now, selectedId, onSelect, onToggle, fill }: SectionProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtual = section.forceVirtual === true || section.tasks.length > VIRTUALIZE_THRESHOLD;

  const virtualizer = useVirtualizer({
    count: section.tasks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    enabled: virtual
  });

  // aria-setsize/aria-posinset (fix round 1, item 3): every option row reports its
  // 1-based position and the section's total count, for virtualised and plain
  // rendering alike — a screen reader can't otherwise tell a virtualised listbox's true
  // extent from the handful of rows actually in the DOM at once.
  const setsize = section.tasks.length;
  const row = (task: Task, index: number) => (
    <TaskRow
      key={task.id}
      task={task}
      now={now}
      current={section.currentId === task.id}
      selected={selectedId === task.id}
      posinset={index + 1}
      setsize={setsize}
      onSelect={onSelect}
      onToggle={onToggle}
    />
  );

  // No wrapping element around the label + listbox pair: both are direct children of
  // TaskList's flex column, so `flex: 1` below sizes against the REAL flex container
  // (a wrapping block-level div here would swallow it — flex sizing only applies to a
  // flex container's own children, not further down the tree).
  return (
    <>
      {section.label && <div className="sec">{section.label}</div>}
      {virtual ? (
        <div
          ref={parentRef}
          role="listbox"
          aria-label={section.ariaLabel}
          style={fill ? { flex: 1, minHeight: 0, overflowY: 'auto' } : { maxHeight: 320, overflowY: 'auto' }}
        >
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((vi) => (
              <div
                key={vi.key}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, height: vi.size, transform: `translateY(${vi.start}px)` }}
              >
                {row(section.tasks[vi.index], vi.index)}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div role="listbox" aria-label={section.ariaLabel}>
          {section.tasks.map((task, i) => row(task, i))}
        </div>
      )}
    </>
  );
}

export interface TaskListProps {
  sections: TaskListSection[];
  now: number;
  selectedId?: string;
  onSelect: (task: Task) => void;
  onToggle: (task: Task) => void;
}

/** Renders every section; when there is exactly one (Inbox/list/tag/Logbook), it fills
 * the remaining height with its own scroll region (`fill`) — this is the common case a
 * virtualised Logbook needs to actually get the vertical space to scroll in. With
 * several sections (Today, Upcoming) the whole list scrolls together instead. */
export function TaskList({ sections, now, selectedId, onSelect, onToggle }: TaskListProps) {
  const fill = sections.length === 1;
  return (
    <div className="tl-scroll" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: fill ? 'hidden' : 'auto' }}>
      {sections.map((s) => (
        <Section key={s.key} section={s} now={now} selectedId={selectedId} onSelect={onSelect} onToggle={onToggle} fill={fill} />
      ))}
    </div>
  );
}
