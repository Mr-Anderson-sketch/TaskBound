// renderer/planner/PlannerApp — the planner window shell (Task 4.1 addendum, Task 4.2
// addendum). Owns window-session state only (`view`, `selectedId`, `layout`) — the
// Store is the single source of truth (CLAUDE.md). Keyboard undo/redo and the
// confirmation toast are Task 2.4 (see ./Toast.tsx); the rest of the keyboard model
// (j/k, single-key actions, menus, the command palette) is wired by usePlannerKeys.ts
// (Task 4.2) to keep this file under ~220 lines.
import { useEffect, useRef, useState } from 'react';
import { useApplyTheme } from '../theme/ThemeProvider';
import { useSnapshot } from '../lib/useStore';
import type { ActionInput } from '../lib/useStore';
import { keyGlyphs } from '../../shared/platform';
import type { Platform } from '../../shared/platform';
import type { Task, Due, Action, List } from '../../core/types';
import { INBOX_ID, createEmptyData } from '../../core/defaults';
import { Toast } from './Toast';
import { TitleBar } from './TitleBar';
import { Rail } from './Rail';
import { TaskList, resolveView } from './TaskList';
import type { ViewId, TaskListHandle } from './TaskList';
import { EmptyState } from './EmptyState';
import { Menu } from './Menu';
import { DueField } from './DueField';
import { Commands } from './Commands';
import { rowDomId } from './TaskRow';
import { usePlannerKeys, runPaletteAction } from './usePlannerKeys';
import type { MenuState } from './usePlannerKeys';
import { snoozeOptions } from './keys';
import { Settings } from '../settings/Settings';

const THREE_COL_MIN_WIDTH = 900;

function EmptyStateFor({ view, title, platform, captureAccelerator }: { view: ViewId; title: string; platform: Platform; captureAccelerator: string }) {
  if (view === 'today') {
    return (
      <EmptyState
        title="Nothing planned for today."
        hint={
          <>
            Press <kbd>{keyGlyphs(captureAccelerator, platform).join(platform === 'darwin' ? '' : '+')}</kbd> anywhere to add a task, or
            pick from Inbox.
          </>
        }
      />
    );
  }
  if (view === 'upcoming') return <EmptyState title="Nothing due in the next two weeks." />;
  if (view === 'inbox') return <EmptyState title="Inbox zero." />;
  if (view === 'logbook') return <EmptyState title="Nothing completed yet." />;
  if (view.startsWith('list:')) return <EmptyState title={`No open tasks in ${title}.`} />;
  return <EmptyState title={`No open tasks tagged ${title}.`} />;
}

/** Every tag used by an open, top-level task, alphabetical — same rule as Rail.tsx's
 * own (private) list, duplicated here rather than exported across a file this task's
 * scope doesn't touch. */
