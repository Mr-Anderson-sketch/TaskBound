// renderer/planner/TaskList — resolves a planner `ViewId` into rendered sections
// (Task 4.1 addendum rulings 1 and 4) and renders them, virtualising any section over
// 60 rows (always, for the Logbook) with `@tanstack/react-virtual`.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Data, Task } from '../../core/types';
import { INBOX_ID } from '../../core/defaults';
import { todayTasks, upcomingGroups, tasksInList, tasksWithTag, logbook, dayStats } from '../../core/select';
import { ymd, addDays, dayKeyForRollover } from '../../core/dates';
import { longDayLabel } from '../lib/dateLabels';
import { TaskRow, shortDateLabel, rowDomId } from './TaskRow';

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

/** The flat, ordered list of every visible task id across `sections` (section headers
 * skipped) — the order `j`/`k` navigation and `nextSelection` walk (Task 4.2 addendum
 * ruling 2). Exported so `usePlannerKeys` can compute it from the same `ResolvedView`
 * it already has, without re-deriving TaskList's internals. */
export function flatRowIds(sections: TaskListSection[]): string[] {
  return sections.flatMap((s) => s.tasks.map((t) => t.id));
}

/**
 * `rowDomId(selectedId)` when `selectedId` names a row currently MOUNTED in the DOM
 * (`mountedIds`), else `undefined` (Task 4.2 fix round 1, finding 2). A virtualised
 * section only ever mounts the rows within its scroll range plus overscan — the
 * selected row can be scrolled well out of that window (a fast `j`/`k` run, or a
 * `scrollToId` whose target hasn't actually rendered yet) — so `aria-activedescendant`
 * must never name an id with no matching element, which some assistive tech treats as
 * a broken reference. Pure; the DOM-scanning that produces `mountedIds` lives in
 * `TaskList`'s own effect below (unit-tested via this helper, not the DOM scan itself —
 * see `tests/renderer/planner.test.ts`).
 */
export function activeDescendantFor(selectedId: string | undefined, mountedIds: ReadonlySet<string>): string | undefined {
  return selectedId !== undefined && mountedIds.has(selectedId) ? rowDomId(selectedId) : undefined;
}

export interface SectionHandle {
  /** Scrolls the row for `id` into view if it belongs to this section (using the
   * virtualizer's own `scrollToIndex` when virtualised); returns whether it did. */
  scrollToId: (id: string) => boolean;
}

interface SectionProps {
  section: TaskListSection;
  now: number;
  selectedId?: string;
  onSelect: (task: Task) => void;
  onToggle: (task: Task) => void;
  editingId?: string;
  onEditSave?: (task: Task, title: string) => void;
  onEditCancel?: () => void;
  fill: boolean;
}

const Section = forwardRef<SectionHandle, SectionProps>(function Section(
  { section, now, selectedId, onSelect, onToggle, editingId, onEditSave, onEditCancel, fill },
  ref
) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtual = section.forceVirtual === true || section.tasks.length > VIRTUALIZE_THRESHOLD;

  const virtualizer = useVirtualizer({
    count: section.tasks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    enabled: virtual
  });

  useImperativeHandle(
    ref,
    () => ({
      scrollToId(id: string) {
        const index = section.tasks.findIndex((t) => t.id === id);
        if (index === -1) return false;
        if (virtual) {
          virtualizer.scrollToIndex(index, { align: 'auto' });
        } else {
          document.getElementById(rowDomId(id))?.scrollIntoView({ block: 'nearest' });
        }
        return true;
      }
    }),
    [section.tasks, virtual, virtualizer]
  );

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
      editing={editingId === task.id}
      onEditSave={onEditSave}
      onEditCancel={onEditCancel}
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
});

export interface TaskListHandle {
  /** Scrolls the given task's row into view — a plain `scrollIntoView` for a
   * non-virtualised section, the owning section's virtualizer `scrollToIndex`
   * otherwise (Task 4.2 addendum ruling 2). No-ops silently if `id` isn't visible. */
  scrollToId: (id: string) => void;
  /** The container's own DOM node — always current, even though the handle object
   * itself is only rebuilt when `sections` changes (a getter, not a snapshotted
   * value). `usePlannerKeys` uses it to return focus to the list (ruling 6: "every menu
   * and the command palette return focus to the list on close"). */
  readonly el: HTMLDivElement | null;
}

export interface TaskListProps {
  sections: TaskListSection[];
  now: number;
  selectedId?: string;
  onSelect: (task: Task) => void;
  onToggle: (task: Task) => void;
  editingId?: string;
  onEditSave?: (task: Task, title: string) => void;
  onEditCancel?: () => void;
  /** Task 4.2 addendum ruling 6: the container is focusable and owns the keyboard
   * model — `usePlannerKeys` supplies the keydown handler and which row id is
   * "active" for `aria-activedescendant`. */
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  activeDescendantId?: string;
}

/** Renders every section; when there is exactly one (Inbox/list/tag/Logbook), it fills
 * the remaining height with its own scroll region (`fill`) — this is the common case a
 * virtualised Logbook needs to actually get the vertical space to scroll in. With
 * several sections (Today, Upcoming) the whole list scrolls together instead. */
export const TaskList = forwardRef<TaskListHandle, TaskListProps>(function TaskList(
  { sections, now, selectedId, onSelect, onToggle, editingId, onEditSave, onEditCancel, onKeyDown, activeDescendantId },
  ref
) {
  const fill = sections.length === 1;
  const sectionRefs = useRef(new Map<string, SectionHandle | null>());
  const rootElRef = useRef<HTMLDivElement | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      scrollToId(id: string) {
        for (const handle of sectionRefs.current.values()) {
          if (handle?.scrollToId(id)) return;
        }
      },
      get el() {
        return rootElRef.current;
      }
    }),
    []
  );

  // Fix round 1, finding 2: `mountedIds` mirrors the DOM directly (every row carries
  // `data-row-id`, from TaskRow.tsx), not the virtualizer's own range math — the source
  // of truth for "does an element with this id exist" is the DOM itself. Re-scanned on
  // an animation frame after every render (not synchronously in the effect, which can
  // run before the virtualizer's own async layout — including right after
  // `scrollToId` — has actually mounted the target row) and whenever the virtualizer's
  // rendered range changes (each such change re-renders `Section`, which re-renders
  // this component's children, which re-runs this effect — it has no dependency array
  // on purpose, matching the binding's "and when the virtualizer's rendered range
  // changes"). Skips the state update when the set is unchanged so this doesn't loop.
  const [mountedIds, setMountedIds] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const root = rootElRef.current;
      if (!root) return;
      const found = new Set(Array.from(root.querySelectorAll<HTMLElement>('[data-row-id]')).map((el) => el.dataset.rowId!));
      setMountedIds((prev) => (found.size === prev.size && [...found].every((id) => prev.has(id)) ? prev : found));
    });
    return () => cancelAnimationFrame(raf);
  });

  return (
    <div
      ref={rootElRef}
      className="tl-scroll"
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-activedescendant={activeDescendantFor(activeDescendantId, mountedIds)}
      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: fill ? 'hidden' : 'auto' }}
    >
      {sections.map((s) => (
        <Section
          key={s.key}
          ref={(el) => {
            sectionRefs.current.set(s.key, el);
          }}
          section={s}
          now={now}
          selectedId={selectedId}
          onSelect={onSelect}
          onToggle={onToggle}
          editingId={editingId}
          onEditSave={onEditSave}
          onEditCancel={onEditCancel}
          fill={fill}
        />
      ))}
    </div>
  );
});
