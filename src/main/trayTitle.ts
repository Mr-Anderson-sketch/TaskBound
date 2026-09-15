// main/trayTitle — macOS menu bar mode (Task 6.1, spec Part 5.1 "Zero-pixel mode"):
// pure title composition (`truncateTitle`/`composeTrayTitle`) plus a throttled
// updater (`TrayTitleUpdater`) that drives `Tray.setTitle`. Kept Electron-free (no
// `Tray`, no `Date.now()` — `now` is always passed in) so both halves are
// unit-testable without a real Electron runtime, unlike `AppTray` itself
// (constructing a real `Tray` needs one) — see tests/main/trayTitle.test.ts.
import type { TaskTimer } from '../core/types';
import { elapsedSeconds, fmtClock, remainingSeconds } from '../core/timer';

/** Spec 5.1: "truncated to a setting, default 28 chars". */
export const DEFAULT_MAX_TITLE_LENGTH = 28;

const UPDATE_INTERVAL_MS = 1000;

/** Truncates `title` to at most `maxLength` characters (by UTF-16 code unit, same
 * unit `String.prototype.length` uses elsewhere in this codebase), appending a
 * single ellipsis character so the truncated text — ellipsis included — never
 * exceeds `maxLength`. Untruncated titles are returned unchanged. `maxLength <= 0`
 * returns ''; `maxLength === 1` returns just the ellipsis. */
export function truncateTitle(title: string, maxLength: number = DEFAULT_MAX_TITLE_LENGTH): string {
  if (maxLength <= 0) return '';
  if (title.length <= maxLength) return title;
  if (maxLength === 1) return '…';
  return title.slice(0, maxLength - 1) + '…';
}

export interface TrayTitleState {
  /** The current task's title, or `undefined` when there is no current task, OR
   * when menu bar mode is off — callers gate this on `settings.strip.menuBarMode`
   * themselves (Task 6.1 ruling: "on non-darwin `menuBarMode` is ignored", and the
   * title should also go blank on darwin when the setting is off). */
  currentTitle: string | undefined;
  timer: TaskTimer | undefined;
}

/** Composes the macOS status item's title: the truncated current task title alone,
 * or (while the timer is running) the title plus two spaces and `fmtClock` of the
 * remaining time (or elapsed, for an unplanned timer) — matching
 * `useDisplayTime`'s remaining-else-elapsed rule in the renderer. Empty string
 * when there's no title to show (status item then reads as just the template
 * icon). Two spaces (not one) separate title from clock: a single space reads as
 * glued to the title's last character in the system font. */
export function composeTrayTitle(
  state: TrayTitleState,
  now: number,
  maxLength: number = DEFAULT_MAX_TITLE_LENGTH
): string {
  if (!state.currentTitle) return '';
  const truncated = truncateTitle(state.currentTitle, maxLength);
  const timer = state.timer;
  if (!timer || timer.runningSince === undefined) return truncated;
  const remaining = remainingSeconds(timer, now);
  const seconds = remaining !== undefined ? remaining : elapsedSeconds(timer, now);
  return `${truncated}  ${fmtClock(seconds)}`;
}

/** Drives `onUpdate(text)` (the caller wires this to `Tray.setTitle`): immediately
 * on every `sync()` call (meant to be called on every store change), and
 * additionally at most once per second via a `setInterval` that is armed only
 * while the current task's timer is running and disarmed the instant it isn't —
 * so the clock keeps advancing between store changes without ever ticking faster
 * than 1 Hz, and without a background interval running at all while nothing is
 * timing. Uses the real global `setInterval`/`clearInterval` (fake-timer-friendly
 * in tests via `vi.useFakeTimers()`) rather than injected scheduler functions —
 * `now` is the only injected clock, kept separate from the interval itself so
 * tests can assert the throttle (at most one `onUpdate` per second) independent
 * of what the composed text says. */
export class TrayTitleUpdater {
  private interval: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly getState: () => TrayTitleState,
    private readonly now: () => number,
    private readonly onUpdate: (text: string) => void,
    private readonly maxLength: number = DEFAULT_MAX_TITLE_LENGTH
  ) {}

  /** Call on every store change (and once up front, to paint the initial title). */
  sync(): void {
    const state = this.getState();
    this.emit(state);
    const running = state.timer?.runningSince !== undefined;
    if (running && !this.interval) {
      this.interval = setInterval(() => this.emit(this.getState()), UPDATE_INTERVAL_MS);
    } else if (!running && this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  /** Disarms the interval (if any) without emitting again. Idempotent. */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  private emit(state: TrayTitleState): void {
    this.onUpdate(composeTrayTitle(state, this.now(), this.maxLength));
  }
}
