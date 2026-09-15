// main/clock — arms the daily rollover (`day/rollover`, see core/reducer.ts) at the
// next local 04:00, dispatches it immediately on start() (idempotent — the reducer
// no-ops a repeat for the same date key), and re-dispatches + re-arms on system
// resume/unlock (a sleeping laptop must not miss the boundary). No top-level
// `electron` value import (only `import type`), so this runs under Vitest without
// Electron — `powerMonitor` and the timer functions are injected (CLAUDE.md: "no
// Electron, no Node APIs" applies to core/, but this file lives in main/ and still
// keeps the same no-value-import discipline as hotkeys.ts for testability).
import type { PowerMonitor } from 'electron';
import { dayKeyForRollover } from '../core/dates';
import type { Store } from './store';

// setTimeout's delay is a signed 32-bit int internally; anything larger fires
// immediately in Node/Chromium instead of waiting. The next-4-AM delay is always
// well under 24h, so this only matters as a defensive ceiling (per the addendum).
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

export interface ClockDeps {
  store: Store;
  powerMonitor: Pick<PowerMonitor, 'on' | 'removeListener'>;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (h: unknown) => void;
}

/** Epoch ms of the next local 04:00 strictly after `now` (today's 04:00 if `now` is
 * still before it, otherwise tomorrow's). */
function nextFourAm(now: number): number {
  const d = new Date(now);
  const candidate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 4, 0, 0, 0);
  if (candidate.getTime() <= now) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate.getTime();
}

export class Clock {
  private timerHandle: unknown;
  private started = false;

  constructor(private readonly deps: ClockDeps) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.dispatchRollover();
    this.armTimer();
    this.deps.powerMonitor.on('resume', this.onWake);
    this.deps.powerMonitor.on('unlock-screen', this.onWake);
  }

  stop(): void {
    this.started = false;
    if (this.timerHandle !== undefined) {
      this.deps.clearTimer(this.timerHandle);
      this.timerHandle = undefined;
    }
    this.deps.powerMonitor.removeListener('resume', this.onWake);
    this.deps.powerMonitor.removeListener('unlock-screen', this.onWake);
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
    this.dispatchRollover();
    this.armTimer();
  };
}
