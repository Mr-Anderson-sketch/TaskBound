// tests/main/trayTitle — Task 6.1: macOS menu bar mode title composition and its
// 1 Hz throttled updater. Both halves are pure/Electron-free (see
// src/main/trayTitle.ts's header comment), so this runs under the same plain
// 'node' Vitest environment as every other unit test — no Electron needed.
import { describe, expect, it, vi } from 'vitest';
import { composeTrayTitle, DEFAULT_MAX_TITLE_LENGTH, truncateTitle, TrayTitleUpdater } from '../../src/main/trayTitle';
import type { TrayTitleState } from '../../src/main/trayTitle';

describe('truncateTitle', () => {
  it('returns titles at or under the max length unchanged', () => {
    expect(truncateTitle('Write the report', 28)).toBe('Write the report');
    expect(truncateTitle('', 28)).toBe('');
  });

  it('truncates and appends a single ellipsis, never exceeding maxLength', () => {
    const long = 'Draft the quarterly board deck and send it around';
    const result = truncateTitle(long, 28);
    expect(result.length).toBe(28);
    expect(result.endsWith('…')).toBe(true);
    expect(result).toBe('Draft the quarterly board d…');
  });

  it('defaults to 28 when maxLength is omitted', () => {
    const long = 'x'.repeat(40);
    expect(truncateTitle(long).length).toBe(DEFAULT_MAX_TITLE_LENGTH);
  });

  it('handles degenerate maxLength values', () => {
    expect(truncateTitle('anything', 0)).toBe('');
    expect(truncateTitle('anything', -5)).toBe('');
    expect(truncateTitle('anything', 1)).toBe('…');
  });

  it('does not truncate a title exactly at the boundary', () => {
    const exact = 'x'.repeat(28);
    expect(truncateTitle(exact, 28)).toBe(exact);
    const overByOne = 'x'.repeat(29);
    expect(truncateTitle(overByOne, 28)).toBe('x'.repeat(27) + '…');
  });
});

describe('composeTrayTitle', () => {
  it('returns empty string when there is no current title', () => {
    const state: TrayTitleState = { currentTitle: undefined, timer: undefined };
    expect(composeTrayTitle(state, 1_000)).toBe('');
  });

  it('returns just the truncated title when there is no timer', () => {
    const state: TrayTitleState = { currentTitle: 'Write the report', timer: undefined };
    expect(composeTrayTitle(state, 1_000)).toBe('Write the report');
  });

  it('returns just the truncated title when the timer is not running', () => {
    const state: TrayTitleState = { currentTitle: 'Write the report', timer: { spentSeconds: 90 } };
    expect(composeTrayTitle(state, 1_000)).toBe('Write the report');
  });

  it('appends the remaining time (two spaces) for a running planned timer', () => {
    const now = 1_000_000;
    const state: TrayTitleState = {
      currentTitle: 'Write the report',
      timer: { plannedSeconds: 600, spentSeconds: 0, runningSince: now - 65_000 }
    };
    // elapsed 65s -> remaining 535s -> 8:55
    expect(composeTrayTitle(state, now)).toBe('Write the report  08:55');
  });

  it('appends elapsed time for a running unplanned timer', () => {
    const now = 1_000_000;
    const state: TrayTitleState = {
      currentTitle: 'Write the report',
      timer: { spentSeconds: 0, runningSince: now - 90_000 }
    };
    expect(composeTrayTitle(state, now)).toBe('Write the report  01:30');
  });

  it('shows overtime with a + prefix past a planned timer expiry', () => {
    const now = 1_000_000;
    const state: TrayTitleState = {
      currentTitle: 'Write the report',
      timer: { plannedSeconds: 60, spentSeconds: 0, runningSince: now - 90_000 }
    };
    expect(composeTrayTitle(state, now)).toBe('Write the report  +00:30');
  });

  it('truncates the title before appending the clock', () => {
    const now = 1_000_000;
    const long = 'Draft the quarterly board deck and send it around';
    const state: TrayTitleState = { currentTitle: long, timer: { spentSeconds: 0, runningSince: now - 5_000 } };
    expect(composeTrayTitle(state, now, 10)).toBe('Draft the…  00:05');
  });
});

