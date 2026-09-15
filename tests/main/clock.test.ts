// tests/main/clock — Task 2.3 addendum ruling 9 (rollover) and Task 3.2 addendum
// ruling 9 (expiry/pomodoro/suspend/idle): fake, injectable powerMonitor and
// setTimer/clearTimer (no real timers, no Electron) so this is fast and
// deterministic. Uses the real Store/reducer (dispatching real actions) rather than
// a hand-rolled fake store — it's the only way to get a genuinely running,
// planned/unplanned timer without duplicating core/timer's math.
import { describe, it, expect, vi } from 'vitest';
import type { PowerMonitor } from 'electron';
import { Clock, resolveToggleTimerAction } from '../../src/main/clock';
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

type FakePowerMonitor = Pick<PowerMonitor, 'on' | 'removeListener' | 'getSystemIdleTime'> & {
  emit: (event: string) => void;
  listenerCount: (event: string) => number;
  setIdleSeconds: (n: number) => void;
};

function makeFakePowerMonitor(): FakePowerMonitor {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  let idleSeconds = 0;
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
    getSystemIdleTime: (() => idleSeconds) as PowerMonitor['getSystemIdleTime'],
    emit: (event: string) => {
      for (const cb of [...(listeners.get(event) ?? [])]) cb();
    },
    listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
    setIdleSeconds: (n: number) => {
      idleSeconds = n;
    }
  };
  return pm;
}

/** A fake scheduler standing in for `setTimeout`/`clearTimeout`: records every
 * pending timer's delay. `fireOnly()` invokes the single pending timer (asserting
 * there really is exactly one). `fireDelay(ms)` invokes whichever pending timer was
 * armed with exactly that delay (asserting there's exactly one such timer) — used
 * once several timers (rollover/expiry/idle/break) can be pending at once. */
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
    fireDelay: (ms: number): void => {
      const matches = [...active.entries()].filter(([, e]) => e.ms === ms);
      expect(matches).toHaveLength(1);
      const [id, entry] = matches[0];
      active.delete(id);
      entry.fn();
    },
    pendingDelay: (): number | undefined => [...active.values()][0]?.ms,
    delays: (): number[] => [...active.values()].map((e) => e.ms).sort((a, b) => a - b),
    size: (): number => active.size
  };
}

function makeClockDeps(now: () => number) {
  const store = makeStore(now);
  const pm = makeFakePowerMonitor();
  const sched = makeFakeScheduler();
  const notify = { timerDone: vi.fn(), breakDone: vi.fn() };
  const broadcastBreak = vi.fn();
  const clock = new Clock({
    store,
    powerMonitor: pm,
    now,
    setTimer: sched.setTimer,
    clearTimer: sched.clearTimer,
    notify,
    broadcastBreak
  });
  return { store, pm, sched, notify, broadcastBreak, clock };
}

