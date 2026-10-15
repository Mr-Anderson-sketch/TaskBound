import { forwardRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Task, ThemeName } from '../../shared/types';
import type { DaySummary } from '../../shared/stateHelpers';
import { formatDuration, formatSeconds } from '../utils/time';
import { parseQuickAdd } from '../utils/parse';
import logoIcon from '../assets/logo-icon.png';
import { IconClose, IconExpand, IconMinus, IconMoon, IconMore, IconPause, IconPlay, IconSun } from './Icons';

interface HeaderProps {
  theme: ThemeName;
  today: number;
  score: number;
  onSummary: () => void;
  onToggleTheme: () => void;
  onMenu: (x: number, y: number) => void;
  onMinimize: () => void;
  onClose: () => void;
}

export const formatScore = (score: number): string => (score > 0 ? `+${score}` : `${score}`);

export function Header({ theme, today, score, onSummary, onToggleTheme, onMenu, onMinimize, onClose }: HeaderProps) {
  return (
    <header className="header" data-tauri-drag-region>
      <img className="logo" src={logoIcon} alt="" />
      <button type="button" className="chip" onClick={onSummary} aria-label={`${today} done today, score ${formatScore(score)}. Show today’s summary`}>
        <span className="mono">{today} today</span>
        <span aria-hidden="true">·</span>
        <span className="score mono">{formatScore(score)}</span>
      </button>
      <div className="spacer" data-tauri-drag-region />
      <button
        type="button"
        className="icon-btn"
        onClick={onToggleTheme}
        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        title={theme === 'dark' ? 'Light mode (Frost)' : 'Dark mode (Island)'}
      >
        {theme === 'dark' ? <IconSun size={16} /> : <IconMoon size={16} />}
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label="More"
        aria-haspopup="menu"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          onMenu(rect.right - 220, rect.bottom + 6);
        }}
      >
        <IconMore size={18} />
      </button>
      <button type="button" className="icon-btn" onClick={onMinimize} aria-label="Minimize">
        <IconMinus size={15} />
      </button>
      <button type="button" className="icon-btn close" onClick={onClose} aria-label="Quit TimeBound" title="Quit">
        <IconClose size={15} />
      </button>
    </header>
  );
}

interface NowCardProps {
  task?: Task;
  position: number;
  openCount: number;
  time: string;
  total: string;
  fraction: number;
  onDone: () => void;
  onTogglePause: () => void;
  onAddFive: () => void;
  onFocus: () => void;
  onSetTime: () => void;
}

export function NowCard({ task, position, openCount, time, total, fraction, onDone, onTogglePause, onAddFive, onFocus, onSetTime }: NowCardProps) {
  if (!task) {
    return (
      <section className="now" aria-label="Current task">
        <p className="empty">
          <strong>Nothing running.</strong>
          <br />
          Add a task below — try “Write intro 25m”.
        </p>
      </section>
    );
  }
  const hasTime = (task.timeAssignedSeconds ?? 0) > 0;
  const paused = Boolean(task.isPaused);
  return (
    <section className={`now${paused ? ' paused' : ''}`} aria-label="Current task">
      <div className="meta">
        <span>{paused ? <span className="paused-tag">Paused</span> : 'Now'}</span>
        <span className="mono">
          {String(position).padStart(2, '0')} / {String(openCount).padStart(2, '0')}
        </span>
      </div>
      <div className="title" title={task.title}>
        {task.title}
      </div>
      {hasTime ? (
        <>
          <div className="clock">
            <span className="time mono" role="timer" aria-live="off">
              {time}
            </span>
            <span className="of">of {total}</span>
          </div>
          <div className="track" aria-hidden="true">
            <div style={{ width: `${fraction * 100}%` }} />
          </div>
        </>
      ) : (
        <div className="notime">
          <span>No time set for this task.</span>
          <button type="button" className="btn primary" style={{ height: 32 }} onClick={onSetTime}>
            Set time
          </button>
        </div>
      )}
      <div className="actions">
        <button type="button" className="btn primary grow" onClick={onDone}>
          Done
        </button>
        <button type="button" className="btn grow" onClick={onTogglePause} disabled={!hasTime}>
          {paused ? <IconPlay size={14} /> : <IconPause size={14} />}
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" className="btn mono" onClick={onAddFive} title="Add 5 minutes (costs 1 point)">
          +5m
        </button>
        <button type="button" className="btn square" onClick={onFocus} aria-label="Focus mode" title="Focus mode (F)">
          <IconExpand size={16} />
        </button>
      </div>
    </section>
  );
}

