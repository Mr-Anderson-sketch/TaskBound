import { describe, it, expect } from 'vitest';
import { longDayLabel } from '../../src/renderer/lib/dateLabels';

// Tue 15 Sep 2026, local midnight-ish — same calendar date regardless of the two time
// zones `npm test` runs under (America/New_York, Asia/Kolkata), since it's built from
// local Date components, not a fixed UTC instant.
const sep15 = new Date(2026, 8, 15, 10, 0).getTime();

describe('longDayLabel (Task 4.1 fix round 1, item 2)', () => {
  it('en-US: weekday, day, month — no comma, no year (day-first, not the US default order)', () => {
    expect(longDayLabel(sep15, 'en-US')).toBe('Tuesday 15 September');
  });

  it('en-GB: same day-first order (en-GB already formats this way by default)', () => {
    expect(longDayLabel(sep15, 'en-GB')).toBe('Tuesday 15 September');
  });

  it('single-digit day has no leading zero', () => {
    const sep5 = new Date(2026, 8, 5, 10, 0).getTime();
    expect(longDayLabel(sep5, 'en-US')).toBe('Saturday 5 September');
  });
});