describe('Clock (rollover — Task 2.3)', () => {
  it('dispatches day/rollover immediately on start() (idempotent per the reducer)', () => {
    const now = new Date(2026, 8, 15, 10, 0, 0).getTime();
    const { store, clock } = makeClockDeps(() => now);

    clock.start();

    const key = dayKeyForRollover(now);
    expect(store.get().data.days.find((d) => d.date === key)?.rolloverAppliedAt).toBe(now);
  });

  it('arms exactly one timer for the delay until the next local 04:00', () => {
    const now = new Date(2026, 8, 15, 10, 0, 0).getTime(); // next 04:00 is 16 Sep 04:00
    const { sched, clock } = makeClockDeps(() => now);

    clock.start();

    expect(sched.size()).toBe(1);
    expect(sched.pendingDelay()).toBe(new Date(2026, 8, 16, 4, 0, 0).getTime() - now);
  });

  it('before 04:00, the next 04:00 is the SAME calendar day', () => {
    const now = new Date(2026, 8, 15, 3, 0, 0).getTime();
    const { sched, clock } = makeClockDeps(() => now);

    clock.start();

    expect(sched.pendingDelay()).toBe(new Date(2026, 8, 15, 4, 0, 0).getTime() - now);
  });

  it('firing the armed timer re-dispatches rollover for the new day key and re-arms exactly one new timer', () => {
    let now = new Date(2026, 8, 15, 3, 0, 0).getTime();
    const { store, sched, clock } = makeClockDeps(() => now);

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
    const { store, pm, sched, clock } = makeClockDeps(() => now);

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
    const { store, pm, sched, clock } = makeClockDeps(() => now);

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
    const { store, pm, sched, clock } = makeClockDeps(() => now);

    const dispatchSpy = vi.spyOn(store, 'dispatch');

    clock.start();
    clock.start();

    const rolloverCalls = dispatchSpy.mock.calls.filter(([action]) => (action as { type: string }).type === 'day/rollover');
    expect(rolloverCalls).toHaveLength(2);
    expect(sched.size()).toBe(1); // exactly one pending timer — the first was cleared, not leaked
    expect(pm.listenerCount('resume')).toBe(1);
    expect(pm.listenerCount('unlock-screen')).toBe(1);
    expect(pm.listenerCount('suspend')).toBe(1);
    expect(pm.listenerCount('lock-screen')).toBe(1);
  });

  // Fix round 1, reviewer point 4: the delay computed via the shared, DST-safe
  // `rolloverCutoffMs` (core/dates.ts) must land on the correct local 04:00 even when
  // `now` itself falls on a US DST-change date. The expected value is computed with
  // the SAME `new Date(y, m, d, h)` constructor production code uses, so this is
  // correct under both of `npm test`'s time zones regardless of which (if either)
  // actually observes a real offset change on this date.
  it('DST: the delay armed for 2026-11-01 01:30 local (a US DST-change date) targets local 04:00 that same day', () => {
    const now = new Date(2026, 10, 1, 1, 30, 0).getTime(); // Nov 1 2026, 01:30 local
    const { sched, clock } = makeClockDeps(() => now);

    clock.start();

    const expectedTarget = new Date(2026, 10, 1, 4, 0).getTime();
    expect(sched.pendingDelay()).toBe(expectedTarget - now);
  });

  it('stop() clears the pending timer and removes both power-monitor listeners', () => {
    const now = new Date(2026, 8, 15, 10, 0, 0).getTime();
    const { store, pm, sched, clock } = makeClockDeps(() => now);

    clock.start();
    expect(pm.listenerCount('resume')).toBe(1);
    expect(pm.listenerCount('unlock-screen')).toBe(1);

    clock.stop();

    expect(sched.size()).toBe(0);
    expect(pm.listenerCount('resume')).toBe(0);
    expect(pm.listenerCount('unlock-screen')).toBe(0);
    expect(pm.listenerCount('suspend')).toBe(0);
    expect(pm.listenerCount('lock-screen')).toBe(0);

    // A resume signal after stop() must do nothing further (listener really removed).
    const revBefore = store.get().rev;
    pm.emit('resume');
    expect(store.get().rev).toBe(revBefore);
  });
});

