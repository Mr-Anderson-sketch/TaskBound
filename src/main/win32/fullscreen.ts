// main/win32/fullscreen — "is some OTHER app fullscreen right now?" (Task 7.1
// addendum ruling 5), as pure orchestration over INJECTED Win32 calls. No koffi
// import here — `index.ts` binds the real functions via koffi; this module (and its
// decision logic) is unit-testable with fake deps, never touching a real Win32 API.
import type { RectPx } from './geometry';
import { hwndValue, isFullscreenRect, isShellClass, isShellProcess } from './geometry';

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
  /** Fix: best-effort basename of the executable owning `hwnd` (e.g.
   * `"startmenuexperiencehost.exe"`), via `GetWindowThreadProcessId` +
   * `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` + `QueryFullProcessImageNameW`.
   * This is the PRIMARY, more precise check for "is this actually a Windows shell
   * surface (Start, Search, Action Center, Task View, Widgets, the lock/login UI, the
   * IME panel) rather than a real fullscreen app" — `isShellClass` is only the
   * fallback. MUST return `undefined` rather than throw on any failure (access
   * denied, the process having exited between `GetForegroundWindow` and this call,
   * etc.); the caller also wraps this call defensively so a misbehaving
   * implementation can never crash the poll. */
  getForegroundProcessExeName(hwnd: bigint): string | undefined;
}

export interface FullscreenApi {
  /** True when the foreground window is some OTHER app covering its entire monitor
   * — i.e. a borderless-fullscreen or exclusive-fullscreen window (addendum ruling
   * 5): the foreground hwnd is non-null, is not one of `ownHwnds` (this app's own
   * windows — the strip must never hide itself over its own panel/palette/planner),
   * is not the shell/desktop window (by handle OR by class — belt and suspenders:
   * `GetShellWindow()`/`GetDesktopWindow()` can lag a shell restart, but the window
   * CLASS of Progman/WorkerW/the tray never changes), is not owned by a Windows shell
   * HOST process (Start menu, Search, Action Center, Task View, Widgets, the
   * lock/login UI, the IME panel — fix: these are full-screen-sized windows too, and
   * without this check simply opening Start hid the strip), is not a shell window
   * CLASS either (the fallback used when the process check fails/is unavailable —
   * see `isShellClass`'s doc comment), and its rect matches its monitor's rect within
   * 1 px. */
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

    // Fix: process-based shell check, PRIMARY over the class check below. Wrapped in
    // try/catch as a second line of defense (on top of the dep's own contract of never
    // throwing) — any failure here (thrown, or no name resolved) simply falls through
    // to the class check, never crashes the poll.
    let exeName: string | undefined;
    try {
      exeName = deps.getForegroundProcessExeName(fg);
    } catch {
      exeName = undefined;
    }
    if (exeName && isShellProcess(exeName)) return false;

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