interface AddBarProps {
  requireTime: boolean;
  onAdd: (title: string, seconds?: number) => void;
}

export const AddBar = forwardRef<HTMLInputElement, AddBarProps>(function AddBar({ requireTime, onAdd }, ref) {
  const [value, setValue] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const parsed = value.trim() ? parseQuickAdd(value) : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!parsed || !parsed.title) {
      return;
    }
    if (requireTime && !parsed.seconds) {
      setHint('Add a time so the timer can start — e.g. “Write intro 25m”.');
      return;
    }
    onAdd(parsed.title, parsed.seconds);
    setValue('');
    setHint(null);
  };

  return (
    <div className="addbar">
      <form onSubmit={submit}>
        <label htmlFor="quick-add" className="sr-only">
          Add a task
        </label>
        <input
          id="quick-add"
          ref={ref}
          value={value}
          autoComplete="off"
          spellCheck={false}
          placeholder="Add a task — “Review deck 20m”"
          onChange={(event) => {
            setValue(event.target.value);
            setHint(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setValue('');
              event.currentTarget.blur();
            }
          }}
        />
        {parsed?.seconds ? <span className="parsed mono">{formatDuration(parsed.seconds)}</span> : null}
      </form>
      {hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
});

export function SummaryPopover({ summary, total, score, onClose }: { summary: DaySummary; total: number; score: number; onClose: () => void }) {
  const accuracy = summary.spentSeconds > 0 && summary.plannedSeconds > 0 ? Math.round((summary.plannedSeconds / summary.spentSeconds) * 100) : null;
  let note = 'Finish a task to see how your estimates compare with reality.';
  if (summary.done > 0 && accuracy !== null) {
    if (accuracy >= 90 && accuracy <= 110) {
      note = `You planned ${formatDuration(summary.plannedSeconds)} and used ${formatDuration(summary.spentSeconds)}. Your estimates are on the money.`;
    } else if (accuracy < 90) {
      note = `You planned ${formatDuration(summary.plannedSeconds)} but used ${formatDuration(summary.spentSeconds)}. Tasks are taking longer than you think.`;
    } else {
      note = `You planned ${formatDuration(summary.plannedSeconds)} and used only ${formatDuration(summary.spentSeconds)}. You could plan tighter.`;
    }
  }
  return (
    <div className="popover" role="dialog" aria-label="Today" onMouseLeave={onClose}>
      <h3>Today</h3>
      <div className="stat-grid">
        <div className="stat">
          <b className="mono">{summary.done}</b>
          <span>tasks done</span>
        </div>
        <div className="stat">
          <b className="mono">{formatDuration(summary.spentSeconds)}</b>
          <span>focused</span>
        </div>
        <div className="stat">
          <b className="mono">{summary.finishedEarly}</b>
          <span>finished early</span>
        </div>
        <div className="stat">
          <b className="mono">{summary.timeAdds}</b>
          <span>times added time</span>
        </div>
      </div>
      <p>{note}</p>
      <p>
        All time: <span className="mono">{total}</span> done · score <span className="mono">{formatScore(score)}</span>
      </p>
    </div>
  );
}

export const remainingOf = (task?: Task): { time: string; total: string; fraction: number } => {
  if (!task) {
    return { time: '--:--', total: '--:--', fraction: 0 };
  }
  const assigned = task.timeAssignedSeconds ?? 0;
  const remaining = task.remainingSeconds ?? assigned;
  return {
    time: formatSeconds(remaining),
    total: formatSeconds(assigned),
    fraction: assigned > 0 ? Math.max(0, Math.min(1, remaining / assigned)) : 0
  };
};