describe('Clock (timer expiry — Task 3.2)', () => {
  it('arms an expiry timer for an already-running, planned task found on start()', () => {
    const now = new Date(2026, 8, 15, 10, 0, 0).getTime();
    const { store, sched, clock } = makeClockDeps(() => now);
    store.dispatch({ type: 'task/add', id: 'a', now, title: 'Task', today: true, plannedSeconds: 120 });
    store.dispatch({ type: 'timer/start', id: 'a', now });

    clock.start();

    expect(sched.delays()).toContain(120_000);
  });

  it('no expiry timer is armed when nothing is running', () => {
    const now = new Date(2026, 8, 15, 10, 0, 0).getTime();
    const { sched, clock } = makeClockDeps(() => now);

    clock.start();

    // Only the rollover timer.
    expect(sched.size()).toBe(1);
  });

  it('re-arms when plannedSeconds changes on the running task (expiry moves)', () => {
    const now = new Date(2026, 8, 15, 10, 0, 0).getTime();
    const { store, sched, clock } = makeClockDeps(() => now);
    store.dispatch({ type: 'task/add', id: 'a', now, title: 'Task', today: true, plannedSeconds: 120 });
    store.dispatch({ type: 'timer/start', id: 'a', now });
    clock.start();
    expect(sched.delays()).toContain(120_000);

    store.dispatch({ type: 'timer/addTime', id: 'a', now, seconds: 60 });

    expect(sched.delays()).not.toContain(120_000);
    expect(sched.delays()).toContain(180_000);
    // Still exactly one expiry-shaped timer, not a leaked extra.
    expect(sched.delays().filter((d) => d === 180_000)).toHaveLength(1);
  });

  it('expiry calls notify.timerDone exactly once even if further snapshots arrive after it fires', () => {
    const now = new Date(2026, 8, 15, 10, 0, 0).getTime();
    const { store, sched, notify, clock } = makeClockDeps(() => now);
    store.dispatch({ type: 'task/add', id: 'a', now, title: 'Task', today: true, plannedSeconds: 10 });
    store.dispatch({ type: 'timer/start', id: 'a', now });
    clock.start();

    // An unrelated snapshot arrives before expiry: must not re-arm a duplicate timer.
    store.dispatch({ type: 'task/add', id: 'b', now, title: 'Other', today: false });
    expect(sched.delays().filter((d) => d === 10_000)).toHaveLength(1);

    sched.fireDelay(10_000);
    expect(notify.timerDone).toHaveBeenCalledTimes(1);
    expect(notify.timerDone).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));

    // Another unrelated snapshot after expiry: still only ever notified once.
    store.dispatch({ type: 'task/add', id: 'c', now, title: 'Another', today: false });
    expect(notify.timerDone).toHaveBeenCalledTimes(1);
  });

  it('expiry does not dispatch anything when pomodoro is off (the renderer already shows overtime)', () => {
    const now = new Date(2026, 8, 15, 10, 0, 0).getTime();
    const { store, sched, clock } = makeClockDeps(() => now);
    store.dispatch({ type: 'task/add', id: 'a', now, title: 'Task', today: true, plannedSeconds: 10 });
    store.dispatch({ type: 'timer/start', id: 'a', now });
    clock.start();

    sched.fireDelay(10_000);

    expect(store.get().data.tasks.find((t) => t.id === 'a')?.timer?.runningSince).toBe(now);
  });

  // Fix round 1, item 1 last bullet: resuming a task that was ALREADY in overtime
  // when this run started (spentSeconds >= plannedSeconds at the new runningSince)
  // computes an expiry at or before that runningSince — arming it would fire at 0 ms
  // and re-send "Time's up" for overtime the renderer already shows.
  it('does not arm (or re-notify) when a task is resumed already in overtime', () => {
    let now = new Date(2026, 8, 15, 10, 0, 0).getTime();
    const { store, sched, notify, clock } = makeClockDeps(() => now);
    store.dispatch({ type: 'task/add', id: 'a', now, title: 'Task', today: true, plannedSeconds: 5 });
    store.dispatch({ type: 'timer/start', id: 'a', now });
    clock.start();

    sched.fireDelay(5_000); // genuine expiry — notifies once
    expect(notify.timerDone).toHaveBeenCalledTimes(1);

    now += 20_000; // run well past the plan, then pause (still overtime: spent > planned)
    store.dispatch({ type: 'timer/pause', id: 'a', now });
    now += 1_000;
    store.dispatch({ type: 'timer/start', id: 'a', now }); // resume: still overtime at the new runningSince

    // No 0 ms (or any) expiry timer armed for this run, and no second notification.
    expect(sched.delays()).not.toContain(0);
    expect(notify.timerDone).toHaveBeenCalledTimes(1);
  });
});

