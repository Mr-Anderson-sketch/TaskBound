// tests/main/clock — Task 2.3 addendum ruling 9: fake, injectable powerMonitor and
// setTimer/clearTimer (no real timers, no Electron) so this is fast and deterministic.
import { describe, it, expect, vi } from 'vitest';
import type { PowerMonitor } from 'electron';
import { Clock } from '../../src/main/clock';
import { Store } from '../../src/main/store';
import { createEmptyData } from '../../src/core/defaults';
import { dayKeyForRollover } from '../../src/core/dates';

function makeStore(now: () => number): Store {
  return new Store(createEmptyData(now(), '2.0.0'), {
    save: vi.fn(async () => {}),
    now,
    appVersion: '2.0.0',
    platform: 'win32',
    systemDark: () => false
  });
}

type FakePowerMonitor = Pick<PowerMonitor, 'on' | 'removeListener'> & {
  emit: (event: string) => void;
  listenerCount: (event: string) => number;
};

function makeFakePowerMonitor(): FakePowerMonitor {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const pm: FakePowerMonitor = {
    on: ((event: string, cb: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(cb);
      return pm as unknown as PowerMonitor;
    }) as PowerMonitor['on'],
    removeListener: ((event: string, cb: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(cb);
      return pm as unknown as PowerMonitor;
    }) as PowerMonitor['removeListener'],
    emit: (event: string) => {
      for (const cb of [...(listeners.get(event) ?? [])]) cb();
    },
    listenerCount: (event: string) => listeners.get(event)?.size ?? 0
  };
  return pm;
}

/** A fake scheduler standing in for `setTimeout`/`clearTimeout`: records the single
 * pending timer's delay, and `fireOnly()` invokes it (asserting there really is
 * exactly one pending — Clock must never leave two timers armed at once). */
function makeFakeScheduler() {
  let nextId = 1;
  const active = new Map<number, { fn: () => void; ms: number }>();
  return {
    setTimer: (fn: () => void, ms: number): unknown => {
      const id = nextId++;
      active.set(id, { fn, ms });
      return id;
    },
    clearTimer: (h: unknown): void => {
      active.delete(h as number);
    },
    fireOnly: (): void => {
      expect(active.size).toBe(1);
      const [id, entry] = [...active.entries()][0];
      active.delete(id);
      entry.fn();
    },
    pendingDelay: (): number | undefined => [...active.values()][0]?.ms,
    size: (): number => active.size
  };
}