describe('TrayTitleUpdater', () => {
  it('emits immediately on sync(), even with no running timer', () => {
    const onUpdate = vi.fn();
    const state: TrayTitleState = { currentTitle: 'Write the report', timer: undefined };
    const updater = new TrayTitleUpdater(
      () => state,
      () => 0,
      onUpdate
    );
    updater.sync();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith('Write the report');
  });

  it('does not start an interval while the timer is not running', () => {
    vi.useFakeTimers();
    try {
      const onUpdate = vi.fn();
      const state: TrayTitleState = { currentTitle: 'Write the report', timer: undefined };
      const updater = new TrayTitleUpdater(
        () => state,
        () => 0,
        onUpdate
      );
      updater.sync();
      onUpdate.mockClear();
      vi.advanceTimersByTime(5_000);
      expect(onUpdate).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ticks at most once per second while the timer runs, and stops the instant it does not', () => {
    vi.useFakeTimers();
    try {
      let now = 1_000_000;
      let running = true;
      const onUpdate = vi.fn();
      const updater = new TrayTitleUpdater(
        (): TrayTitleState => ({
          currentTitle: 'Write the report',
          timer: running ? { spentSeconds: 0, runningSince: 1_000_000 } : { spentSeconds: 5, runningSince: undefined }
        }),
        () => now,
        onUpdate
      );

      updater.sync(); // starts the interval (running === true)
      expect(onUpdate).toHaveBeenCalledTimes(1);

      now += 1_000;
      vi.advanceTimersByTime(1_000);
      expect(onUpdate).toHaveBeenCalledTimes(2);
      expect(onUpdate).toHaveBeenLastCalledWith('Write the report  00:01');

      now += 1_000;
      vi.advanceTimersByTime(1_000);
      expect(onUpdate).toHaveBeenCalledTimes(3);

      // Advancing less than a second must not tick again (throttled to 1 Hz).
      vi.advanceTimersByTime(400);
      expect(onUpdate).toHaveBeenCalledTimes(3);

      // Timer stops running: the next sync() must emit once (the new state) and
      // disarm the interval — no further ticks even as time passes.
      running = false;
      onUpdate.mockClear();
      updater.sync();
      expect(onUpdate).toHaveBeenCalledTimes(1);
      expect(onUpdate).toHaveBeenLastCalledWith('Write the report');

      onUpdate.mockClear();
      vi.advanceTimersByTime(5_000);
      expect(onUpdate).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('restarts the interval if the timer starts running again after stopping', () => {
    vi.useFakeTimers();
    try {
      let running = false;
      const onUpdate = vi.fn();
      const updater = new TrayTitleUpdater(
        (): TrayTitleState => ({
          currentTitle: 'Write the report',
          timer: { spentSeconds: 0, runningSince: running ? 0 : undefined }
        }),
        () => 0,
        onUpdate
      );

      updater.sync(); // not running: no interval
      onUpdate.mockClear();

      running = true;
      updater.sync(); // now running: (re)starts the interval
      onUpdate.mockClear();
      vi.advanceTimersByTime(1_000);
      expect(onUpdate).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stop() disarms the interval without emitting', () => {
    vi.useFakeTimers();
    try {
      const onUpdate = vi.fn();
      const updater = new TrayTitleUpdater(
        (): TrayTitleState => ({ currentTitle: 'Write the report', timer: { spentSeconds: 0, runningSince: 0 } }),
        () => 0,
        onUpdate
      );
      updater.sync();
      onUpdate.mockClear();
      updater.stop();
      vi.advanceTimersByTime(5_000);
      expect(onUpdate).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