describe('Clock (pomodoro break — Task 3.2)', () => {
  it('expiry with pomodoro on pauses the task, starts a break, and ends it at breakMinutes', () => {
    const now = new Date(2026, 8, 15, 10, 0, 0).getTime();
    const { store, sched, notify, broadcastBreak, clock } = makeClockDeps(() => now);
    store.dispatch({ type: 'settings/patch', now, patch: { timer: { pomodoro: true, breakMinutes: 1 } } });
    store.dispatch({ type: 'task/add', id: 'a', now, title: 'Task', today: true, plannedSeconds: 5 });
    store.dispatch({ type: 'timer/start', id: 'a', now });
    clock.start();

    sched.fireDelay(5_000);

    expect(notify.timerDone).toHaveBeenCalledTimes(1);
    expect(store.get().data.tasks.find((t) => t.id === 'a')?.timer?.runningSince).toBeUndefined();
    expect(broadcastBreak).toHaveBeenCalledWith({ endsAt: now + 60_000 });

    sched.fireDelay(60_000);

    expect(broadcastBreak).toHaveBeenLastCalledWith(null);
    expect(notify.breakDone).toHaveBeenCalledTimes(1);
  });

  // Fix round 1, item 3 minor.
  it('pomodoro expiry pause folds at the EXPIRY instant, not now (sleep across expiry does not count as focus)', () => {
    let now = new Date(2026, 8, 15, 10, 0, 0).getTime();
    const { store, sched, clock } = makeClockDeps(() => now);
    store.dispatch({ type: 'settings/patch', now, patch: { timer: { pomodoro: true, breakMinutes: 1 } } });
    store.dispatch({ type: 'task/add', id: 'a', now, title: 'Task', today: true, plannedSeconds: 5 });
    store.dispatch({ type: 'timer/start', id: 'a', now });
    clock.start();

    now += 50_000; // simulate the computer sleeping well past the real 5 s expiry
    sched.fireDelay(5_000);

    const task = store.get().data.tasks.find((t) => t.id === 'a');
    expect(task?.timer?.spentSeconds).toBe(5); // exactly the planned session, not 50 s of "sleep focus"
  });

  // Fix round 1, item 3 minor "break replay": main.ts reads this to replay the
  // current break to a window's `did-finish-load`.
  it('getCurrentBreak() reflects the live break state', () => {
    const now = new Date(2026, 8, 15, 10, 0, 0).getTime();
    const { store, sched, clock } = makeClockDeps(() => now);
    store.dispatch({ type: 'settings/patch', now, patch: { timer: { pomodoro: true, breakMinutes: 1 } } });
    store.dispatch({ type: 'task/add', id: 'a', now, title: 'Task', today: true, plannedSeconds: 5 });
    store.dispatch({ type: 'timer/start', id: 'a', now });
    clock.start();
    expect(clock.getCurrentBreak()).toBeNull();

    sched.fireDelay(5_000);
    expect(clock.getCurrentBreak()).toEqual({ endsAt: now + 60_000 });

    sched.fireDelay(60_000);
    expect(clock.getCurrentBreak()).toBeNull();
  });

  it('starting a task cancels an in-progress break', () => {
    const now = new Date(2026, 8, 15, 10, 0, 0).getTime();
    const { store, sched, broadcastBreak, clock } = makeClockDeps(() => now);
    // breakMinutes: 2 (120_000 ms) so the break timer's delay is distinguishable from
    // the 60_000 ms idle-check interval that (re-)arms once task 'b' starts running.
    store.dispatch({ type: 'settings/patch', now, patch: { timer: { pomodoro: true, breakMinutes: 2 } } });
    store.dispatch({ type: 'task/add', id: 'a', now, title: 'Task', today: true, plannedSeconds: 5 });
    store.dispatch({ type: 'timer/start', id: 'a', now });
    clock.start();
    sched.fireDelay(5_000);
    expect(broadcastBreak).toHaveBeenCalledWith({ endsAt: now + 120_000 });
    expect(sched.delays()).toContain(120_000);

    store.dispatch({ type: 'task/add', id: 'b', now, title: 'Other', today: true });
    store.dispatch({ type: 'timer/start', id: 'b', now });

    expect(broadcastBreak).toHaveBeenLastCalledWith(null);
    // The break timer itself must be gone too (not just the broadcast).
    expect(sched.delays()).not.toContain(120_000);
  });
});

