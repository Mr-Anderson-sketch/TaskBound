// renderer/strip/Panel — the hover panel (DESIGN.md "Hover panel"). Same width as the
// strip; the strip itself is rendered as this panel's last row on a bottom edge, first
// row on a top edge, so the strip never jumps when the panel opens/closes.
import { forwardRef } from 'react';
import type { ReactNode } from 'react';
import type { Edge } from '../../core/types';
import type { Snapshot } from '../../shared/ipc';
import { PanelRow } from './PanelRow';

// Minimal geometric glyphs (currentColor, no stroke/gradient) matching the strip's
// dot/chip aesthetic — DESIGN.md gives no explicit spec for this control (added by
// task-3.2-addendum ruling 8), so these follow the same flat, functional style.
const PlayIcon = (
  <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor" aria-hidden="true">
    <path d="M0 0 L10 6 L0 12 Z" />
  </svg>
);
const PauseIcon = (
  <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor" aria-hidden="true">
    <rect x="0" y="0" width="3" height="12" />
    <rect x="7" y="0" width="3" height="12" />
  </svg>
);

export interface PanelProps {
  snapshot: Snapshot;
  edge: Edge;
  stripElement: ReactNode;
  showUndo: boolean;
  onUndo: () => void;
  undoGlyphs: string;
  onMakeCurrent: (id: string) => void;
  onComplete: (id: string) => void;
  onSkip: (id: string) => void;
  onSnooze: (id: string) => void;
  onToggleTimer: () => void;
}

export const Panel = forwardRef<HTMLDivElement, PanelProps>(function Panel(
  {
    snapshot,
    edge,
    stripElement,
    showUndo,
    onUndo,
    undoGlyphs,
    onMakeCurrent,
    onComplete,
    onSkip,
    onSnooze,
    onToggleTimer
  },
  ref
) {
  const { today } = snapshot;
  const rows = [today.current, ...today.next].filter((t): t is NonNullable<typeof t> => t !== undefined).slice(0, 5);
  const nextTitle = today.next[0]?.title;
  const timerRunning = today.current?.timer?.runningSince !== undefined;
  const timerLabel = timerRunning ? 'Pause timer' : 'Start timer';

  return (
    <div ref={ref} className="panel" data-edge={edge}>
      {edge === 'top' && stripElement}
      <div className="head">
        <span>
          Today · {today.done} of {today.total} done
        </span>
        <div className="head-right">
          <button
            type="button"
            className="icon-btn"
            aria-label={timerLabel}
            title={timerLabel}
            disabled={!today.current}
            onClick={onToggleTimer}
          >
            {timerRunning ? PauseIcon : PlayIcon}
          </button>
          <span>{nextTitle ? `Next: ${nextTitle}` : ''}</span>
        </div>
      </div>
      {showUndo && snapshot.lastUndo && (
        <button type="button" className="undo" onClick={onUndo}>
          <span>{snapshot.lastUndo.label}</span>
          <span style={{ color: 'var(--accent)', fontWeight: 500 }}>Undo · {undoGlyphs}</span>
        </button>
      )}
      {rows.map((t) => (
        <PanelRow
          key={t.id}
          task={t}
          current={t.id === today.current?.id}
          onMakeCurrent={onMakeCurrent}
          onComplete={onComplete}
          onSkip={onSkip}
          onSnooze={onSnooze}
        />
      ))}
      {edge === 'bottom' && stripElement}
    </div>
  );
});
