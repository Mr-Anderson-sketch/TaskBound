// renderer/strip/Pill — the collapsed strip: title only, max 240 px, timer replaces
// the tail when running (DESIGN.md "The strip (pixel spec)": "Collapsed pill: 24 tall,
// title only, max 240 wide, timer replaces the tail when running").
import { forwardRef } from 'react';
import { fmtClock } from '../../core/timer';
import type { DisplayTime } from '../lib/useDisplayTime';

export interface PillProps {
  title: string;
  display: DisplayTime;
  /** Fix round 1, item 3 minor: during a pomodoro break, the pill shows the break's
   * own countdown instead of `display` (which reflects the — paused — current
   * task's timer, not the break). Already-formatted (`fmtClock`) text; when set, it
   * replaces the tail regardless of `display.mode`. */
  chipOverride?: string;
}

export const Pill = forwardRef<HTMLDivElement, PillProps>(function Pill({ title, display, chipOverride }, ref) {
  const chipText = chipOverride ?? (display.mode !== 'none' ? fmtClock(display.seconds) : undefined);
  return (
    <div ref={ref} className="pill">
      <span className="dot" />
      <span className="t">{title}</span>
      {chipText !== undefined && <span className="m">{chipText}</span>}
    </div>
  );
});