describe('Clock (suspend/lock -> resume/unlock away threshold — Task 3.2)', () => {
  it('a suspend gap over the away threshold pauses the running task at the suspend instant', () => {
    let now = new Date(2026, 8, 15, 10, 0, 0).getTime();
    const { store, pm, clock } = makeClockDeps(() => now);
    store.dispatch({ type: 'settings/patch', now, patch: { timer: { awayThresholdMinutes: 5 } } });
    store.dispatch({ type: 'task/add', id: 'a', now, title: 'Task', today: true });
    store.dispatch({ type: 'timer/start', id: 'a', now });
    clock.start();

    pm.emit('suspend');
    now += 10 * 60_000; // 10 minutes later, over the 5-minute threshold
    pm.emit('resume');

    const task = store.get().data.tasks.find((t) => t.id === 'a');
    expect(task?.timer?.runningSince).toBeUndefined();
    // Folded at the SUSPEND instant, not the resume instant: 0 seconds elapsed
    // between starting the timer and suspending, even though 10 minutes of real
    // time passed before resume.
    expect(task?.timer?.spentSeconds).toBe(0);
  });

  it('a suspend gap AT or under the away threshold leaves the task running', () => {
    let now = new Date(2026, 8, 15, 10, 0, 0).getTime();
    const { store, pm, clock } = makeClockDeps(() => now);
    store.dispatch({ type: 'settings/patch', now, patch: { timer: { awayThresholdMinutes: 5 } } });
    store.dispatch({ type: 'task/add', id: 'a', now, title: 'Task', today: true });
    store.dispatch({ type: 'timer/start', id: 'a', now });
    clock.start();

    pm.emit('suspend');
    now += 2 * 60_000; // 2 minutes, under the 5-minute threshold
    pm.emit('resume');

    const task = store.get().data.tasks.find((t) => t.id === 'a');
    expect(task?.timer?.runningSince).toBeDefined();
  });

  it('lock-screen/unlock-screen behave the same as suspend/resume', () => {
    let now = new Date(2026, 8, 15, 10, 0, 0).getTime();
    const { store, pm, clock } = makeClockDeps(() => now);
    store.dispatch({ type: 'settings/patch', now, patch: { timer: { awayThresholdMinutes: 5 } } });
    store.dispatch({ type: 'task/add', id: 'a', now, title: 'Task', today: true });
    store.dispatch({ type: 'timer/start', id: 'a', now });
    clock.start();

    pm.emit('lock-screen');
    now += 10 * 60_000;
    pm.emit('unlock-screen');

    const task = store.get().data.tasks.find((t) => t.id === 'a');
    expect(task?.timer?.runningSince).toBeUndefined();
  });

  it('a suspend with nothing running is a no-op on resume', () => {
    let now = new Date(2026, 8, 15, 10, 0, 0).getTime();
    const { store, pm, clock } = makeClockDeps(() => now);
    clock.start();
    const revBefore = store.get().rev;

    pm.emit('suspend');
    now += 30 * 60_000;
    pm.emit('resume');

    // Only rollover re-dispatch bumps rev here (a no-op dispatch doesn't bump it at
    // all) — no timer/pause was possible with no running task.
    expect(store.get().rev).toBe(revBefore);
  });

  // Fix round 1 minor: `suspend` and `lock-screen` can both fire around the same real
  // sleep/lock event; the EARLIEST instant must win, not whichever fires last.
  it('keeps the EARLIEST suspend/lock instant when both fire before resume: lock at T, sleep at T+10min, resume at T+20min -> pause at T', () => {
    const T = new Date(2026, 8, 15, 10, 0, 0).getTime();
    let now = T;
    const { store, pm, clock } = makeClockDeps(() => now);
    store.dispatch({ type: 'settings/patch', now, patch: { timer: { awayThresholdMinutes: 5 } } });
    store.dispatch({ type: 'task/add', id: 'a', now, title: 'Task', today: true });
    store.dispatch({ type: 'timer/start', id: 'a', now });
    clock.start();
    const dispatchSpy = vi.spyOn(store, 'dispatch');

    pm.emit('lock-screen'); // T
    now = T + 10 * 60_000;
    pm.emit('suspend'); // T+10min — must NOT overwrite the earlier lock-screen instant
    now = T + 20 * 60_000;
    pm.emit('resume');

    const pauseCall = dispatchSpy.mock.calls.find(([a]) => (a as { type: string }).type === 'timer/pause');
    expect(pauseCall?.[0]).toMatchObject({ type: 'timer/pause', id: 'a', at: T });
  });
});

