// renderer/strip/Pill — the collapsed strip: title only, max 240 px, timer replaces
// the tail when running (DESIGN.md "The strip (pixel spec)": "Collapsed pill: 24 tall,
// title only, max 240 wide, timer replaces the tail when running").
import { forwardRef } from 'react';
import { fmtClock } from '../../core/timer';
import type { DisplayTime } from '../lib/useDisplayTime';

export const Pill = forwardRef<HTMLDivElement, { title: string; display: DisplayTime }>(function Pill(
  { title, display },
  ref
) {
  const showTimer = display.mode !== 'none';
  return (
    <div ref={ref} className="pill">
      <span className="dot" />
      <span className="t">{title}</span>
      {showTimer && <span className="m">{fmtClock(display.seconds)}</span>}
    </div>
  );
});
