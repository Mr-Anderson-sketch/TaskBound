// tests/core/timer — pure timer math (Task 3.1). Covers every case in the brief plus
// the controller's additional rulings: clock moved backwards, expiry in the past,
// sleep gap over/under threshold and not-running, and the full fmtClock table
// (moved here from the deleted tests/renderer/format.test.ts).
import { describe, it, expect } from 'vitest';
import { elapsedSeconds, remainingSeconds, expiryAt, applySleepGap, fmtClock } from '../../src/core/timer';
import type { TaskTimer } from '../../src/core/types';

const t0 = 1_700_000_000_000;

describe('elapsedSeconds', () => {
  it('is spentSeconds alone when not running', () => {
    const t: TaskTimer = { spentSeconds: 90 };
    expect(elapsedSeconds(t, t0)).toBe(90);
  });

  it('adds the floored live segment while running', () => {
    const t: TaskTimer = { spentSeconds: 10, runningSince: t0 };
    expect(elapsedSeconds(t, t0 + 12_500)).toBe(22); // floor(12.5) = 12
  });

  it('clamps to spentSeconds when the clock has moved backwards (now < runningSince)', () => {
    const t: TaskTimer = { spentSeconds: 10, runningSince: t0 };
    expect(elapsedSeconds(t, t0 - 5_000)).toBe(10);
  });
});

describe('remainingSeconds', () => {
  it('is undefined when there is no plan', () => {
    const t: TaskTimer = { spentSeconds: 10 };
    expect(remainingSeconds(t, t0)).toBeUndefined();
  });

  it('is planned minus elapsed, may be negative (overtime)', () => {
    const t: TaskTimer = { plannedSeconds: 60, spentSeconds: 0, runningSince: t0 };
    expect(remainingSeconds(t, t0 + 30_000)).toBe(30);
    expect(remainingSeconds(t, t0 + 90_000)).toBe(-30);
  });
});

describe('expiryAt', () => {
  it('is undefined when not running', () => {
    const t: TaskTimer = { plannedSeconds: 60, spentSeconds: 0 };
    expect(expiryAt(t)).toBeUndefined();
  });

  it('is undefined when there is no plan', () => {
    const t: TaskTimer = { spentSeconds: 0, runningSince: t0 };
    expect(expiryAt(t)).toBeUndefined();
  });

  it('is runningSince + (planned - spent) * 1000', () => {
    const t: TaskTimer = { plannedSeconds: 60, spentSeconds: 10, runningSince: t0 };
    expect(expiryAt(t)).toBe(t0 + 50_000);
  });

  it('may be in the past when the plan already expired', () => {
    const t: TaskTimer = { plannedSeconds: 60, spentSeconds: 90, runningSince: t0 };
    expect(expiryAt(t)).toBe(t0 - 30_000);
  });
});

describe('applySleepGap', () => {
  const thresholdMs = 5 * 60_000;

  it('returns the same reference when not running', () => {
    const t: TaskTimer = { spentSeconds: 10 };
    expect(applySleepGap(t, t0, t0 + thresholdMs + 1, thresholdMs)).toBe(t);
  });

  it('returns the same reference when the gap is at or under the threshold', () => {
    const t: TaskTimer = { spentSeconds: 10, runningSince: t0 };
    expect(applySleepGap(t, t0 + 1000, t0 + 1000 + thresholdMs, thresholdMs)).toBe(t);
  });

  it('pauses at the suspend instant when the gap exceeds the threshold', () => {
    const t: TaskTimer = { spentSeconds: 10, runningSince: t0 };
    const suspendedAt = t0 + 20_000;
    const resumedAt = suspendedAt + thresholdMs + 1;
    const result = applySleepGap(t, suspendedAt, resumedAt, thresholdMs);
    expect(result).toEqual({ spentSeconds: 30, runningSince: undefined, pausedAtSuspend: suspendedAt });
  });

  it('folds 0 and still pauses when suspendedAt is before runningSince (clamped)', () => {
    const t: TaskTimer = { spentSeconds: 10, runningSince: t0 };
    const suspendedAt = t0 - 5_000;
    const resumedAt = t0 + thresholdMs + 1;
    const result = applySleepGap(t, suspendedAt, resumedAt, thresholdMs);
    expect(result).toEqual({ spentSeconds: 10, runningSince: undefined, pausedAtSuspend: suspendedAt });
  });
});

describe('fmtClock', () => {
  it('formats under an hour as MM:SS', () => {
    expect(fmtClock(1499)).toBe('24:59');
  });

  it('formats an hour or more as H:MM:SS (hours unpadded)', () => {
    expect(fmtClock(3840)).toBe('1:04:00');
  });

  it('formats zero as 00:00', () => {
    expect(fmtClock(0)).toBe('00:00');
  });

  it('formats negative (overtime) under an hour as +MM:SS, unclamped', () => {
    expect(fmtClock(-134)).toBe('+02:14');
  });

  it('formats negative (overtime) an hour or more as +H:MM:SS', () => {
    expect(fmtClock(-3605)).toBe('+1:00:05');
  });

  it('floors non-integer input toward zero first', () => {
    expect(fmtClock(1499.9)).toBe('24:59');
    expect(fmtClock(-134.9)).toBe('+02:14');
  });
});