describe('Clock (idle pause — Task 3.2)', () => {
  it('pauses the running task once system idle time reaches idlePauseMinutes, folding at now - idle', () => {
    let now = new Date(2026, 8, 15, 10, 0, 0).getTime();
    const { store, pm, sched, clock } = makeClockDeps(() => now);
    store.dispatch({ type: 'settings/patch', now, patch: { timer: { idlePauseMinutes: 5 } } });
    store.dispatch({ type: 'task/add', id: 'a', now, title: 'Task', today: true });
    store.dispatch({ type: 'timer/start', id: 'a', now });
    clock.start();
    expect(sched.delays()).toContain(60_000);

    pm.setIdleSeconds(5 * 60);
    now += 60_000;
    sched.fireDelay(60_000);

    const task = store.get().data.tasks.find((t) => t.id === 'a');
    expect(task?.timer?.runningSince).toBeUndefined();
  });

  it('idlePauseMinutes of 0 disables the pause (interval keeps running)', () => {
    let now = new Date(2026, 8, 15, 10, 0, 0).getTime();
    const { store, pm, sched, clock } = makeClockDeps(() => now);
    store.dispatch({ type: 'settings/patch', now, patch: { timer: { idlePauseMinutes: 0 } } });
    store.dispatch({ type: 'task/add', id: 'a', now, title: 'Task', today: true });
    store.dispatch({ type: 'timer/start', id: 'a', now });
    clock.start();

    pm.setIdleSeconds(10_000); // absurdly idle — must still not pause when disabled
    now += 60_000;
    sched.fireDelay(60_000);

    const task = store.get().data.tasks.find((t) => t.id === 'a');
    expect(task?.timer?.runningSince).toBeDefined();
    // The interval keeps going rather than stopping outright.
    expect(sched.delays()).toContain(60_000);
  });

  it('the idle-check interval stops once nothing is running', () => {
    const now = new Date(2026, 8, 15, 10, 0, 0).getTime();
    const { store, sched, clock } = makeClockDeps(() => now);
    store.dispatch({ type: 'task/add', id: 'a', now, title: 'Task', today: true });
    store.dispatch({ type: 'timer/start', id: 'a', now });
    clock.start();
    expect(sched.delays()).toContain(60_000);

    store.dispatch({ type: 'timer/pause', id: 'a', now });

    expect(sched.delays()).not.toContain(60_000);
  });

  it('the idle-check interval never starts when nothing is running', () => {
    const now = new Date(2026, 8, 15, 10, 0, 0).getTime();
    const { sched, clock } = makeClockDeps(() => now);

    clock.start();

    expect(sched.size()).toBe(1); // rollover only
  });
});

describe('Clock (pomodoro back-to-back sessions — Task 3.2 fix round 1, item 3)', () => {
  it('session 2, toggled right after session 1 pauses+breaks, runs a FULL workMinutes and does not fire at 0 ms', () => {
    let now = new Date(2026, 8, 15, 10, 0, 0).getTime();
    const { store, sched, notify, broadcastBreak, clock } = makeClockDeps(() => now);
    // workMinutes/breakMinutes deliberately != 1 minute so their delays (120_000,
    // 180_000) never collide with the fixed 60_000 ms idle-check interval.
    store.dispatch({ type: 'settings/patch', now, patch: { timer: { pomodoro: true, workMinutes: 2, breakMinutes: 3 } } });
    store.dispatch({ type: 'task/add', id: 'a', now, title: 'Task', today: true });
    clock.start();

    // toggleTimer #1 (nothing running, pomodoro on) -> a full 120 s session, via the
    // SAME decision function main.ts's toggleTimer calls.
    let action = resolveToggleTimerAction(store.get().today.current, store.get().data.settings, now)!;
    expect(action).toMatchObject({ type: 'timer/startSession', id: 'a', seconds: 120 });
    store.dispatch(action);
    expect(sched.delays()).toContain(120_000);

    now += 120_000;
    sched.fireDelay(120_000); // session 1 expires -> pause + break starts
    expect(notify.timerDone).toHaveBeenCalledTimes(1);
    expect(store.get().data.tasks.find((t) => t.id === 'a')?.timer?.spentSeconds).toBe(120);
    expect(broadcastBreak).toHaveBeenCalledWith({ endsAt: now + 180_000 });

    now += 180_000;
    sched.fireDelay(180_000); // break ends
    expect(notify.breakDone).toHaveBeenCalledTimes(1);

    // toggleTimer #2, right away: must be a FULL new 120 s session, not 0 ms — the
    // defect this fix round supersedes ruling 3 to close.
    action = resolveToggleTimerAction(store.get().today.current, store.get().data.settings, now)!;
    expect(action).toMatchObject({ type: 'timer/startSession', id: 'a', seconds: 120 });
    store.dispatch(action);

    expect(sched.delays()).not.toContain(0);
    expect(sched.delays()).toContain(120_000);
    const a = store.get().data.tasks.find((t) => t.id === 'a')!;
    expect(a.timer?.plannedSeconds).toBe(240); // spentSeconds(120) + a full new 120 s session
    expect(a.timer?.runningSince).toBe(now);

    now += 120_000;
    sched.fireDelay(120_000); // a genuine SECOND expiry — proves session 2 was a real full session
    expect(notify.timerDone).toHaveBeenCalledTimes(2);
  });
});

