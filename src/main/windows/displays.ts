// main/windows/displays — pure docking math for the strip window. No Electron import:
// callers (strip.ts) pass in plain objects shaped like Electron's `Display`, so this
// module is unit-testable under Vitest without a real display server. See
// docs/PLAN.md Task 1.7 and CLAUDE.md ("src/core/ is pure TypeScript" — this module
// follows the same discipline even though it lives under src/main/).
import type { Edge } from '../../core/types';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayLike {
  id: number;
  bounds: Rect;
  workArea: Rect;
  scaleFactor: number;
}

// Electron's `Rectangle` (what `BrowserWindow.setBounds` takes) requires integers;
// every rect-shaped value this module hands back to strip.ts is rounded before it
// leaves here, so callers never have to round (or forget to).
function roundRect(r: Rect): Rect {
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
}

/** Primary key for per-display position memory: the Electron display id, stringified. */
export function displayKey(d: DisplayLike): string {
  return String(d.id);
}

/** Fallback key when a display's id has changed (e.g. after a driver update or
 * reconnect) but it is otherwise the same physical monitor: resolution + scale. */
export function displaySignature(d: DisplayLike): string {
  return `${d.bounds.width}x${d.bounds.height}@${d.scaleFactor}`;
}

/** Keeps the strip's horizontal span `[x, x + width]` inside the display's work area.
 * If the strip is wider than the work area, it is pinned to the work area's left edge
 * (there is nowhere else to put it). Result is rounded to an integer. */
export function clampAlong(d: DisplayLike, x: number, width: number): number {
  const { workArea } = d;
  if (width > workArea.width) {
    return Math.round(workArea.x);
  }
  const min = workArea.x;
  const max = workArea.x + workArea.width - width;
  return Math.round(Math.min(Math.max(x, min), max));
}

/** True when the OS taskbar on this edge is set to auto-hide: the work area reaches
 * all the way to that edge of the display's full bounds (no reserved gap), because
 * the taskbar itself reserves no space while hidden. */
export function isTaskbarAutoHide(d: DisplayLike, edge: Edge): boolean {
  const { bounds, workArea } = d;
  if (edge === 'bottom') {
    return workArea.y + workArea.height === bounds.y + bounds.height && workArea.height === bounds.height;
  }
  return workArea.y === bounds.y && workArea.height === bounds.height;
}

/** Docks a `size`-shaped window flush to `edge` inside the display's work area.
 * `along` (if given) is the desired x, restored from position memory or the drag
 * cursor; otherwise the strip is horizontally centred. When `taskbarAutoHide` is
 * true, the strip is nudged 2 px further from that edge so it doesn't sit flush
 * against a taskbar that can reveal itself over it. Every field is rounded. */
export function dockBounds(
  d: DisplayLike,
  edge: Edge,
  size: { width: number; height: number },
  along?: number,
  taskbarAutoHide?: boolean
): Rect {
  const { workArea } = d;
  const centred = workArea.x + (workArea.width - size.width) / 2;
  const x = clampAlong(d, along ?? centred, size.width);
  const reserve = taskbarAutoHide ? 2 : 0;
  const y = edge === 'top' ? workArea.y + reserve : workArea.y + workArea.height - size.height - reserve;
  return roundRect({ x, y, width: size.width, height: size.height });
}

/** The hover panel's bounds: the union of the strip's own rect and the panel that
 * grows away from the docked edge, so the strip is the panel's last row (DESIGN.md
 * "Hover panel") and the window never has to move the strip itself. */
export function panelBounds(strip: Rect, edge: Edge, panelHeight: number): Rect {
  if (edge === 'bottom') {
    return roundRect({ x: strip.x, y: strip.y - panelHeight, width: strip.width, height: strip.height + panelHeight });
  }
  return roundRect({ x: strip.x, y: strip.y, width: strip.width, height: strip.height + panelHeight });
}

/** The 4 px auto-hide sliver, spanning the strip's x/width but flush to the
 * *work area's* edge on the docked side (`workArea`, i.e. `DisplayLike.workArea`) —
 * NOT the display's physical bounds. A normal (non-auto-hide) taskbar occupies the
 * gap between the work area and the physical edge, so a sliver placed at the
 * physical edge would land inside the taskbar and pointing at taskbar buttons would
 * re-show the strip. When the taskbar itself auto-hides, `workArea` already reaches
 * the physical edge (see `isTaskbarAutoHide`), so this is flush to the true screen
 * edge in that case too — no separate handling needed. No 2 px reserve here (unlike
 * `dockBounds`'s `taskbarAutoHide` nudge): the sliver is meant to be right at the
 * work area boundary either way. */
export function sliverBounds(strip: Rect, edge: Edge, workArea: Rect): Rect {
  const height = 4;
  const y = edge === 'top' ? workArea.y : workArea.y + workArea.height - height;
  return roundRect({ x: strip.x, y, width: strip.width, height });
}

/** The 24×24 drag/click-through handle, vertically centred in the strip, 4 px from
 * its left edge (DESIGN.md pixel spec: "|◂4▸[ 24×24 handle ]"). */
export function handleRect(strip: Rect): Rect {
  return roundRect({ x: strip.x + 4, y: strip.y + (strip.height - 24) / 2, width: 24, height: 24 });
}

/** Point-in-rect hit test, inclusive of the rect's edges. */
export function pointIn(rect: Rect, pt: { x: number; y: number }): boolean {
  return pt.x >= rect.x && pt.x <= rect.x + rect.width && pt.y >= rect.y && pt.y <= rect.y + rect.height;
}

/** Restores a remembered x/y for `d`: first by its stable id, then by its
 * resolution+scale signature (survives an id reassignment), else undefined. */
export function restorePosition(
  positions: Record<string, { x: number; y: number }>,
  d: DisplayLike
): { x: number; y: number } | undefined {
  return positions[displayKey(d)] ?? positions[displaySignature(d)];
}
