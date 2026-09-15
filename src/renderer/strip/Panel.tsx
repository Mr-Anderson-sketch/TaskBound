// renderer/strip/Panel — the hover panel (DESIGN.md "Hover panel"). Same width as the
// strip; the strip itself is rendered as this panel's last row on a bottom edge, first
// row on a top edge, so the strip never jumps when the panel opens/closes.
import { forwardRef } from 'react';
import type { ReactNode } from 'react';
import type { Edge } from '../../core/types';
import type { Snapshot } from '../../shared/ipc';
import { PanelRow } from './PanelRow';

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
    onSnooze
  },
  ref
) {
  const { today } = snapshot;
  const rows = [today.current, ...today.next].filter((t): t is NonNullable<typeof t> => t !== undefined).slice(0, 5);
  const nextTitle = today.next[0]?.title;

  return (
    <div ref={ref} className="panel" data-edge={edge}>
      {edge === 'top' && stripElement}
      <div className="head">
        <span>
          Today · {today.done} of {today.total} done
        </span>
        <span>{nextTitle ? `Next: ${nextTitle}` : ''}</span>
      </div>
      {showUndo && snapshot.lastUndoLabel && (
        <button type="button" className="undo" onClick={onUndo}>
          <span>{snapshot.lastUndoLabel}</span>
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