describe('Clock (resolveToggleTimerAction clamp — Task 3.2 fix round 2, item 3)', () => {
  // settings/patch dispatched directly on the Store (as these tests do throughout)
  // bypasses the zod schema entirely (that only runs at the IPC boundary in
  // main/ipc.ts) — these simulate a workMinutes value outside the schema's own
  // 1..240 bound reaching the store anyway (e.g. data written before this fix).
  it('clamps an oversized workMinutes*60 down to the 14400 s maximum', () => {
    const now = new Date(2026, 8, 15, 10, 0, 0).getTime();
    const store = makeStore(() => now);
    store.dispatch({ type: 'settings/patch', now, patch: { timer: { pomodoro: true, workMinutes: 500 } } });
    store.dispatch({ type: 'task/add', id: 'a', now, title: 'Task', today: true });

    const action = resolveToggleTimerAction(store.get().today.current, store.get().data.settings, now);

    expect(action).toEqual({ type: 'timer/startSession', id: 'a', now, seconds: 14400 });
  });

  it('clamps a zero/tiny workMinutes up to the 60 s minimum', () => {
    const now = new Date(2026, 8, 15, 10, 0, 0).getTime();
    const store = makeStore(() => now);
    store.dispatch({ type: 'settings/patch', now, patch: { timer: { pomodoro: true, workMinutes: 0 } } });
    store.dispatch({ type: 'task/add', id: 'a', now, title: 'Task', today: true });

    const action = resolveToggleTimerAction(store.get().today.current, store.get().data.settings, now);

    expect(action).toEqual({ type: 'timer/startSession', id: 'a', now, seconds: 60 });
  });

  it('does not clamp an in-range workMinutes', () => {
    const now = new Date(2026, 8, 15, 10, 0, 0).getTime();
    const store = makeStore(() => now);
    store.dispatch({ type: 'settings/patch', now, patch: { timer: { pomodoro: true, workMinutes: 25 } } });
    store.dispatch({ type: 'task/add', id: 'a', now, title: 'Task', today: true });

    const action = resolveToggleTimerAction(store.get().today.current, store.get().data.settings, now);

    expect(action).toEqual({ type: 'timer/startSession', id: 'a', now, seconds: 1500 });
  });
});

