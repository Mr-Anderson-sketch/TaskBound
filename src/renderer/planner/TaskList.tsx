// renderer/planner/TaskList — resolves a planner `ViewId` into rendered sections
// (Task 4.1 addendum rulings 1 and 4) and renders them, virtualising any section over
// 60 rows (always, for the Logbook) with `@tanstack/react-virtual`.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import type { Data, Task } from '../../core/types';
import { INBOX_ID } from '../../core/defaults';
import { todayTasks, upcomingGroups, tasksInList, tasksWithTag, logbook, dayStats, childrenOf } from '../../core/select';
import { ymd, addDays, dayKeyForRollover } from '../../core/dates';
import { longDayLabel } from '../lib/dateLabels';
import { flattenWithChildren, childProgress } from './rowModel';
import type { FlatRow } from './rowModel';
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
  /** Task 4.3 addendum ruling 2: Today, Inbox, list, and tag sections show a task's
   * open sub-tasks indented directly under it; Upcoming and Logbook never do. */
  showChildren?: boolean;
  /** Task 4.3 addendum ruling 4: drag reorder is scoped to Today's "Up next", Inbox,
   * list, and tag sections — never Upcoming, Logbook, or Today's "Current"/"Done"
   * (a 1-task section, and a section not ordered by `order` at all, respectively). */
  draggable?: boolean;
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
    if (current) sections.push({ key: 'current', label: 'Current', ariaLabel: 'Current', tasks: [current], currentId: current.id, showChildren: true });
    if (upNext.length > 0) sections.push({ key: 'upnext', label: 'Up next', ariaLabel: 'Up next', tasks: upNext, showChildren: true, draggable: true });
    if (done.length > 0) sections.push({ key: 'done', label: 'Done', ariaLabel: 'Done', tasks: done, showChildren: true });
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
    return {
      title: 'Inbox',
      meta: `${tasks.length} open`,
      sections: [{ key: 'inbox', ariaLabel: 'Inbox', tasks, showChildren: true, draggable: true }],
      isEmpty: tasks.length === 0
    };
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
    return {
      title,
      meta: `${tasks.length} open`,
      sections: [{ key: listId, ariaLabel: title, tasks, showChildren: true, draggable: true }],
      isEmpty: tasks.length === 0
    };
  }

  const tag = view.slice('tag:'.length);
  const title = `#${tag}`;
  const tasks = tasksWithTag(data, tag);
  return {
    title,
    meta: `${tasks.length} open`,
    sections: [{ key: `tag:${tag}`, ariaLabel: title, tasks, showChildren: true, draggable: true }],
    isEmpty: tasks.length === 0
  };
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

interface RenderRow {
  task: Task;
  depth: 0 | 1;
  posinset: number;
  setsize: number;
  progress?: string;
}

/** Expands `section.tasks` into the rows TaskRow actually renders (Task 4.3 addendum
 * ruling 2): each open sub-task gets its own indented row right after its parent
 * (`section.showChildren` sections only — Upcoming/Logbook never call this with
 * children present). `posinset`/`setsize` keep the ORIGINAL top-level numbering scheme
 * for top-level rows (child rows "don't count as top-level rows") and get their own,
 * scoped to the parent's own open children, for indented rows. `progress` ("<done>/
 * <total>") is computed for every top-level row that has any children, regardless of
 * whether this section shows them as their own rows. */
function decorateRows(section: TaskListSection, data: Data): RenderRow[] {
  const flat: FlatRow[] = section.showChildren ? flattenWithChildren(section.tasks, data) : section.tasks.map((t) => ({ task: t, depth: 0 as const }));
  const out: RenderRow[] = [];
  let topIndex = 0;
  let childIndex = 0;
  let currentParentId: string | undefined;
  for (const r of flat) {
    if (r.depth === 0) {
      topIndex += 1;
      childIndex = 0;
      currentParentId = r.task.id;
      out.push({ task: r.task, depth: 0, posinset: topIndex, setsize: section.tasks.length, progress: childProgress(data, r.task.id) });
    } else {
      childIndex += 1;
      const setsize = currentParentId !== undefined ? childrenOf(data, currentParentId).filter((c) => c.status === 'open').length : 1;
      out.push({ task: r.task, depth: 1, posinset: childIndex, setsize });
    }
  }
  return out;
}

interface RowRenderProps {
  now: number;
  current: boolean;
  selected: boolean;
  editing: boolean;
  onSelect: (task: Task) => void;
  onToggle: (task: Task) => void;
  onEditSave?: (task: Task, title: string) => void;
  onEditCancel?: () => void;
  onOpenDetail?: (task: Task) => void;
  onTagClick?: (tag: string) => void;
}

/** A top-level row inside a DRAGGABLE, non-virtualised section's `SortableContext`
 * (Task 4.3 addendum ruling 4): `useSortable` supplies the drag handle behaviour
 * (`attributes`/`listeners`), the live drag transform, and `isDragging` for the "lifts
 * with --surface and a 1 px --line outline" styling. Only ever mounted inside that
 * `SortableContext` — see `Section` below — so the hook always has a provider. */
function DraggableRow({ r, ...rest }: { r: RenderRow } & RowRenderProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: r.task.id });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition: transition ?? undefined };
  return (
    <div ref={setNodeRef} style={style} className={isDragging ? 'drag-lift' : undefined} {...attributes} {...listeners}>
      <TaskRow task={r.task} posinset={r.posinset} setsize={r.setsize} depth={r.depth} progress={r.progress} {...rest} />
    </div>
  );
}

