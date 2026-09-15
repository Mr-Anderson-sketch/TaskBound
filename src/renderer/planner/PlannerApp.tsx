// renderer/planner/PlannerApp — a placeholder for Slice 4's full planner: just the
// window shell (title bar, brand, window controls) and a flat "Today" list. Kept
// under ~150 lines per the brief. Task 2.4 adds keyboard undo/redo and the
// confirmation toast (see ./Toast.tsx and the task's addendum, rulings 2-3).
import { useEffect, useState } from 'react';
import { useApplyTheme } from '../theme/ThemeProvider';
import { useSnapshot } from '../lib/useStore';
import { keyGlyphs } from '../../shared/platform';
import { Toast } from './Toast';

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

export function PlannerApp() {
  const snapshot = useSnapshot();
  useApplyTheme(snapshot);
  const [ownRev, setOwnRev] = useState<number | undefined>(undefined);

  const platform = snapshot?.platform ?? 'win32';

  // --- keyboard undo/redo (addendum ruling 3): Ctrl+Z / ⌘Z -> undo; Ctrl+Shift+Z,
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

  if (!snapshot) return null;

  const { today } = snapshot;
  const rows: Array<{ task: (typeof snapshot.data.tasks)[number]; cur: boolean; done?: boolean }> = [
    ...(today.current ? [{ task: today.current, cur: true }] : []),
    ...today.next.map((t) => ({ task: t, cur: false })),
    ...snapshot.data.tasks.filter((t) => t.today && t.status === 'done').map((t) => ({ task: t, cur: false, done: true }))
  ];

  // Bypasses the `dispatch()` helper to capture the resulting rev: the toast only
  // shows an "<label> · Undo" confirmation for a `lastUndo` this window's OWN action
  // produced, not one from the strip or palette (addendum ruling 2).
  const toggle = (id: string, done: boolean): void => {
    const action = done
      ? { type: 'task/uncomplete' as const, id, now: Date.now() }
      : { type: 'task/complete' as const, id, by: 'user' as const, now: Date.now() };
    void window.tb.invoke('store:dispatch', action).then(({ rev }) => setOwnRev(rev));
  };

  return (
    <div className="planner">
      <div className={platform === 'darwin' ? 'tb mac' : 'tb'}>
        <span className="brand">TimeBound</span>
        {platform !== 'darwin' && (
          <div className="wc">
            <button type="button" aria-label="Minimize" onClick={() => void window.tb.invoke('planner:hide')}>
              &#8212;
            </button>
            <button type="button" aria-label="Close" onClick={() => void window.tb.invoke('planner:hide')}>
              &#10005;
            </button>
          </div>
        )}
      </div>
      <div className="main">
        <div className="h">
          <span className="d">Today</span>
          <span className="m">{DATE_FORMAT.format(new Date())}</span>
        </div>
        {rows.length === 0 ? (
          <div className="empty">
            <div className="e1">Nothing planned for today.</div>
            <p>
              Press <kbd>{keyGlyphs(snapshot.data.settings.hotkeys.capture, platform).join(platform === 'darwin' ? '' : '+')}</kbd>{' '}
              anywhere to add a task, or pick from Inbox.
            </p>
          </div>
        ) : (
          rows.map(({ task, cur, done }) => (
            <button
              key={task.id}
              type="button"
              className={['task', cur ? 'cur' : '', done ? 'done' : ''].filter(Boolean).join(' ')}
              onClick={() => toggle(task.id, Boolean(done))}
            >
              <span className="cb" />
              <span className="t">{task.title}</span>
            </button>
          ))
        )}
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