describe('Clock', () => {
  it('dispatches day/rollover immediately on start() (idempotent per the reducer)', () => {
    const now = new Date(2026, 8, 15, 10, 0, 0).getTime();
    const store = makeStore(() => now);
    const pm = makeFakePowerMonitor();
    const sched = makeFakeScheduler();
    const clock = new Clock({ store, powerMonitor: pm, now: () => now, setTimer: sched.setTimer, clearTimer: sched.clearTimer });

    clock.start();

    const key = dayKeyForRollover(now);
    expect(store.get().data.days.find((d) => d.date === key)?.rolloverAppliedAt).toBe(now);
  });

  it('arms exactly one timer for the delay until the next local 04:00', () => {
    const now = new Date(2026, 8, 15, 10, 0, 0).getTime(); // next 04:00 is 16 Sep 04:00
    const store = makeStore(() => now);
    const pm = makeFakePowerMonitor();
    const sched = makeFakeScheduler();
    const clock = new Clock({ store, powerMonitor: pm, now: () => now, setTimer: sched.setTimer, clearTimer: sched.clearTimer });

    clock.start();

    expect(sched.size()).toBe(1);
    expect(sched.pendingDelay()).toBe(new Date(2026, 8, 16, 4, 0, 0).getTime() - now);
  });

  it('before 04:00, the next 04:00 is the SAME calendar day', () => {
    const now = new Date(2026, 8, 15, 3, 0, 0).getTime();
    const store = makeStore(() => now);
    const pm = makeFakePowerMonitor();
    const sched = makeFakeScheduler();
    const clock = new Clock({ store, powerMonitor: pm, now: () => now, setTimer: sched.setTimer, clearTimer: sched.clearTimer });

    clock.start();

    expect(sched.pendingDelay()).toBe(new Date(2026, 8, 15, 4, 0, 0).getTime() - now);
  });

  it('firing the armed timer re-dispatches rollover for the new day key and re-arms exactly one new timer', () => {
    let now = new Date(2026, 8, 15, 3, 0, 0).getTime();
    const store = makeStore(() => now);
    const pm = makeFakePowerMonitor();
    const sched = makeFakeScheduler();
    const clock = new Clock({ store, powerMonitor: pm, now: () => now, setTimer: sched.setTimer, clearTimer: sched.clearTimer });

    clock.start();
    const beforeKey = dayKeyForRollover(now);

    now = new Date(2026, 8, 15, 4, 0, 0).getTime(); // simulate the clock reaching 04:00
    sched.fireOnly();

    const afterKey = dayKeyForRollover(now);
    expect(afterKey).not.toBe(beforeKey);
    expect(store.get().data.days.find((d) => d.date === afterKey)?.rolloverAppliedAt).toBe(now);
    expect(sched.size()).toBe(1); // re-armed for the FOLLOWING 04:00, not left un-armed
  });

  it('resume re-dispatches rollover for the current day and re-arms (clearing the stale timer)', () => {
    let now = new Date(2026, 8, 15, 10, 0, 0).getTime();
    const store = makeStore(() => now);
    const pm = makeFakePowerMonitor();
    const sched = makeFakeScheduler();
    const clock = new Clock({ store, powerMonitor: pm, now: () => now, setTimer: sched.setTimer, clearTimer: sched.clearTimer });

    clock.start();
    expect(sched.size()).toBe(1);

    now = new Date(2026, 8, 16, 9, 0, 0).getTime(); // laptop was asleep through the 04:00 boundary
    pm.emit('resume');

    const key = dayKeyForRollover(now);
    expect(store.get().data.days.find((d) => d.date === key)?.rolloverAppliedAt).toBe(now);
    expect(sched.size()).toBe(1); // the stale pre-sleep timer was cleared, not left dangling
  });

  it('unlock-screen also re-dispatches rollover and re-arms', () => {
    let now = new Date(2026, 8, 15, 10, 0, 0).getTime();
    const store = makeStore(() => now);
    const pm = makeFakePowerMonitor();
    const sched = makeFakeScheduler();
    const clock = new Clock({ store, powerMonitor: pm, now: () => now, setTimer: sched.setTimer, clearTimer: sched.clearTimer });

    clock.start();
    now = new Date(2026, 8, 16, 9, 0, 0).getTime(); // a day later, screen was locked overnight
    pm.emit('unlock-screen');

    expect(sched.size()).toBe(1);
    const key = dayKeyForRollover(now);
    expect(store.get().data.days.find((d) => d.date === key)?.rolloverAppliedAt).toBe(now);
  });

  // Fix round 1, reviewer Critical 1: `start()` must be safe to call again — it
  // re-dispatches rollover for the current key and re-arms (clearing the old timer),
  // but must NOT register the powerMonitor listeners a second time.
  it('a second start() call re-dispatches rollover and re-arms exactly one timer, without registering power-monitor listeners twice', () => {
    const now = new Date(2026, 8, 15, 10, 0, 0).getTime();
    const store = makeStore(() => now);
    const pm = makeFakePowerMonitor();
    const sched = makeFakeScheduler();
    const clock = new Clock({ store, powerMonitor: pm, now: () => now, setTimer: sched.setTimer, clearTimer: sched.clearTimer });

    const dispatchSpy = vi.spyOn(store, 'dispatch');

    clock.start();
    clock.start();

    const rolloverCalls = dispatchSpy.mock.calls.filter(([action]) => (action as { type: string }).type === 'day/rollover');
    expect(rolloverCalls).toHaveLength(2);
    expect(sched.size()).toBe(1); // exactly one pending timer — the first was cleared, not leaked
    expect(pm.listenerCount('resume')).toBe(1);
    expect(pm.listenerCount('unlock-screen')).toBe(1);
  });

  // Fix round 1, reviewer point 4: the delay computed via the shared, DST-safe
  // `rolloverCutoffMs` (core/dates.ts) must land on the correct local 04:00 even when
  // `now` itself falls on a US DST-change date. The expected value is computed with
  // the SAME `new Date(y, m, d, h)` constructor production code uses, so this is
  // correct under both of `npm test`'s time zones regardless of which (if either)
  // actually observes a real offset change on this date.
  it('DST: the delay armed for 2026-11-01 01:30 local (a US DST-change date) targets local 04:00 that same day', () => {
    const now = new Date(2026, 10, 1, 1, 30, 0).getTime(); // Nov 1 2026, 01:30 local
    const store = makeStore(() => now);
    const pm = makeFakePowerMonitor();
    const sched = makeFakeScheduler();
    const clock = new Clock({ store, powerMonitor: pm, now: () => now, setTimer: sched.setTimer, clearTimer: sched.clearTimer });

    clock.start();

    const expectedTarget = new Date(2026, 10, 1, 4, 0).getTime();
    expect(sched.pendingDelay()).toBe(expectedTarget - now);
  });

  it('stop() clears the pending timer and removes both power-monitor listeners', () => {
    const now = new Date(2026, 8, 15, 10, 0, 0).getTime();
    const store = makeStore(() => now);
    const pm = makeFakePowerMonitor();
    const sched = makeFakeScheduler();
    const clock = new Clock({ store, powerMonitor: pm, now: () => now, setTimer: sched.setTimer, clearTimer: sched.clearTimer });

    clock.start();
    expect(pm.listenerCount('resume')).toBe(1);
    expect(pm.listenerCount('unlock-screen')).toBe(1);

    clock.stop();

    expect(sched.size()).toBe(0);
    expect(pm.listenerCount('resume')).toBe(0);
    expect(pm.listenerCount('unlock-screen')).toBe(0);

    // A resume signal after stop() must do nothing further (listener really removed).
    const revBefore = store.get().rev;
    pm.emit('resume');
    expect(store.get().rev).toBe(revBefore);
  });
});
