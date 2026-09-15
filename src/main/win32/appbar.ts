// main/win32/appbar — the Win32 AppBar registration protocol (Task 7.1 addendum
// ruling 3), as pure sequencing logic over an INJECTED `shAppBarMessage`. No koffi
// import here: `index.ts` binds the real `SHAppBarMessage` via koffi and hands in a
// plain function, so this module (and its native-call sequence: ABM_NEW once per
// hwnd, then ABM_QUERYPOS, then ABM_SETPOS on every `reserve()`; ABM_REMOVE,
// idempotent, on `release()`) is unit-testable without touching a real Win32 API —
// see tests/main/win32.test.ts and CLAUDE.md's "no telemetry, no network calls"
// discipline extended here to "no real OS calls in unit tests".
import type { Edge } from '../../core/types';
import type { RectPx } from './geometry';
import { hwndValue } from './geometry';

// AppBar messages (winuser.h) — only the four this task needs.
const ABM_NEW = 0x00000000;
const ABM_REMOVE = 0x00000001;
const ABM_QUERYPOS = 0x00000002;
const ABM_SETPOS = 0x00000003;

// AppBar edges (winuser.h).
const ABE_LEFT = 0;
const ABE_TOP = 1;
const ABE_RIGHT = 2;
const ABE_BOTTOM = 3;

// `APPBARDATA.uCallbackMessage` must be a window-message id the AppBar API will
// (harmlessly) post to our hwnd for notifications (e.g. another AppBar registering,
// taskbar auto-hide state changes) — v1 does not hook into the window's message
// loop to handle these (Electron does not expose one), so this is a fixed sentinel
// above WM_APP rather than a value obtained from `RegisterWindowMessageW` (not in
// this task's koffi binding list). Undelivered/unhandled notifications are harmless
// here: we simply never react to them. Documented per addendum ruling 3.
const ABN_CALLBACK_MESSAGE = 0x8000 + 0x37;

function edgeToAbe(edge: Edge): number {
  return edge === 'top' ? ABE_TOP : ABE_BOTTOM;
}

/** The `APPBARDATA` struct, as a plain JS object koffi marshals in/out of the
 * `_Inout_ APPBARDATA *pData` parameter. `hWnd` is the raw pointer-width handle
 * value (see `geometry.ts`'s `hwndValue` doc comment for why this is a `bigint`,
 * not a Buffer or an opaque pointer object). */
export interface AppBarDataIo {
  cbSize: number;
  hWnd: bigint;
  uCallbackMessage: number;
  uEdge: number;
  rc: RectPx;
  lParam: number;
}

export interface AppBarDeps {
  /** The bound `SHAppBarMessage` (shell32.dll). Mutates `data` in place for
   * `ABM_QUERYPOS`/`ABM_SETPOS` (koffi's `_Inout_` struct-pointer marshalling),
   * exactly like every other Win32 "pass a struct, get it filled in" API in this
   * codebase. Returns a Win32 `BOOL`-ish value; only `ABM_NEW`/`ABM_REMOVE`'s return
   * is meaningful (nonzero = success) — `ABM_QUERYPOS`/`ABM_SETPOS` return values
   * are documented by MSDN as unused, and this module ignores them. */
  shAppBarMessage(dwMessage: number, data: AppBarDataIo): number;
  /** `koffi.sizeof(APPBARDATA)` — the correct platform-ABI struct size, computed by
   * `index.ts` (which owns the koffi struct declaration) and injected here so this
   * module never needs to import koffi itself. */
  cbSize: number;
}

export interface AppBarApi {
  /** Registers this `hwnd` as an AppBar (once; a second `reserve()` for the same
   * hwnd skips `ABM_NEW` and only re-runs `ABM_QUERYPOS`/`ABM_SETPOS` — the correct
   * way to move/resize an already-registered AppBar), requests `rectPx` at `edge`,
   * and returns the rect Windows actually GRANTED (which can differ from what was
   * requested, e.g. if another AppBar already occupies part of that edge).
   * `undefined` on failure (`ABM_NEW` returned falsy) — the caller must then dock
   * against the plain `workArea` instead, exactly as if `reserveSpace` were off. */
  reserve(hwnd: Buffer, edge: Edge, rectPx: RectPx): { granted: RectPx } | undefined;
  /** Unregisters this `hwnd`'s AppBar (`ABM_REMOVE`). Idempotent: a `release()` for
   * an hwnd that was never registered (or already released) is a silent no-op — it
   * never sends a spurious `ABM_REMOVE`, so it is always safe to call from every
   * "give up the reservation" path (settings change, `before-quit`, window
   * destroy) without first checking whether one is actually held. */
  release(hwnd: Buffer): void;
}

