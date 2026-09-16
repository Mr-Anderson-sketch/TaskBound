// main/win32/geometry — pure math for the Windows AppBar/fullscreen integration
// (Task 7.1). No koffi import, no Electron import: everything here is plain numbers
// and strings, unit-tested under Vitest without touching a real Win32 API or a real
// display. See docs/PLAN.md Task 7.1 and CLAUDE.md ("src/core/ is pure TypeScript" —
// this module follows the same discipline even though it lives under src/main/,
// mirroring src/main/windows/displays.ts).
//
// Fix round 1 (I-1): this module used to also do the DIP<->physical-pixel SCALING
// (multiplying by `display.scaleFactor` from the display's own DIP origin) — that is
// wrong for a secondary display with a different scale factor than the primary:
// Windows' per-monitor DPI virtualization does not place a secondary monitor's
// physical origin at `dipOrigin * itsOwnScaleFactor`, so the naive multiplication
// silently produced the wrong physical rect (and therefore the wrong AppBar
// reservation) whenever the primary and secondary displays scale differently. That
// conversion now happens in `StripWindow` via the OS-correct, injectable
// `screen.dipToScreenRect`/`screen.screenToDipRect` (see strip.ts's `syncAppBar`).
// This module keeps only the EDGE/HEIGHT geometry — which edge, how tall, flush to
// which side of the display's own (DIP) bounds — entirely in DIPs, no scale factor
// anywhere in this file any more.
import type { Edge } from '../../core/types';
import type { DisplayLike, Rect } from '../windows/displays';

/** A Win32 `RECT`: left/top/right/bottom, all in the same unit as the caller uses
 * (physical pixels for everything that crosses the koffi boundary). */
