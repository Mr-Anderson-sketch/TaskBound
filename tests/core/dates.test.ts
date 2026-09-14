import { describe, it, expect } from 'vitest';
import { ymd, parseYmd, addDays, dayKeyForRollover } from '../../src/core/dates';
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
});
