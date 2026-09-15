import { describe, it, expect } from 'vitest';
import { ymd, parseYmd, addDays, dayKeyForRollover, rolloverCutoffMs } from '../../src/core/dates';
describe('dates (local)', () => {
  it('ymd uses the local calendar, not UTC', () => {
    const d = new Date(2026, 8, 20, 0, 30); // 20 Sep local 00:30
    expect(ymd(d.getTime())).toBe('2026-09-20');
  });
  it('parseYmd returns local midnight', () => {
    const d = parseYmd('2026-09-20');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 8, 20, 0]);
  });
  it('addDays crosses month ends and DST', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08'); // US DST start day
  });
  it('day key rolls at 4 AM', () => {
    expect(dayKeyForRollover(new Date(2026, 8, 15, 3, 59).getTime())).toBe('2026-09-14');
    expect(dayKeyForRollover(new Date(2026, 8, 15, 4, 0).getTime())).toBe('2026-09-15');
  });
  // Fix round 1, reviewer point 3: rolloverCutoffMs must resolve the correct local
  // wall-clock instant even when `date` itself is a US DST-change day, since it's
  // built with the local-component Date constructor (like parseYmd) rather than a
  // fixed-offset-from-midnight calculation.
  it('rolloverCutoffMs is DST-safe: matches new Date(y, m-1, d, 4) on a US DST-change date', () => {
    expect(rolloverCutoffMs('2026-03-08')).toBe(new Date(2026, 2, 8, 4).getTime()); // US DST start day
    expect(rolloverCutoffMs('2026-11-01')).toBe(new Date(2026, 10, 1, 4).getTime()); // US DST end day
  });
  it('rolloverCutoffMs agrees with dayKeyForRollover: an instant just before/after it falls on the previous/same day key', () => {
    const cutoff = rolloverCutoffMs('2026-09-15');
    expect(dayKeyForRollover(cutoff - 1)).toBe('2026-09-14');
    expect(dayKeyForRollover(cutoff)).toBe('2026-09-15');
  });
});
