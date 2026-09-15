// renderer/planner/PlannerApp — a placeholder for Slice 4's full planner: just the
// window shell (title bar, brand, window controls) and a flat "Today" list. Kept
// under ~150 lines per the brief.
import { useApplyTheme } from '../theme/ThemeProvider';
import { dispatch, useSnapshot } from '../lib/useStore';

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

export function PlannerApp() {
  const snapshot = useSnapshot();
  useApplyTheme(snapshot);

  if (!snapshot) return null;

  const { today, platform } = snapshot;
  const rows: Array<{ task: (typeof snapshot.data.tasks)[number]; cur: boolean; done?: boolean }> = [
    ...(today.current ? [{ task: today.current, cur: true }] : []),
    ...today.next.map((t) => ({ task: t, cur: false })),
    ...snapshot.data.tasks.filter((t) => t.today && t.status === 'done').map((t) => ({ task: t, cur: false, done: true }))
  ];

  const toggle = (id: string, done: boolean): void => {
    dispatch(done ? { type: 'task/uncomplete', id } : { type: 'task/complete', id, by: 'user' });
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
              Press <kbd>{snapshot.data.settings.hotkeys.capture}</kbd> anywhere to add a task, or pick from Inbox.
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
    </div>
  );
}
