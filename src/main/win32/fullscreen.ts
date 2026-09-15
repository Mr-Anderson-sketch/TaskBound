// main/win32/fullscreen — "is some OTHER app fullscreen right now?" (Task 7.1
// addendum ruling 5), as pure orchestration over INJECTED Win32 calls. No koffi
// import here — `index.ts` binds the real functions via koffi; this module (and its
// decision logic) is unit-testable with fake deps, never touching a real Win32 API.
import type { RectPx } from './geometry';
import { hwndValue, isFullscreenRect, isShellClass } from './geometry';

export interface FullscreenDeps {
  /** `GetForegroundWindow()`. `0n` when there is no foreground window. */
  getForegroundWindow(): bigint;
  /** `GetWindowRect(hwnd)`. `undefined` if the call failed (e.g. the window closed
   * between `GetForegroundWindow` and this call). */
  getWindowRect(hwnd: bigint): RectPx | undefined;
  /** `MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST)`. */
  monitorFromWindow(hwnd: bigint): bigint;
  /** `GetMonitorInfoW(hMonitor).rcMonitor`. `undefined` if the call failed. */
  getMonitorRect(hMonitor: bigint): RectPx | undefined;
  /** `GetClassNameW(hwnd)`. Empty string if the call failed. */
  getClassName(hwnd: bigint): string;
  /** `GetShellWindow()`. */
  getShellWindow(): bigint;
  /** `GetDesktopWindow()`. */
  getDesktopWindow(): bigint;
}

export interface FullscreenApi {
  /** True when the foreground window is some OTHER app covering its entire monitor
   * — i.e. a borderless-fullscreen or exclusive-fullscreen window (addendum ruling
   * 5): the foreground hwnd is non-null, is not one of `ownHwnds` (this app's own
   * windows — the strip must never hide itself over its own panel/palette/planner),
   * is not the shell/desktop window (by handle OR by class — belt and suspenders:
   * `GetShellWindow()`/`GetDesktopWindow()` can lag a shell restart, but the window
   * CLASS of Progman/WorkerW/the tray never changes), and its rect matches its
   * monitor's rect within 1 px. */
  isForegroundFullscreen(ownHwnds: Buffer[]): boolean;
}

export function createFullscreen(deps: FullscreenDeps): FullscreenApi {
  function isForegroundFullscreen(ownHwnds: Buffer[]): boolean {
    const fg = deps.getForegroundWindow();
    if (fg === 0n) return false;

    for (const own of ownHwnds) {
      if (hwndValue(own) === fg) return false;
    }

    if (fg === deps.getShellWindow() || fg === deps.getDesktopWindow()) return false;
    if (isShellClass(deps.getClassName(fg))) return false;

    const windowRect = deps.getWindowRect(fg);
    if (!windowRect) return false;

    const monitor = deps.monitorFromWindow(fg);
    const monitorRect = deps.getMonitorRect(monitor);
    if (!monitorRect) return false;

    return isFullscreenRect(windowRect, monitorRect, 1);
  }

  return { isForegroundFullscreen };
}
