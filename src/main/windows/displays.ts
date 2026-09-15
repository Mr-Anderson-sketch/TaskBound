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

/** Task 7.1 (win32 AppBar) ruling 4 — "which rect to dock against": while an AppBar
 * reservation is active FOR THIS DISPLAY, the strip must dock against the GRANTED
 * rect's own edge (`grantedDip`, already converted to DIPs by the caller) instead of
 * `d.workArea`. Once a reservation is registered, Windows shrinks `workArea` by the
 * reserved amount — docking against `workArea` on every redock would then push the
 * strip inward by that same amount again and again (the reservation "chasing" its
 * own shrinking work area, growing without bound). Bottom edge: the strip's content
 * bottom sits at the granted rect's bottom; top edge: content top at the granted
 * rect's top. Falls back to the ordinary `workArea` edge (with the taskbar-auto-hide
 * 2 px reserve) when there is no active grant. Pure — no Electron, no koffi — so
 * unit-testable without touching a real display or a real Win32 call. */
export function dockedEdgeY(
  d: DisplayLike,
  edge: Edge,
  height: number,
  taskbarAutoHide?: boolean,
  grantedDip?: Rect
): number {
  if (grantedDip) {
    return edge === 'top' ? grantedDip.y : grantedDip.y + grantedDip.height - height;
  }
  const { workArea } = d;
  const reserve = taskbarAutoHide ? 2 : 0;
  return edge === 'top' ? workArea.y + reserve : workArea.y + workArea.height - height - reserve;
}

/** Docks a `size`-shaped window flush to `edge` inside the display's work area.
 * `along` (if given) is the desired x, restored from position memory or the drag
 * cursor; otherwise the strip is horizontally centred. When `taskbarAutoHide` is
 * true, the strip is nudged 2 px further from that edge so it doesn't sit flush
 * against a taskbar that can reveal itself over it. `grantedDip` (Task 7.1), when
 * given, overrides the docked edge's y via `dockedEdgeY` — see its doc comment.
 * Every field is rounded. */
export function dockBounds(
  d: DisplayLike,
  edge: Edge,
  size: { width: number; height: number },
  along?: number,
  taskbarAutoHide?: boolean,
  grantedDip?: Rect
): Rect {
  const { workArea } = d;
  const centred = workArea.x + (workArea.width - size.width) / 2;
  const x = clampAlong(d, along ?? centred, size.width);
  const y = dockedEdgeY(d, edge, size.height, taskbarAutoHide, grantedDip);
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

/** The strip's WIDTH after any `strip:reportSize` report — collapsed (pill, content
 * -driven, capped at 240 by CSS) or expanded (panel) alike (Task 1.8+1.9 fix round 1
 * finding 9, closed fully in fix round 2 open item 2: the expanded branch in
 * `StripWindow.handleReportedSize` still adopted the reported width even when not
 * collapsed). The reported width is only ever adopted while collapsed; otherwise it
 * always tracks `settingsWidth` — otherwise a stale pill-mode width, reported once
 * while collapsed, would stick forever (the renderer's `.strip{width:100%}` just
 * reports back whatever the window's current — still pill-sized — client width is, a
 * self-perpetuating loop). Pure so it's unit-testable without a real `BrowserWindow`. */
export function nextReportedWidth(reportedWidth: number, collapsed: boolean, settingsWidth: number): number {
  return collapsed ? reportedWidth : settingsWidth;
}

/** The strip's collapsed size after a renderer `strip:reportSize` report — see
 * `nextReportedWidth` for the width rule. Height is always the reported value,
 * capped at `maxHeight`. Pure so it's unit-testable without a real `BrowserWindow`. */
export function nextCollapsedSize(
  reported: { width: number; height: number },
  collapsed: boolean,
  settingsWidth: number,
  maxHeight: number
): { width: number; height: number } {
  return {
    width: nextReportedWidth(reported.width, collapsed, settingsWidth),
    height: Math.min(reported.height, maxHeight)
  };
}

/** Re-anchors a rect whose ACTUAL applied height differs from what was requested
 * (Task 1.8+1.9 fix round 1 C1, corrected in fix round 2 open item 3): on Windows a
 * transparent frameless `BrowserWindow` cannot be shorter than ~39 DIP regardless of
 * the requested height, so the docked edge must be re-derived from the requested
 * rect's OWN edge — not the raw work-area edge — or a deliberate offset already
 * baked into `requestedY` (dockBounds's 2 px "taskbar auto-hide" reserve; also
 * relevant to the sliver and the expanded panel, whose rects are all derived from
 * the same docked anchor) gets silently discarded, leaving the strip flush against
 * the true work-area edge and covering the taskbar's auto-hide reveal row.
 *
 * Bottom edge: keeps the ACTUAL rect's bottom edge equal to the REQUESTED rect's
 * bottom edge (`requestedY + requestedHeight`), so the window only grows upward,
 * away from the docked edge. Top edge: keeps `y` exactly at `requestedY` (the window
 * only grows downward). Identical to anchoring against the raw work area when
 * `requestedY` has no reserve baked in. Pure — no Electron — so it's unit-testable
 * without a real `BrowserWindow`. */
export function reanchorY(requestedY: number, requestedHeight: number, actualHeight: number, edge: Edge): number {
  return edge === 'top' ? requestedY : requestedY + requestedHeight - actualHeight;
}
