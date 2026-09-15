// main/win32/watcher — polls "is some other app fullscreen?" every 2 s and drives
// the strip's fullscreen auto-hide (Task 7.1 addendum ruling 5). A small,
// injected-everything state machine (isFullscreen/setInterval/clearInterval/
// onEnter/onExit) so it is unit-testable with Vitest fake timers and never touches
// a real Win32 API or a real BrowserWindow — see tests/main/win32.test.ts.
export interface FullscreenWatcherDeps {
  /** Polled on every tick; typically `win32.fullscreen.isForegroundFullscreen(ownHwnds())`. */
  isFullscreen(): boolean;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  /** Called exactly once on the transition into fullscreen (not on every tick while
   * still fullscreen) — the caller hides the strip with reason `'fullscreen'`. */
  onEnter(): void;
  /** Called exactly once on the transition OUT of fullscreen. The caller un-hides
   * the strip for the `'fullscreen'` reason only — composing with any separate
   * user-toggle hide is `StripWindow.setAutoHidden`'s job, not this class's: a user
   * who hid the strip themselves must not see it reappear just because whatever app
   * was fullscreen stopped being fullscreen. */
  onExit(): void;
}

const DEFAULT_INTERVAL_MS = 2000;

export class FullscreenWatcher {
  private timer: unknown;
  private inFullscreen = false;

  constructor(private readonly deps: FullscreenWatcherDeps) {}

  /** Idempotent: calling `start()` while already running does not restart the
   * timer or re-fire `onEnter`/`onExit` for the current state. */
  start(intervalMs: number = DEFAULT_INTERVAL_MS): void {
    if (this.timer !== undefined) return;
    this.timer = this.deps.setInterval(() => this.tick(), intervalMs);
  }

  /** Idempotent. Does NOT itself call `onExit()` — stopping the watcher (e.g.
   * because `hideOverFullscreen` was turned off, or the strip was disabled) is a
   * deliberate "stop caring", not an observed exit from fullscreen; a caller that
   * wants the strip visible again after stopping must do so itself (main.ts's
   * `hideOverFullscreen`-off path un-hides via `setAutoHidden('fullscreen', false)`
   * directly, matching the addendum's "release on reserveSpace false" symmetry for
   * the AppBar side). */
  stop(): void {
    if (this.timer === undefined) return;
    this.deps.clearInterval(this.timer);
    this.timer = undefined;
  }

  get running(): boolean {
    return this.timer !== undefined;
  }

  /** Exposed (not just private) so the e2e seam can drive the state machine
   * directly with a stubbed `isFullscreen`, without waiting out a real 2 s poll —
   * addendum ruling 7. */
  tick(): void {
    const fullscreen = this.deps.isFullscreen();
    if (fullscreen && !this.inFullscreen) {
      this.inFullscreen = true;
      this.deps.onEnter();
    } else if (!fullscreen && this.inFullscreen) {
      this.inFullscreen = false;
      this.deps.onExit();
    }
  }
}