function openTagsSorted(tasks: Task[]): string[] {
  const set = new Set<string>();
  for (const t of tasks) {
    if (t.status !== 'open' || t.parentId !== undefined) continue;
    for (const tag of t.tags) set.add(tag);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

interface TaskActionMenuProps {
  menu: MenuState;
  task: Task;
  anchor: HTMLElement;
  lists: List[];
  now: number;
  dispatchOwn: (action: ActionInput) => void;
  closeMenu: () => void;
}

/** The snooze/due/move-to-list menu content (Task 4.2 addendum ruling 3) — composed
 * here (not in Menu.tsx, which stays a generic anchored overlay) since only PlannerApp
 * knows which task/kind is active. `key={`${menu.kind}-${menu.taskId}`}` at the call
 * site remounts this fresh whenever the target changes, so "Pick…" mode (local state)
 * never leaks from one snooze session into the next. */
function TaskActionMenu({ menu, task, anchor, lists, now, dispatchOwn, closeMenu }: TaskActionMenuProps) {
  const [picking, setPicking] = useState(false);

  const label = menu.kind === 'snooze' ? 'Snooze' : menu.kind === 'due' ? 'Due date' : 'Move to list';

  const items =
    menu.kind === 'move'
      ? [...lists].sort((a, b) => (a.id === INBOX_ID ? -1 : b.id === INBOX_ID ? 1 : a.order - b.order)).map((l) => ({ id: l.id, label: l.name }))
      : menu.kind === 'snooze' && !picking
        ? snoozeOptions(now).map((o) => ({ id: o.id, label: o.label }))
        : undefined;

  const onSelect =
    menu.kind === 'move'
      ? (listId: string) => {
          dispatchOwn({ type: 'task/move', id: task.id, listId });
          closeMenu();
        }
      : menu.kind === 'snooze'
        ? (id: string) => {
            if (id === 'pick') {
              setPicking(true);
              return;
            }
            const until = snoozeOptions(now).find((o) => o.id === id)?.until;
            if (until !== undefined) dispatchOwn({ type: 'task/snooze', id: task.id, until });
            closeMenu();
          }
        : undefined;

  const showDueField = menu.kind === 'due' || (menu.kind === 'snooze' && picking);

  return (
    <Menu anchor={anchor} onClose={closeMenu} label={label} items={items} onSelect={onSelect}>
      {showDueField && (
        <DueField
          now={now}
          onClose={closeMenu}
          onApply={(due: Due | undefined) => {
            if (menu.kind === 'due') {
              dispatchOwn({ type: 'task/edit', id: task.id, patch: { due } });
            } else if (due) {
              const at = new Date(due.date + 'T' + (due.time ?? '09:00'));
              dispatchOwn({ type: 'task/snooze', id: task.id, until: at.getTime() });
            }
            closeMenu();
          }}
        />
      )}
    </Menu>
  );
}

export function PlannerApp() {
  const snapshot = useSnapshot();
  useApplyTheme(snapshot);
  const [ownRev, setOwnRev] = useState<number | undefined>(undefined);
  const [view, setView] = useState<ViewId>('today');
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [layout, setLayout] = useState<'two' | 'three'>('three');
  const rootRef = useRef<HTMLDivElement>(null);
  const taskListRef = useRef<TaskListHandle>(null);

  const platform: Platform = snapshot?.platform ?? 'win32';

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setLayout(entry.contentRect.width >= THREE_COL_MIN_WIDTH ? 'three' : 'two');
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // --- keyboard undo/redo (addendum ruling 3, Task 2.4): Ctrl+Z / ⌘Z -> undo; Ctrl+Shift+Z,
  // Ctrl+Y / ⌘⇧Z -> redo. Skipped while focus is inside a text input or textarea. ---
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const mod = platform === 'darwin' ? e.metaKey : e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && e.shiftKey) {
        e.preventDefault();
        void window.tb.invoke('store:redo');
      } else if (key === 'z') {
        e.preventDefault();
        void window.tb.invoke('store:undo');
      } else if (key === 'y') {
        e.preventDefault();
        void window.tb.invoke('store:redo');
      } else if (e.key === ',') {
        // Task 5.1 addendum ruling 1: Ctrl+, / ⌘, opens Settings from ANYWHERE in the
        // planner, not just while the task list has focus (keys.ts's commandForKey
        // handles the task-list-focused case; this global listener is the fallback for
        // every other focus target, e.g. the settings pane's own controls).
        e.preventDefault();
        setView('settings:strip');
        setSelectedId(undefined);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [platform]);

  // Task 5.1 addendum ruling 1: main sends this after `planner.show()` (the tray's
  // "Settings…" item) to route straight to a settings section.
  useEffect(() => {
    return window.tb.on('planner:navigate', (v) => selectView(v as ViewId));
  }, []);

  const selectView = (v: ViewId): void => {
    setView(v);
    setSelectedId(undefined);
  };

  const onSelectTask = (task: Task): void => setSelectedId(task.id);

  // Bypasses the `dispatch()` helper to capture the resulting rev: the toast only
  // shows an "<label> · Undo" confirmation for a `lastUndo` this window's OWN action
  // produced (Task 2.4 addendum ruling 2). Shared by every keyboard-triggered dispatch
  // (usePlannerKeys, the menus below) and the mouse-driven `onToggle`.
  const dispatchOwn = (action: ActionInput): void => {
    void window.tb.invoke('store:dispatch', { ...action, now: Date.now() } as Action).then(({ rev }) => setOwnRev(rev));
  };
  const onToggle = (task: Task): void =>
    dispatchOwn(
      task.status === 'done'
        ? { type: 'task/uncomplete', id: task.id }
        : { type: 'task/complete', id: task.id, by: 'user', spawnId: crypto.randomUUID() }
    );

  const now = Date.now();
  const isSettings = view.startsWith('settings:');
  const resolved =
    snapshot && !isSettings ? resolveView(view, snapshot.data, now) : { title: '', meta: '', sections: [], isEmpty: true };

  const keys = usePlannerKeys({
    taskListRef,
    platform,
    view,
    setView: selectView,
    // Hooks run unconditionally, before the `if (!snapshot) return null` below — this
    // placeholder is only ever actually read once a snapshot exists (nothing before
    // that early return attaches `keys.onKeyDown` to a real element).
    data: snapshot?.data ?? createEmptyData(0, '0.0.0'),
    resolved,
    selectedId,
    setSelectedId,
    dispatchOwn
  });

  if (!snapshot) return null;

  const defaultListId = view.startsWith('list:') ? view.slice('list:'.length) : undefined;
  const menuTask = keys.menu ? snapshot.data.tasks.find((t) => t.id === keys.menu!.taskId) : undefined;
  const menuAnchor = keys.menu ? document.getElementById(rowDomId(keys.menu.taskId)) : null;

  // No prop on TitleBar (out of this task's file scope) exposes its capture field
  // programmatically — clicking its own trigger button reuses TitleBar's existing
  // `onClick={() => setActive(true)}` without needing to touch that file.
  const focusCapture = (): void => {
    document.querySelector<HTMLButtonElement>('.tb .cap-trigger')?.click();
  };

  return (
    <div className="planner" data-layout={layout} ref={rootRef}>
      <TitleBar
        platform={platform}
        captureAccelerator={snapshot.data.settings.hotkeys.capture}
        lists={snapshot.data.lists}
        defaultListId={defaultListId}
        today={view === 'today'}
        onMinimize={() => void window.tb.invoke('planner:minimize')}
        onClose={() => void window.tb.invoke('planner:hide')}
      />
      <div className="body">
        <Rail data={snapshot.data} view={view} now={now} onSelect={selectView} />
        <div className="main">
          {isSettings ? (
            <Settings
              view={view}
              data={snapshot.data}
              platform={platform}
              capabilities={snapshot.capabilities}
              systemDark={snapshot.systemDark}
              onSelectSection={selectView}
              dispatchOwn={dispatchOwn}
            />
          ) : (
            <>
              <div className="h">
                <span className="d">{resolved.title}</span>
                <span className="m">{resolved.meta}</span>
              </div>
              {resolved.isEmpty ? (
                <EmptyStateFor
                  view={view}
                  title={resolved.title}
                  platform={platform}
                  captureAccelerator={snapshot.data.settings.hotkeys.capture}
                />
              ) : (
                <TaskList
                  ref={taskListRef}
                  sections={resolved.sections}
                  now={now}
                  selectedId={selectedId}
                  activeDescendantId={selectedId}
                  onSelect={onSelectTask}
                  onToggle={onToggle}
                  editingId={keys.editingId}
                  onEditSave={keys.onEditSave}
                  onEditCancel={keys.onEditCancel}
                  onKeyDown={keys.onKeyDown}
                />
              )}
            </>
          )}
        </div>
      </div>

      {keys.menu && menuTask && menuAnchor && (
        <TaskActionMenu
          key={`${keys.menu.kind}-${keys.menu.taskId}`}
          menu={keys.menu}
          task={menuTask}
          anchor={menuAnchor}
          lists={snapshot.data.lists}
          now={now}
          dispatchOwn={dispatchOwn}
          closeMenu={keys.closeMenu}
        />
      )}

      {keys.paletteOpen && (
        <Commands
          ctx={{
            lists: snapshot.data.lists.filter((l) => l.id !== INBOX_ID),
            tags: openTagsSorted(snapshot.data.tasks),
            selectedTask: snapshot.data.tasks.find((t) => t.id === selectedId),
            platform
          }}
          onClose={keys.closePalette}
          onRun={(action) =>
            runPaletteAction({
              action,
              data: snapshot.data,
              selectedId,
              setView: selectView,
              setSelectedId,
              setMenu: keys.setMenu,
              dispatchOwn,
              focusCapture,
              close: keys.closePalette
            })
          }
        />
      )}

      <Toast
        lastUndo={snapshot.lastUndo}
        lastUndone={snapshot.lastUndone}
        ownRev={ownRev}
        onUndo={() => void window.tb.invoke('store:undo')}
      />
    </div>
  );
}
