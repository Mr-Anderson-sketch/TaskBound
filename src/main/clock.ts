// main/clock — arms the daily rollover (`day/rollover`, see core/reducer.ts) at the
// next local 04:00, dispatches it immediately on start() (idempotent — the reducer
// no-ops a repeat for the same date key), and re-dispatches + re-arms on system
// resume/unlock (a sleeping laptop must not miss the boundary). No top-level
// `electron` value import (only `import type`), so this runs under Vitest without
// Electron — `powerMonitor` and the timer functions are injected (CLAUDE.md: "no
// Electron, no Node APIs" applies to core/, but this file lives in main/ and still
// keeps the same no-value-import discipline as hotkeys.ts for testability).
//
// Task 3.2 (addendum, binding over the brief) extends this SAME class rather than
// adding a second clock: it also subscribes to the store to arm/re-arm a running
// timer's expiry, runs an optional pomodoro break, pauses on suspend/lock past an
// away threshold, and pauses on sustained system idle. Rollover behaviour above is
// unchanged.
import type { PowerMonitor } from 'electron';
import { addDays, dayKeyForRollover, rolloverCutoffMs, ymd } from '../core/dates';
import { expiryAt } from '../core/timer';
import type { Action, Settings, Task } from '../core/types';
import type { Snapshot } from '../shared/ipc';
import type { Store } from './store';

// setTimeout's delay is a signed 32-bit int internally; anything larger fires
// immediately in Node/Chromium instead of waiting. The next-4-AM delay is always
// well under 24h, so this only matters as a defensive ceiling (per the addendum).
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

// Task 3.2 fix round 2, item 3: the same 60..14400 s bound `timer/startSession`'s own
// zod schema enforces at the IPC boundary — `resolveToggleTimerAction` dispatches
// directly via `store.dispatch` (main.ts), bypassing that validation entirely, so a
// settings value outside the (now also schema-bounded, 1..240 min) range — e.g. from
// data written before this fix — must still not reach the reducer unclamped.
const MIN_SESSION_SECONDS = 60;
const MAX_SESSION_SECONDS = 14400;

/** Pure decision logic for the `toggleTimer` hotkey/tray-item/`timer:toggle` IPC
 * handler in main.ts — extracted (fix round 1, item 3 minor) so
 * `tests/main/clock.test.ts` can dispatch EXACTLY what main.ts would, without
 * needing Electron, to cover back-to-back pomodoro sessions. `undefined` when there
 * is no current task (main no-ops). Fix round 1 item 1 (supersedes addendum ruling
 * 3): pomodoro mode always starts a full `workMinutes` session via
 * `timer/startSession`, regardless of any existing `plannedSeconds` — a plain
 * `timer/start` would expire instantly once `spentSeconds >= plannedSeconds` from an
 * earlier session. */
export function resolveToggleTimerAction(current: Task | undefined, settings: Settings, now: number): Action | undefined {
  if (!current) return undefined;
  const running = current.timer?.runningSince !== undefined;
  if (running) {
    return { type: 'timer/pause', id: current.id, now };
  }
  if (settings.timer.pomodoro) {
    const seconds = Math.min(MAX_SESSION_SECONDS, Math.max(MIN_SESSION_SECONDS, settings.timer.workMinutes * 60));
    return { type: 'timer/startSession', id: current.id, now, seconds };
  }
  return { type: 'timer/start', id: current.id, now };
}

// How often, while a task is running, main checks `powerMonitor.getSystemIdleTime()`
// (addendum ruling 5).
const IDLE_CHECK_INTERVAL_MS = 60_000;

export interface ClockDeps {
  store: Store;
  powerMonitor: Pick<PowerMonitor, 'on' | 'removeListener' | 'getSystemIdleTime'>;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (h: unknown) => void;
  notify: { timerDone: (task: Task) => void; breakDone: () => void };
  broadcastBreak: (b: { endsAt: number } | null) => void;
}

