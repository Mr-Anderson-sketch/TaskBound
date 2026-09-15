// renderer/planner/usePlannerKeys — wires src/renderer/planner/keys.ts's pure command
// mapping into the planner: owns the chord timer, the snooze/due/move menu, the
// command palette's open/closed state, inline title editing, and every
// keyboard-triggered dispatch (Task 4.2 addendum rulings 2-4). Kept out of
// PlannerApp.tsx to keep that file under ~220 lines (addendum ruling 8).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';
import type { Data, Task } from '../../core/types';
import type { ActionInput } from '../lib/useStore';
import type { Platform } from '../../shared/platform';
import { commandForKey, isEditableTarget, nextSelection, reorderTarget, CHORD_WINDOW_MS } from './keys';
import type { ChordState, Command } from './keys';
import type { PaletteCommandAction } from './commandsModel';
import type { ResolvedView, ViewId, TaskListHandle } from './TaskList';
import { flatRowIds } from './TaskList';

export type MenuKind = 'snooze' | 'due' | 'move';

export interface MenuState {
  kind: MenuKind;
  taskId: string;
}

export interface UsePlannerKeysArgs {
  taskListRef: RefObject<TaskListHandle | null>;
  platform: Platform;
  view: ViewId;
  setView: (view: ViewId) => void;
  data: Data;
  resolved: ResolvedView;
  selectedId: string | undefined;
  setSelectedId: (id: string | undefined) => void;
  dispatchOwn: (action: ActionInput) => void;
}

export interface UsePlannerKeysResult {
  onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  editingId: string | undefined;
  onEditSave: (task: Task, title: string) => void;
  onEditCancel: () => void;
  menu: MenuState | undefined;
  setMenu: (menu: MenuState | undefined) => void;
  closeMenu: () => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  closePalette: () => void;
  /** Which task's detail pane (if any) is open — Enter, a row double-click, or a row's
   * "Open details" chevron all funnel through `openDetail` (Task 4.3 addendum ruling 3). */
  detailOpenId: string | undefined;
  openDetail: (id: string) => void;
  /** Escape (handled by Detail.tsx itself) and the pane's own close button both call
   * this — closes and returns focus to the list, same as `closeMenu`/`closePalette`. */
  closeDetail: () => void;
}