export interface RectPx {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The DIP-space rect (`Rect`, `displays.ts`'s `{x,y,width,height}` shape) to REQUEST
 * an AppBar reservation for: a strip of `heightDip` docked to `edge` of `display`,
 * spanning the display's full (DIP) width, flush to that edge of `display.bounds`
 * (Electron's `Display.bounds` is already in DIPs — not `workArea`, which may already
 * be shrunk by a PRIOR reservation; the AppBar API itself decides how much of this
 * request it actually grants, via `ABM_QUERYPOS`/`ABM_SETPOS`). The caller
 * (`StripWindow.syncAppBar`) converts this to physical pixels via
 * `screen.dipToScreenRect` before calling `SHAppBarMessage` — see this file's header
 * comment for why that conversion must not happen here. */
export function appBarRectDip(display: DisplayLike, edge: Edge, heightDip: number): Rect {
  const { bounds } = display;
  const y = edge === 'top' ? bounds.y : bounds.y + bounds.height - heightDip;
  return { x: bounds.x, y, width: bounds.width, height: heightDip };
}

/** Converts a Win32 `RECT` (left/top/right/bottom) to `displays.ts`'s `Rect`
 * (x/y/width/height). Pure unit-preserving reshaping — no DIP/physical scaling of any
 * kind — used at the koffi boundary where `SHAppBarMessage`'s `APPBARDATA.rc` (a
 * `RECT`) meets `screen.dipToScreenRect`/`screenToDipRect` (which take/return
 * Electron's `Rectangle`, i.e. this module's `Rect` shape). */
export function rectPxToRect(r: RectPx): Rect {
  return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
}

/** The inverse of `rectPxToRect`. */
export function rectToRectPx(r: Rect): RectPx {
  return { left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height };
}

/** The AppBar reservation "signature" for `display`/`edge`/`heightDip` — Task 7.1 fix
 * round 1 (I-2): includes the display's own `bounds` (x, y, width, height) and
 * `scaleFactor`, not just its id, so a display metrics change that leaves the id
 * alone (resolution change, scale change, monitor moved in the OS's arrangement UI)
 * still produces a DIFFERENT signature and triggers a fresh `ABM_NEW`/`SETPOS`
 * sequence in `StripWindow.syncAppBar` — an id-only signature would otherwise treat
 * the redock as a no-op and leave a STALE grant (sized/positioned for the display's
 * previous metrics) in place indefinitely. */
export function appBarSignature(d: DisplayLike, edge: Edge, heightDip: number): string {
  const b = d.bounds;
  return `${d.id}:${edge}:${heightDip}:${b.x},${b.y},${b.width},${b.height}:${d.scaleFactor}`;
}

/** True when `windowRect` covers its monitor's full rect within `tolerancePx` on
 * every edge (default 1 px — DPI rounding can leave a hairline gap even for a
 * genuinely fullscreen window). Pure geometry: the caller supplies the foreground
 * window's rect and the rect of the monitor `MonitorFromWindow` resolved it to. */
export function isFullscreenRect(windowRect: RectPx, monitorRect: RectPx, tolerancePx = 1): boolean {
  return (
    Math.abs(windowRect.left - monitorRect.left) <= tolerancePx &&
    Math.abs(windowRect.top - monitorRect.top) <= tolerancePx &&
    Math.abs(windowRect.right - monitorRect.right) <= tolerancePx &&
    Math.abs(windowRect.bottom - monitorRect.bottom) <= tolerancePx
  );
}

/** Window classes that belong to the desktop/taskbar shell itself, never a "real"
 * foreground app — `GetForegroundWindow` can return these (e.g. right after the last
 * app closes, or briefly during Alt-Tab), and they must never be mistaken for a
 * fullscreen app.
 *
 * Fix: Windows shell SURFACES — Start menu, Search, Action Center, Task View, Widgets,
 * the lock/login UI, the IME/emoji panel — are full-screen-sized windows too (measured
 * on a real machine: foreground class `Windows.UI.Core.CoreWindow`, rect equal to the
 * whole monitor). Without these classes, simply opening Start hid the strip whenever
 * `settings.strip.hideOverFullscreen` is on. `isShellProcess` (below) is the PRIMARY,
 * more precise check (matches by owning process, since these hosts sometimes share
 * generic window classes with real apps); this class set is the fallback used when the
 * process lookup fails or is unavailable. Trade-off (deliberate): a rare UWP game that
 * renders directly into a bare `CoreWindow` (rather than a normal top-level app window)
 * will therefore not trigger auto-hide either — a hidden strip over the Start menu is a
 * visible, frequent bug; a missed hide over a rare full-screen UWP game is not. */
const SHELL_CLASSES = new Set([
  'Progman',
  'WorkerW',
  'Shell_TrayWnd',
  'Shell_SecondaryTrayWnd',
  'Windows.UI.Core.CoreWindow',
  'XamlExplorerHostIslandWindow',
  'MultitaskingViewFrame',
  'ForegroundStaging',
  'Shell_InputSwitchTopLevelWindow',
  'EdgeUiInputTopWndClass',
  'TaskListThumbnailWnd'
]);

export function isShellClass(className: string): boolean {
  return SHELL_CLASSES.has(className);
}

/** Executable basenames of Windows shell HOST processes — Start menu, Search, Action
 * Center, the lock/login UI, the IME/emoji panel, Widgets, and the desktop shell
 * (`explorer.exe`) itself — matched case-insensitively so a full-screen-sized window
 * owned by one of these is never mistaken for a fullscreen app (see `SHELL_CLASSES`'s
 * doc comment for the bug this fixes). This is the PRIMARY check (more precise than
 * matching by window class alone), used by `isForegroundFullscreen` via the caller's
 * `getForegroundProcessExeName` dependency.
 *
 * Deliberately EXCLUDES `applicationframehost.exe` (hosts real UWP apps — Mail,
 * Photos, Maps — so treating it as shell would suppress auto-hide over a genuinely
 * full-screen UWP app) and `systemsettings.exe` (an ordinary, real, full-screen-able
 * app window, not a shell surface). */
const SHELL_PROCESS_NAMES = new Set([
  'startmenuexperiencehost.exe',
  'searchhost.exe',
  'searchapp.exe',
  'shellexperiencehost.exe',
  'textinputhost.exe',
  'lockapp.exe',
  'widgets.exe',
  'explorer.exe'
]);

/** True when `exeName` (a full path or bare filename — only the basename is
 * inspected) names a Windows shell host process. Pure string matching, no Win32 call
 * here: the caller (`fullscreen.ts`) is responsible for resolving the foreground
 * window's owning process name via injected, never-throwing Win32 deps. */
export function isShellProcess(exeName: string): boolean {
  const basename = exeName.split(/[\\/]/).pop() ?? exeName;
  return SHELL_PROCESS_NAMES.has(basename.toLowerCase());
}

/** Decodes the raw pointer-width HWND value out of the `Buffer` Electron's
 * `BrowserWindow.getNativeWindowHandle()` returns. That Buffer's BYTES (native
 * endianness) ARE the handle value — it is not a pointer TO the buffer's contents —
 * so this reads the integer out rather than handing the buffer itself to koffi
 * (which would instead pass the buffer's own memory address, i.e. a pointer to
 * these bytes, not the HWND they encode). Every Win32 binding in this package takes
 * window handles as plain `uintptr_t`/`bigint` values for exactly this reason: a
 * HWND is never dereferenced by this app, only passed to and compared against
 * values returned by other Win32 calls, so treating it as an opaque pointer-sized
 * integer end-to-end sidesteps any ambiguity in how a native pointer type would
 * marshal a raw address. 8-byte buffers (x64/arm64) are read as an unsigned 64-bit
 * little-endian integer; shorter buffers (ia32) as a 32-bit one. */
export function hwndValue(handle: Buffer): bigint {
  if (handle.length >= 8) return handle.readBigUInt64LE(0);
  if (handle.length >= 4) return BigInt(handle.readUInt32LE(0));
  return 0n;
}