/** Epoch ms of the next local 04:00 strictly after `now` (today's 04:00 if `now` is
 * still before it, otherwise tomorrow's). Goes through `rolloverCutoffMs` (built on
 * the local-component `Date` constructor, like `parseYmd`) rather than a raw
 * milliseconds offset, so it resolves correctly across a DST transition landing on
 * `now`'s own calendar day (fix round 1, reviewer point 3/4). */
function nextFourAm(now: number): number {
  const today = ymd(now);
  const todayCutoff = rolloverCutoffMs(today);
  if (todayCutoff > now) return todayCutoff;
  return rolloverCutoffMs(addDays(today, 1));
}

export class Clock {
  private timerHandle: unknown; // the rollover (04:00) timer
  // Tracks only whether the powerMonitor listeners + store subscription are
  // registered — NOT whether start() has ever run. Fix round 1, reviewer Critical 1:
  // a second start() call (e.g. tests re-arming, or a future caller) must still
  // re-dispatch rollover for the current key and re-arm the timer (clearing whatever
  // was pending), just without registering the listeners/subscription a second time.
  private listening = false;
  private unsubscribeStore: (() => void) | undefined;

  // --- Task 3.2: timer expiry -----------------------------------------------------
  private expiryTimerHandle: unknown;
  private armedExpiry: { id: string; expiry: number } | undefined;
  // Guards against notifying twice for the same run even if some future change ever
  // re-arms with an identical (id, expiry) pair (addendum ruling 2).
  private firedFor: string | undefined;

  // --- Task 3.2: pomodoro break (in memory, not persisted) ------------------------
  private breakTimerHandle: unknown;
  private breakEndsAt: number | undefined;

  // --- Task 3.2: suspend/lock -> resume/unlock away threshold ---------------------
  private suspendedAt: number | undefined;

  // --- Task 3.2: idle pause ---------------------------------------------------------
  private idleIntervalHandle: unknown;

  constructor(private readonly deps: ClockDeps) {}

  start(): void {
    if (this.timerHandle !== undefined) {
      this.deps.clearTimer(this.timerHandle);
      this.timerHandle = undefined;
    }
    this.dispatchRollover();
    this.armTimer();
    if (!this.listening) {
      this.listening = true;
      this.deps.powerMonitor.on('resume', this.onWake);
      this.deps.powerMonitor.on('unlock-screen', this.onWake);
      this.deps.powerMonitor.on('suspend', this.onSuspend);
      this.deps.powerMonitor.on('lock-screen', this.onSuspend);
      this.unsubscribeStore = this.deps.store.subscribe(this.onSnapshot);
    }
    // Syncs expiry/idle-interval state against whatever the store already holds
    // (e.g. a timer left running across an app restart), not just future changes.
    this.onSnapshot(this.deps.store.get());
  }

  stop(): void {
    if (this.timerHandle !== undefined) {
      this.deps.clearTimer(this.timerHandle);
      this.timerHandle = undefined;
    }
    if (this.expiryTimerHandle !== undefined) {
      this.deps.clearTimer(this.expiryTimerHandle);
      this.expiryTimerHandle = undefined;
    }
    this.armedExpiry = undefined;
    this.firedFor = undefined;
    this.clearBreak();
    this.stopIdleInterval();
    this.suspendedAt = undefined;
    if (this.listening) {
      this.listening = false;
      this.deps.powerMonitor.removeListener('resume', this.onWake);
      this.deps.powerMonitor.removeListener('unlock-screen', this.onWake);
      this.deps.powerMonitor.removeListener('suspend', this.onSuspend);
      this.deps.powerMonitor.removeListener('lock-screen', this.onSuspend);
      this.unsubscribeStore?.();
      this.unsubscribeStore = undefined;
    }
  }

  private dispatchRollover(): void {
    const now = this.deps.now();
    this.deps.store.dispatch({ type: 'day/rollover', now, date: dayKeyForRollover(now) });
  }

  /** Arms (or re-arms) `timerHandle` for the next local 04:00, chunking through
   * `MAX_TIMEOUT_MS` if that's ever more than ~24.8 days away (never happens for a
   * same-or-next-day 04:00, but keeps this correct if `now`/`setTimer` are ever
   * driven by a test or a clock jump that makes the gap huge). */
  private armTimer(): void {
    const now = this.deps.now();
    const delay = Math.max(0, nextFourAm(now) - now);
    if (delay > MAX_TIMEOUT_MS) {
      this.timerHandle = this.deps.setTimer(() => this.armTimer(), MAX_TIMEOUT_MS);
      return;
    }
    this.timerHandle = this.deps.setTimer(() => this.onFire(), delay);
  }

