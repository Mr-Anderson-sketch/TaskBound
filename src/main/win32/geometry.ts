// main/win32/geometry — pure math for the Windows AppBar/fullscreen integration
// (Task 7.1). No koffi import, no Electron import: everything here is plain numbers
// and strings, unit-tested under Vitest without touching a real Win32 API or a real
// display. See docs/PLAN.md Task 7.1 and CLAUDE.md ("src/core/ is pure TypeScript" —
// this module follows the same discipline even though it lives under src/main/,
// mirroring src/main/windows/displays.ts).
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

/** The physical-pixel `RECT` to REQUEST from `SHAppBarMessage` for a strip of
 * `heightDip` (DIPs) docked to `edge` of `display`: scaled by `display.scaleFactor`,
 * spanning the display's full physical width, flush to that edge of
 * `display.bounds` (the display's own physical bounds — not `workArea`, which may
 * already be shrunk by a PRIOR reservation; the AppBar API itself decides how much
 * of this request it actually grants, via `ABM_QUERYPOS`/`ABM_SETPOS`). */
export function appBarRect(display: DisplayLike, edge: Edge, heightDip: number): RectPx {
  const s = display.scaleFactor;
  const left = Math.round(display.bounds.x * s);
  const right = Math.round((display.bounds.x + display.bounds.width) * s);
  const heightPx = Math.round(heightDip * s);
  const top =
    edge === 'top' ? Math.round(display.bounds.y * s) : Math.round((display.bounds.y + display.bounds.height) * s) - heightPx;
  const bottom = top + heightPx;
  return { left, top, right, bottom };
}

/** Converts a physical-pixel `RECT` (e.g. the AppBar's GRANTED rect) back to a DIP
 * `Rect` (`{x,y,width,height}`, `displays.ts`'s shape) using `scaleFactor` — the
 * inverse of the scaling half of `appBarRect`. Rounded to integers, same discipline
 * as `displays.ts`'s `roundRect` (every rect-shaped value leaving this module is an
 * integer so callers never have to round). */
export function rectPxToDip(r: RectPx, scaleFactor: number): Rect {
  const left = r.left / scaleFactor;
  const top = r.top / scaleFactor;
  const right = r.right / scaleFactor;
  const bottom = r.bottom / scaleFactor;
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(right - left),
    height: Math.round(bottom - top)
  };
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
 * fullscreen app. */
const SHELL_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd']);

export function isShellClass(className: string): boolean {
  return SHELL_CLASSES.has(className);
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
