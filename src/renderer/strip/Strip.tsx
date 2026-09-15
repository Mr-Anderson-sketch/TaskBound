// renderer/strip/Strip — the collapsed strip's visual: DESIGN.md "The strip (pixel
// spec)". A dumb component: StripApp computes state/title/chip/progress and passes
// them down, and owns the ResizeObserver via `ref`.
import { forwardRef, useEffect, useRef, useState } from 'react';
import type { MouseEventHandler } from 'react';
import type { Edge } from '../../core/types';

export interface StripChip {
  text: string;
  variant?: 'paused' | 'overtime' | 'plan';
  onClick?: () => void;
}

export interface StripProps {
  state: string;
  edge: Edge;
  title: string;
  dim?: string;
  strike?: boolean;
  chip?: StripChip;
  /** 0..1, or undefined to hide the progress hairline entirely (DESIGN.md: "hidden
   * when total is 0"). */
  progress?: number;
  clickThrough?: boolean;
  /** Incremented by StripApp to trigger a fresh 160 ms title slide-in (DESIGN.md
   * "Motion" — fix round 1, finding 2): a plain boolean can't re-trigger a CSS
   * animation on a class that's already applied, so the parent bumps a counter and
   * this component reacts to it CHANGING, not to its value. */
  slidePulse?: number;
  onHandleMouseDown?: MouseEventHandler;
  onMouseMove?: MouseEventHandler;
  onMouseEnter?: MouseEventHandler;
  onMouseLeave?: MouseEventHandler;
  onTitleClick?: () => void;
  onTitleDoubleClick?: () => void;
}

export const Strip = forwardRef<HTMLDivElement, StripProps>(function Strip(
  {
    state,
    edge,
    title,
    dim,
    strike,
    chip,
    progress,
    clickThrough,
    slidePulse,
    onHandleMouseDown,
    onMouseMove,
    onMouseEnter,
    onMouseLeave,
    onTitleClick,
    onTitleDoubleClick
  },
  ref
) {
  const chipClass = chip ? ['chip', chip.variant].filter(Boolean).join(' ') : '';

  const [sliding, setSliding] = useState(false);
  const prevPulse = useRef(slidePulse);
  useEffect(() => {
    if (slidePulse !== undefined && slidePulse !== prevPulse.current) {
      prevPulse.current = slidePulse;
      setSliding(true);
    }
  }, [slidePulse]);

  return (
    <div
      ref={ref}
      className="strip"
      data-state={state}
      data-edge={edge}
      data-clickthrough={clickThrough ? 'true' : undefined}
      aria-hidden="true"
      onMouseMove={onMouseMove}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="handle" onMouseDown={onHandleMouseDown}>
        <div className="dot" />
      </div>
      <div
        className={sliding ? 'title slide-in' : 'title'}
        onAnimationEnd={() => setSliding(false)}
        onClick={onTitleClick}
        onDoubleClick={onTitleDoubleClick}
      >
        {strike ? <span className="strike">{title}</span> : title}
        {dim && <span className="dim">{dim}</span>}
      </div>
      {chip &&
        (chip.onClick ? (
          <button type="button" className={`${chipClass} is-button`} onClick={chip.onClick}>
            {chip.text}
          </button>
        ) : (
          <div className={chipClass}>{chip.text}</div>
        ))}
      {progress !== undefined && (
        <div className="progress" style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }} />
      )}
    </div>
  );
});