  private onFire(): void {
    this.dispatchRollover();
    this.armTimer();
  }

  private readonly onWake = (): void => {
    if (this.timerHandle !== undefined) {
      this.deps.clearTimer(this.timerHandle);
      this.timerHandle = undefined;
    }

    // Addendum ruling 4 (fix round 1 minor: clear `suspendedAt` only AFTER using it,
    // and use the EARLIEST of possibly-several suspend/lock instants — see
    // `onSuspend`): a suspend/lock that lasted longer than the away threshold pauses
    // whatever was running, folding the elapsed segment up to that earliest SUSPEND
    // instant (not "now" — the user wasn't at the keyboard for the gap).
    if (this.suspendedAt !== undefined) {
      const suspendedAt = this.suspendedAt;
      const snapshot = this.deps.store.get();
      const running = snapshot.data.tasks.find((t) => t.timer?.runningSince !== undefined);
      const thresholdMs = snapshot.data.settings.timer.awayThresholdMinutes * 60_000;
      const now = this.deps.now();
      if (running && now - suspendedAt > thresholdMs) {
        this.deps.store.dispatch({ type: 'timer/pause', id: running.id, now, at: suspendedAt });
      }
      this.suspendedAt = undefined;
    }

    this.dispatchRollover();
    this.armTimer();
  };

  private readonly onSuspend = (): void => {
    // Fix round 1 minor: `suspend` and `lock-screen` can BOTH fire around the same
    // real sleep/lock event; keep the EARLIEST instant rather than overwriting it, so
    // a `lock-screen` at T followed by a `suspend` at T+10min still folds the away
    // gap from T, not T+10min.
    this.suspendedAt ??= this.deps.now();
  };

  // --- Task 3.2: react to every store snapshot -------------------------------------

  private readonly onSnapshot = (snapshot: Snapshot): void => {
    const running = snapshot.data.tasks.find((t) => t.timer?.runningSince !== undefined);

    // Starting any timer cancels an in-progress break (addendum ruling 3).
    if (running && this.breakEndsAt !== undefined) {
      this.clearBreak();
    }

    if (running) {
      this.startIdleIntervalIfNeeded();
    } else {
      this.stopIdleInterval();
    }

    const expiry = running ? expiryAt(running.timer!) : undefined;
    // Fix round 1, item 1 last bullet: a task resumed while it was ALREADY past its
    // plan (spentSeconds >= plannedSeconds when this run started, e.g. a manually
    // paused-then-resumed overtime task) computes an expiry at or before its own
    // `runningSince` — arming that would fire at 0 ms and re-send "Time's up" for
    // overtime the renderer is already showing. Only arm when the timer was NOT
    // already in overtime at the start of this run.
    const alreadyOvertimeAtStart = running !== undefined && expiry !== undefined && expiry <= running.timer!.runningSince!;
    if (!running || expiry === undefined || alreadyOvertimeAtStart) {
      if (this.expiryTimerHandle !== undefined) {
        this.deps.clearTimer(this.expiryTimerHandle);
        this.expiryTimerHandle = undefined;
      }
      this.armedExpiry = undefined;
      return;
    }

    if (!this.armedExpiry || this.armedExpiry.id !== running.id || this.armedExpiry.expiry !== expiry) {
      if (this.expiryTimerHandle !== undefined) {
        this.deps.clearTimer(this.expiryTimerHandle);
        this.expiryTimerHandle = undefined;
      }
      this.armedExpiry = { id: running.id, expiry };
      this.armExpiryTimer(running.id, expiry);
    }
  };