describe('Clock (test gaps — Task 3.2 fix round 1, item 3)', () => {
  it('re-arms when runningSince changes (pause then resume) and fires again for the new run', () => {
    let now = new Date(2026, 8, 15, 10, 0, 0).getTime();
    const { store, sched, notify, clock } = makeClockDeps(() => now);
    store.dispatch({ type: 'task/add', id: 'a', now, title: 'Task', today: true, plannedSeconds: 10 });
    store.dispatch({ type: 'timer/start', id: 'a', now });
    clock.start();
    expect(sched.delays()).toContain(10_000);

    now += 4_000;
    store.dispatch({ type: 'timer/pause', id: 'a', now }); // spentSeconds=4, remaining=6
    expect(sched.delays()).not.toContain(10_000);

    store.dispatch({ type: 'timer/start', id: 'a', now }); // resume: expiry moves to now+6000
    expect(sched.delays()).toContain(6_000);

    now += 6_000;
    sched.fireDelay(6_000);
    expect(notify.timerDone).toHaveBeenCalledTimes(1);
  });

  it('an expiry already in the past when arming (start() called well after the real expiry) fires once at 0 ms', () => {
    let now = new Date(2026, 8, 15, 10, 0, 0).getTime();
    const { store, sched, notify, clock } = makeClockDeps(() => now);
    store.dispatch({ type: 'task/add', id: 'a', now, title: 'Task', today: true, plannedSeconds: 10 });
    store.dispatch({ type: 'timer/start', id: 'a', now });
    now += 50_000; // 40 s past the 10 s plan, BEFORE clock.start() ever runs

    clock.start(); // the initial onSnapshot() call arms it fresh, from scratch

    expect(sched.delays()).toContain(0);
    sched.fireDelay(0);
    expect(notify.timerDone).toHaveBeenCalledTimes(1);
  });

  it('an expiry beyond the 2^31-1 ms cap is chunked and re-arms for the remainder', () => {
    let now = new Date(2026, 8, 15, 10, 0, 0).getTime();
    const { store, sched, clock } = makeClockDeps(() => now);
    const plannedSeconds = 30 * 24 * 3600; // 30 days — exceeds the ~24.8-day 2^31-1 ms cap
    store.dispatch({ type: 'task/add', id: 'a', now, title: 'Task', today: true, plannedSeconds });
    store.dispatch({ type: 'timer/start', id: 'a', now });

    clock.start();

    const capMs = 2 ** 31 - 1;
    expect(sched.delays()).toContain(capMs);

    now += capMs; // the first chunk elapses
    sched.fireDelay(capMs);

    const remaining = plannedSeconds * 1000 - capMs;
    expect(sched.delays()).toContain(remaining);
    expect(sched.delays()).not.toContain(capMs * 2);
  });

  it('idle pause dispatches at = now - idleSeconds*1000 (asserted on the dispatched action itself)', () => {
    let now = new Date(2026, 8, 15, 10, 0, 0).getTime();
    const { store, pm, sched, clock } = makeClockDeps(() => now);
    store.dispatch({ type: 'settings/patch', now, patch: { timer: { idlePauseMinutes: 5 } } });
    store.dispatch({ type: 'task/add', id: 'a', now, title: 'Task', today: true });
    store.dispatch({ type: 'timer/start', id: 'a', now });
    clock.start();
    const dispatchSpy = vi.spyOn(store, 'dispatch');

    pm.setIdleSeconds(400); // >= 5 * 60 = 300
    now += 60_000;
    sched.fireDelay(60_000);

    const pauseCall = dispatchSpy.mock.calls.find(([a]) => (a as { type: string }).type === 'timer/pause');
    expect(pauseCall?.[0]).toMatchObject({ type: 'timer/pause', id: 'a', now, at: now - 400_000 });
  });
});

describe('Clock (stop() — Task 3.2)', () => {
  it('stop() clears the expiry, break, and idle timers and stops reacting to the store', () => {
    const now = new Date(2026, 8, 15, 10, 0, 0).getTime();
    const { store, sched, notify, broadcastBreak, clock } = makeClockDeps(() => now);
    store.dispatch({ type: 'settings/patch', now, patch: { timer: { pomodoro: true, breakMinutes: 1, idlePauseMinutes: 5 } } });
    store.dispatch({ type: 'task/add', id: 'a', now, title: 'Task', today: true, plannedSeconds: 5 });
    store.dispatch({ type: 'timer/start', id: 'a', now });
    clock.start();
    sched.fireDelay(5_000); // expiry -> pause + break starts
    expect(broadcastBreak).toHaveBeenCalledWith({ endsAt: now + 60_000 });

    clock.stop();

    expect(sched.size()).toBe(0);
    expect(broadcastBreak).toHaveBeenLastCalledWith(null);

    // Further store activity (a second task started with its own short plan) must
    // not revive any Clock-driven side effect: no new timers, no new notification.
    const notifyCallsBefore = notify.timerDone.mock.calls.length;
    store.dispatch({ type: 'task/add', id: 'b', now, title: 'Another', today: true, plannedSeconds: 1 });
    store.dispatch({ type: 'timer/start', id: 'b', now });
    expect(sched.size()).toBe(0);
    expect(notify.timerDone.mock.calls.length).toBe(notifyCallsBefore);
  });
});
