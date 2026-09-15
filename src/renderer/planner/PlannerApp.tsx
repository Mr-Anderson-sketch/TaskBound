// renderer/planner/PlannerApp — the planner window shell (Task 4.1 addendum). Owns
// window-session state only (`view`, `selectedId`, `layout`) — the Store is the single
// source of truth (CLAUDE.md). Keyboard undo/redo and the confirmation toast are Task
// 2.4 (see ./Toast.tsx); kept working here unchanged.
import { useEffect, useRef, useState } from 'react';
import { useApplyTheme } from '../theme/ThemeProvider';
import { useSnapshot } from '../lib/useStore';
import { keyGlyphs } from '../../shared/platform';
import type { Platform } from '../../shared/platform';
import type { Task } from '../../core/types';
import { Toast } from './Toast';
import { TitleBar } from './TitleBar';
import { Rail } from './Rail';
import { TaskList, resolveView } from './TaskList';
import type { ViewId } from './TaskList';
import { EmptyState } from './EmptyState';

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

export function PlannerApp() {
  const snapshot = useSnapshot();
  useApplyTheme(snapshot);
  const [ownRev, setOwnRev] = useState<number | undefined>(undefined);
  const [view, setView] = useState<ViewId>('today');
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [layout, setLayout] = useState<'two' | 'three'>('three');
  const rootRef = useRef<HTMLDivElement>(null);

  const platform: Platform = snapshot?.platform ?? 'win32';

  // Addendum ruling 8: a `data-layout` attribute for Task 4.3's detail pane to key off
  // of — nothing renders in that region yet.
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
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [platform]);

  const selectView = (v: ViewId): void => {
    setView(v);
    setSelectedId(undefined);
  };

  const onSelectTask = (task: Task): void => setSelectedId(task.id);

  // Bypasses the `dispatch()` helper to capture the resulting rev: the toast only
  // shows an "<label> · Undo" confirmation for a `lastUndo` this window's OWN action
  // produced (Task 2.4 addendum ruling 2).
  const onToggle = (task: Task): void => {
    const action =
      task.status === 'done'
        ? { type: 'task/uncomplete' as const, id: task.id, now: Date.now() }
        : // spawnId is harmless to include unconditionally (Task 3.3 ruling 3): the
          // reducer only spawns a next occurrence when the completed task has `recurrence`.
          { type: 'task/complete' as const, id: task.id, by: 'user' as const, now: Date.now(), spawnId: crypto.randomUUID() };
    void window.tb.invoke('store:dispatch', action).then(({ rev }) => setOwnRev(rev));
  };

  if (!snapshot) return null;

  const now = Date.now();
  const resolved = resolveView(view, snapshot.data, now);
  const defaultListId = view.startsWith('list:') ? view.slice('list:'.length) : undefined;

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
          <div className="h">
            <span className="d">{resolved.title}</span>
            <span className="m">{resolved.meta}</span>
          </div>
          {resolved.isEmpty ? (
            <EmptyStateFor view={view} title={resolved.title} platform={platform} captureAccelerator={snapshot.data.settings.hotkeys.capture} />
          ) : (
            <TaskList sections={resolved.sections} now={now} selectedId={selectedId} onSelect={onSelectTask} onToggle={onToggle} />
          )}
        </div>
      </div>
      <Toast
        lastUndo={snapshot.lastUndo}
        lastUndone={snapshot.lastUndone}
        ownRev={ownRev}
        onUndo={() => void window.tb.invoke('store:undo')}
      />
    </div>
  );
}