export function usePlannerKeys(args: UsePlannerKeysArgs): UsePlannerKeysResult {
  const { taskListRef, platform, view, setView, data, resolved, selectedId, setSelectedId, dispatchOwn } = args;

  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [menu, setMenu] = useState<MenuState | undefined>(undefined);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [detailOpenId, setDetailOpenId] = useState<string | undefined>(undefined);

  const chordRef = useRef<ChordState>(undefined);
  const chordTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const clearChord = (): void => {
    chordRef.current = undefined;
    clearTimeout(chordTimerRef.current);
  };

  useEffect(() => () => clearTimeout(chordTimerRef.current), []);

  // Moves selection off a task that just stopped being visible (deleted, or
  // completed/uncompleted out of the current view) to whatever is now "next" — ruling
  // 2. Reacts to any cause of disappearance, not just keyboard-triggered ones (a click
  // on the row checkbox, or another window's edit arriving over IPC, behave the same).
  const prevFlatIdsRef = useRef<string[]>([]);
  useEffect(() => {
    const flatIds = flatRowIds(resolved.sections);
    if (selectedId !== undefined && !flatIds.includes(selectedId) && prevFlatIdsRef.current.includes(selectedId)) {
      setSelectedId(nextSelection(prevFlatIdsRef.current, flatIds, selectedId));
    } else if (selectedId === undefined && flatIds.length > 0) {
      // A view with visible rows and no selection (initial load, or right after
      // switching views) defaults to the first row — matches ruling 2's own "selects
      // the first row when nothing is selected" for the FIRST j/k press too, but
      // applied proactively so the list always shows a selection while it has focus,
      // rather than only after the user's first keypress.
      setSelectedId(flatIds[0]);
    }
    prevFlatIdsRef.current = flatIds;
  }, [resolved.sections, selectedId, setSelectedId]);

  const closeMenu = (): void => {
    setMenu(undefined);
    taskListRef.current?.el?.focus();
  };
  const closePalette = (): void => {
    setPaletteOpen(false);
    taskListRef.current?.el?.focus();
  };
  const openDetail = (id: string): void => setDetailOpenId(id);
  const closeDetail = (): void => {
    setDetailOpenId(undefined);
    taskListRef.current?.el?.focus();
  };

  // Closes the detail pane if the task it's showing no longer exists (deleted from
  // under it, e.g. via Undo racing a delete on another window) — it would otherwise
  // keep referencing a stale id with nothing to render.
  useEffect(() => {
    if (detailOpenId !== undefined && !data.tasks.some((t) => t.id === detailOpenId)) {
      setDetailOpenId(undefined);
    }
  }, [data.tasks, detailOpenId]);

  const selectedTask = useMemo(() => data.tasks.find((t) => t.id === selectedId), [data.tasks, selectedId]);

  const onEditSave = (task: Task, title: string): void => {
    setEditingId(undefined);
    if (title.trim() === task.title) return; // unchanged: task/edit's own trim would no-op anyway
    dispatchOwn({ type: 'task/edit', id: task.id, patch: { title } });
  };
  const onEditCancel = (): void => setEditingId(undefined);

  const moveSelection = (dir: 'down' | 'up'): void => {
    const ids = flatRowIds(resolved.sections);
    if (ids.length === 0) return;
    if (selectedId === undefined) {
      setSelectedId(ids[0]);
      taskListRef.current?.scrollToId(ids[0]);
      return;
    }
    const i = ids.indexOf(selectedId);
    const nextIndex = i === -1 ? 0 : dir === 'down' ? Math.min(ids.length - 1, i + 1) : Math.max(0, i - 1);
    const nextId = ids[nextIndex];
    setSelectedId(nextId);
    taskListRef.current?.scrollToId(nextId);
  };

  const runCommand = (command: Command): void => {
    switch (command.type) {
      case 'chordStart': {
        chordRef.current = 'g';
        clearTimeout(chordTimerRef.current);
        chordTimerRef.current = setTimeout(clearChord, CHORD_WINDOW_MS);
        return;
      }
      case 'goto': {
        clearChord();
        setView(command.view);
        setSelectedId(undefined);
        return;
      }
      case 'commandPalette': {
        clearChord();
        setPaletteOpen(true);
        return;
      }
      case 'nav': {
        moveSelection(command.dir);
        return;
      }
      case 'toggleDone': {
        if (!selectedTask) return;
        dispatchOwn(
          selectedTask.status === 'done'
            ? { type: 'task/uncomplete', id: selectedTask.id }
            : { type: 'task/complete', id: selectedTask.id, by: 'user', spawnId: crypto.randomUUID() }
        );
        return;
      }
      case 'openDetail': {
        if (selectedId) openDetail(selectedId);
        return;
      }
      case 'editTitle': {
        if (selectedId) setEditingId(selectedId);
        return;
      }
      case 'toggleToday': {
        if (!selectedTask) return;
        dispatchOwn({ type: 'task/setToday', ids: [selectedTask.id], today: !selectedTask.today });
        return;
      }
      case 'delete': {
        if (!selectedTask) return;
        dispatchOwn({ type: 'task/delete', id: selectedTask.id });
        return;
      }
      case 'snooze':
      case 'due':
      case 'move': {
        if (selectedId) setMenu({ kind: command.type, taskId: selectedId });
        return;
      }
      case 'reorder': {
        if (!selectedTask) return;
        if (view === 'upcoming') return; // date-grouped: explicitly a no-op (ruling 3)
        // Today splits ONE order-sorted sequence across "Current" and "Up next" purely
        // for display (`todayTasks`'s `current`/`upNext` are `candidates(...).slice`,
        // the same sort); "Done" is a different criterion entirely (completedAt, not
        // order) and is excluded so reordering never tries to walk into it. A plain
        // list/tag/Inbox view has just the one (non-"done") section already.
        const orderedIds = flatRowIds(resolved.sections.filter((s) => s.key !== 'done'));
        const target = reorderTarget(orderedIds, selectedTask.id, command.dir);
        if (!target) return;
        dispatchOwn({ type: 'task/move', id: selectedTask.id, afterId: target.afterId });
        return;
      }
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (isEditableTarget(e.target)) return;
    if (menu || paletteOpen || editingId !== undefined || detailOpenId !== undefined) return;

    const command = commandForKey(e, platform, chordRef.current);
    if (chordRef.current === 'g' && command?.type !== 'commandPalette') clearChord();
    if (!command) return;

    e.preventDefault();
    runCommand(command);
  };

  return {
    onKeyDown,
    editingId,
    onEditSave,
    onEditCancel,
    menu,
    setMenu,
    closeMenu,
    paletteOpen,
    setPaletteOpen,
    closePalette,
    detailOpenId,
    openDetail,
    closeDetail
  };
}

export interface RunPaletteActionArgs {
  action: PaletteCommandAction;
  data: Data;
  selectedId: string | undefined;
  setView: (view: ViewId) => void;
  setSelectedId: (id: string | undefined) => void;
  setMenu: (menu: MenuState | undefined) => void;
  dispatchOwn: (action: ActionInput) => void;
  focusCapture: () => void;
  close: () => void;
}

/**
 * Resolves one command-palette selection against live planner state (Task 4.2 addendum
 * ruling 4). Separate from the hook above (rather than routed back through
 * `commandForKey`/`Command`) because palette commands are a superset of the plain
 * keyboard `Command`s — theme/appearance switches and "Go to list/tag: …" have no
 * single-key equivalent. Always closes the palette itself; per-task actions
 * (snooze/due/move) additionally open the corresponding menu.
 */
export function runPaletteAction(args: RunPaletteActionArgs): void {
  const { action, data, selectedId, setView, setSelectedId, setMenu, dispatchOwn, focusCapture, close } = args;
  close();

  switch (action.kind) {
    case 'goto': {
      setView(action.view);
      setSelectedId(undefined);
      return;
    }
    case 'addTask': {
      focusCapture();
      return;
    }
    case 'theme': {
      dispatchOwn({ type: 'settings/patch', patch: { theme: { name: action.name } } });
      return;
    }
    case 'appearance': {
      dispatchOwn({ type: 'settings/patch', patch: { theme: { mode: action.mode } } });
      return;
    }
    default: {
      // Every remaining action needs the currently selected task.
      const task = data.tasks.find((t) => t.id === selectedId);
      if (!task) return;
      switch (action.kind) {
        case 'complete':
          dispatchOwn(
            task.status === 'done'
              ? { type: 'task/uncomplete', id: task.id }
              : { type: 'task/complete', id: task.id, by: 'user', spawnId: crypto.randomUUID() }
          );
          return;
        case 'toggleToday':
          dispatchOwn({ type: 'task/setToday', ids: [task.id], today: !task.today });
          return;
        case 'delete':
          dispatchOwn({ type: 'task/delete', id: task.id });
          return;
        case 'snooze':
        case 'due':
        case 'move':
          setMenu({ kind: action.kind, taskId: task.id });
          return;
      }
    }
  }
}
