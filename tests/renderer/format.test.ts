import { describe, it, expect } from 'vitest';
import { fmtClock } from '../../src/renderer/lib/format';

describe('fmtClock', () => {
  it('formats under an hour as MM:SS', () => {
    expect(fmtClock(1499)).toBe('24:59');
  });

  it('formats an hour or more as H:MM:SS', () => {
    expect(fmtClock(3840)).toBe('1:04:00');
  });

  it('formats negative (overtime) as +MM:SS, unclamped', () => {
    expect(fmtClock(-134)).toBe('+02:14');
  });

  it('formats zero as 00:00', () => {
    expect(fmtClock(0)).toBe('00:00');
  });
});