interface SectionProps {
  section: TaskListSection;
  data: Data;
  now: number;
  selectedId?: string;
  onSelect: (task: Task) => void;
  onToggle: (task: Task) => void;
  editingId?: string;
  onEditSave?: (task: Task, title: string) => void;
  onEditCancel?: () => void;
  onOpenDetail?: (task: Task) => void;
  onTagClick?: (tag: string) => void;
  /** `task/move { afterId }` for a drop within this section (Task 4.3 addendum ruling
   * 4) — `afterId: null` for "dropped at the top". */
  onReorder?: (taskId: string, afterId: string | null) => void;
  fill: boolean;
}

const Section = forwardRef<SectionHandle, SectionProps>(function Section(
  { section, data, now, selectedId, onSelect, onToggle, editingId, onEditSave, onEditCancel, onOpenDetail, onTagClick, onReorder, fill },
  ref
) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rows = decorateRows(section, data);
  // Virtualisation uses the flattened row model INCLUDING children (ruling 2) — a
  // section with few top-level tasks but many open sub-tasks can still cross the
  // threshold. Drag, conversely, is disabled once virtualised (ruling 4).
  const virtual = section.forceVirtual === true || rows.length > VIRTUALIZE_THRESHOLD;
  const dragEnabled = section.draggable === true && !virtual;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    enabled: virtual
  });

  useImperativeHandle(
    ref,
    () => ({
      scrollToId(id: string) {
        const index = rows.findIndex((r) => r.task.id === id);
        if (index === -1) return false;
        if (virtual) {
          virtualizer.scrollToIndex(index, { align: 'auto' });
        } else {
          document.getElementById(rowDomId(id))?.scrollIntoView({ block: 'nearest' });
        }
        return true;
      }
    }),
    [rows, virtual, virtualizer]
  );

  const rowProps = (r: RenderRow): RowRenderProps => ({
    now,
    current: section.currentId === r.task.id,
    selected: selectedId === r.task.id,
    editing: editingId === r.task.id,
    onSelect,
    onToggle,
    onEditSave,
    onEditCancel,
    onOpenDetail,
    onTagClick
  });

  const renderRow = (r: RenderRow) =>
    dragEnabled && r.depth === 0 ? (
      <DraggableRow key={r.task.id} r={r} {...rowProps(r)} />
    ) : (
      <TaskRow key={r.task.id} task={r.task} posinset={r.posinset} setsize={r.setsize} depth={r.depth} progress={r.progress} {...rowProps(r)} />
    );

  // task/move's afterId reorders within the task's CURRENT sibling group — dnd-kit's
  // SortableContext is scoped to just this section's TOP-LEVEL ids (children move with
  // their parent automatically: they're looked up by parentId, not array position, so a
  // parent's new order never detaches them). Dropping outside this SortableContext (a
  // different section) leaves `over` unmatched below and dnd-kit snaps the row back on
  // its own — "dropping onto another section is not supported".
  const topLevelIds = section.tasks.map((t) => t.id);
  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (!over || active.id === over.id || !onReorder) return;
    const oldIndex = topLevelIds.indexOf(String(active.id));
    const newIndex = topLevelIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(topLevelIds, oldIndex, newIndex);
    const pos = reordered.indexOf(String(active.id));
    onReorder(String(active.id), pos === 0 ? null : reordered[pos - 1]);
  };

  const listbox = (
    <div role="listbox" aria-label={section.ariaLabel}>
      {rows.map((r) => renderRow(r))}
    </div>
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
                {renderRow(rows[vi.index])}
              </div>
            ))}
          </div>
        </div>
      ) : dragEnabled ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={handleDragEnd}>
          <SortableContext items={topLevelIds} strategy={verticalListSortingStrategy}>
            {listbox}
          </SortableContext>
        </DndContext>
      ) : (
        listbox
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
  data: Data;
  now: number;
  selectedId?: string;
  onSelect: (task: Task) => void;
  onToggle: (task: Task) => void;
  editingId?: string;
  onEditSave?: (task: Task, title: string) => void;
  onEditCancel?: () => void;
  /** Task 4.3 addendum ruling 3: opens the detail pane (Enter is wired by
   * usePlannerKeys directly against `selectedId`; this handles a row's own
   * double-click/chevron). */
  onOpenDetail?: (task: Task) => void;
  /** Task 4.3 addendum ruling 6: clicking a row's tag chip navigates to that tag's view. */
  onTagClick?: (tag: string) => void;
  /** Task 4.3 addendum ruling 4: a drop within a draggable section. */
  onReorder?: (taskId: string, afterId: string | null) => void;
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
  {
    sections,
    data,
    now,
    selectedId,
    onSelect,
    onToggle,
    editingId,
    onEditSave,
    onEditCancel,
    onOpenDetail,
    onTagClick,
    onReorder,
    onKeyDown,
    activeDescendantId
  },
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
          data={data}
          now={now}
          selectedId={selectedId}
          onSelect={onSelect}
          onToggle={onToggle}
          editingId={editingId}
          onEditSave={onEditSave}
          onEditCancel={onEditCancel}
          onOpenDetail={onOpenDetail}
          onTagClick={onTagClick}
          onReorder={onReorder}
          fill={fill}
        />
      ))}
    </div>
  );
});