export function createAppBar(deps: AppBarDeps): AppBarApi {
  // Which hwnds currently hold an ABM_NEW registration — keyed by the raw handle
  // value (see hwndValue), not the Buffer object, since a fresh Buffer with the same
  // bytes must still be recognised as "the same window".
  const registered = new Set<bigint>();

  function reserve(hwnd: Buffer, edge: Edge, rectPx: RectPx): { granted: RectPx } | undefined {
    const h = hwndValue(hwnd);
    const uEdge = edgeToAbe(edge);

    if (!registered.has(h)) {
      const newData: AppBarDataIo = {
        cbSize: deps.cbSize,
        hWnd: h,
        uCallbackMessage: ABN_CALLBACK_MESSAGE,
        uEdge,
        rc: rectPx,
        lParam: 0
      };
      const ok = deps.shAppBarMessage(ABM_NEW, newData);
      if (!ok) return undefined;
      registered.add(h);
    }

    // ABM_QUERYPOS: Windows adjusts `rc` to avoid overlapping another AppBar
    // already registered on this edge (most commonly the taskbar itself, which is
    // an AppBar too) — but per MSDN, it only ever moves the edge OPPOSITE `edge`
    // (the "anchor" edge — the one flush against the true screen edge — never
    // moves; only the "variable" edge that determines our height does). Passing the
    // result straight to ABM_SETPOS as-is would then commit a rect whose anchor
    // edge no longer matches our variable edge at all (e.g. a bottom-docked bar
    // whose `bottom` got pulled up to sit above the taskbar, while `top` — still
    // wherever WE originally put it — stays put, producing a nonsense/inverted
    // rect). The standard two-step AppBar dance (every MSDN/community sample) is:
    // re-derive the anchor edge from the QUERYPOS-adjusted variable edge, restoring
    // our ORIGINAL requested height, before calling ABM_SETPOS.
    const height = rectPx.bottom - rectPx.top;
    const queryData: AppBarDataIo = {
      cbSize: deps.cbSize,
      hWnd: h,
      uCallbackMessage: ABN_CALLBACK_MESSAGE,
      uEdge,
      rc: { ...rectPx },
      lParam: 0
    };
    deps.shAppBarMessage(ABM_QUERYPOS, queryData);
    if (edge === 'top') {
      queryData.rc = { ...queryData.rc, bottom: queryData.rc.top + height };
    } else {
      queryData.rc = { ...queryData.rc, top: queryData.rc.bottom - height };
    }

    // ABM_SETPOS: commits the (re-derived) rect and shrinks `workArea` by it; may
    // adjust `rc` once more (MSDN: "the system might again adjust the coordinates
    // ... to accommodate other app bars") — the FINAL `rc` after this call is what
    // was actually granted, and is returned as-is (even if Windows shrank it
    // further than we re-derived above).
    const setData: AppBarDataIo = { ...queryData, rc: { ...queryData.rc } };
    deps.shAppBarMessage(ABM_SETPOS, setData);

    return { granted: setData.rc };
  }

  function release(hwnd: Buffer): void {
    const h = hwndValue(hwnd);
    if (!registered.has(h)) return;
    const data: AppBarDataIo = {
      cbSize: deps.cbSize,
      hWnd: h,
      uCallbackMessage: ABN_CALLBACK_MESSAGE,
      uEdge: ABE_LEFT,
      rc: { left: 0, top: 0, right: 0, bottom: 0 },
      lParam: 0
    };
    deps.shAppBarMessage(ABM_REMOVE, data);
    registered.delete(h);
  }

  return { reserve, release };
}