  private armExpiryTimer(taskId: string, expiry: number): void {
    const now = this.deps.now();
    const delay = Math.max(0, expiry - now);
    if (delay > MAX_TIMEOUT_MS) {
      this.expiryTimerHandle = this.deps.setTimer(() => this.armExpiryTimer(taskId, expiry), MAX_TIMEOUT_MS);
      return;
    }
    this.expiryTimerHandle = this.deps.setTimer(() => this.onExpiry(taskId, expiry), delay);
  }

  private onExpiry(taskId: string, expiry: number): void {
    this.expiryTimerHandle = undefined;

    // Only once per (taskId, expiry) pair (addendum ruling 2).
    const key = `${taskId}:${expiry}`;
    if (this.firedFor === key) return;
    this.firedFor = key;

    const snapshot = this.deps.store.get();
    const task = snapshot.data.tasks.find((t) => t.id === taskId);
    if (!task) return;

    // Never dispatch on plain expiry — the renderer already shows overtime.
    this.deps.notify.timerDone(task);

    if (snapshot.data.settings.timer.pomodoro) {
      // Fix round 1, item 3 minor: fold at the EXPIRY instant, not `now` — if the
      // computer slept and this timer only fires on wake (well after the real
      // expiry), the sleep gap must not count as focus time.
      const now = this.deps.now();
      this.deps.store.dispatch({ type: 'timer/pause', id: taskId, now, at: expiry });
      this.startBreak(snapshot.data.settings.timer.breakMinutes);
    }
  }

  /** The current pomodoro break, if any — for a newly-created or reloaded window to
   * replay on its own `did-finish-load` (fix round 1, item 3 minor "break replay"). */
  getCurrentBreak(): { endsAt: number } | null {
    return this.breakEndsAt !== undefined ? { endsAt: this.breakEndsAt } : null;
  }

  // --- Task 3.2: pomodoro break ------------------------------------------------------

  private startBreak(breakMinutes: number): void {
    this.clearBreak();
    const now = this.deps.now();
    const endsAt = now + breakMinutes * 60_000;
    this.breakEndsAt = endsAt;
    this.deps.broadcastBreak({ endsAt });
    this.breakTimerHandle = this.deps.setTimer(() => this.onBreakEnd(), Math.max(0, endsAt - now));
  }

  private onBreakEnd(): void {
    this.breakTimerHandle = undefined;
    this.breakEndsAt = undefined;
    this.deps.broadcastBreak(null);
    this.deps.notify.breakDone();
  }

  private clearBreak(): void {
    if (this.breakTimerHandle !== undefined) {
      this.deps.clearTimer(this.breakTimerHandle);
      this.breakTimerHandle = undefined;
    }
    if (this.breakEndsAt !== undefined) {
      this.breakEndsAt = undefined;
      this.deps.broadcastBreak(null);
    }
  }

  // --- Task 3.2: idle pause -----------------------------------------------------------

  private startIdleIntervalIfNeeded(): void {
    if (this.idleIntervalHandle !== undefined) return;
    this.scheduleIdleCheck();
  }

  private scheduleIdleCheck(): void {
    this.idleIntervalHandle = this.deps.setTimer(() => this.checkIdle(), IDLE_CHECK_INTERVAL_MS);
  }

  private stopIdleInterval(): void {
    if (this.idleIntervalHandle !== undefined) {
      this.deps.clearTimer(this.idleIntervalHandle);
      this.idleIntervalHandle = undefined;
    }
  }

  private checkIdle(): void {
    this.idleIntervalHandle = undefined;
    const snapshot = this.deps.store.get();
    const running = snapshot.data.tasks.find((t) => t.timer?.runningSince !== undefined);
    if (!running) return; // stopped running since this check was scheduled; do not reschedule

    const idlePauseMinutes = snapshot.data.settings.timer.idlePauseMinutes;
    if (idlePauseMinutes > 0) {
      const idleSeconds = this.deps.powerMonitor.getSystemIdleTime();
      if (idleSeconds >= idlePauseMinutes * 60) {
        const now = this.deps.now();
        this.deps.store.dispatch({ type: 'timer/pause', id: running.id, now, at: now - idleSeconds * 1000 });
        return; // onSnapshot (from the dispatch above) already stopped the interval
      }
    }
    this.scheduleIdleCheck();
  }
}
