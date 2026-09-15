// main/windows/appBarReservation — Task 7.1 fix round 2: the Win32 AppBar
// reservation state machine (signature/grant/hwnd bookkeeping, the reserve/release
// dance, and the "quit latch" screen-listener attach/detach) extracted out of
// `StripWindow` into its own unit, injected with the `appBar` API, a screen-event
// emitter, and the DIP<->physical conversion functions — so it is constructible and
// testable without a real Electron `BrowserWindow`/`screen` (see
// tests/main/appBarReservation.test.ts). `StripWindow` owns everything else
// (the window, the `disposed` latch's ON/OFF lifecycle, `onDisplaysChanged` ->
// `redock`); this module owns only what happens to the reservation itself.
import type { Edge } from '../../core/types';
import type { DisplayLike, Rect } from './displays';
import { appBarRectDip, appBarSignature, hwndValue, rectPxToRect, rectToRectPx } from '../win32/geometry';
import type { RectPx } from '../win32/geometry';
import type { AppBarApi } from '../win32/appbar';

type DisplayEventName = 'display-added' | 'display-removed' | 'display-metrics-changed';

/** The subset of Electron's `screen` this module needs — an `EventEmitter`-shaped
 * `on`/`removeListener` pair. Real `screen` satisfies this as-is; tests inject a
 * plain `EventEmitter` (or an even smaller fake) instead. */
export interface ScreenEvents {
  on(event: DisplayEventName, listener: () => void): unknown;
  removeListener(event: DisplayEventName, listener: () => void): unknown;
}

export interface AppBarReservationDeps {
  /** `undefined` on every platform/environment where win32 integration isn't
   * available — `sync()` then always behaves as `wantReserve: false` regardless of
   * what's passed in, exactly like `StripWindow.syncAppBar` did before. */
  appBar: AppBarApi | undefined;
  screenEvents: ScreenEvents;
  /** DIP -> physical-pixel, for the reservation REQUEST. */
  dipToScreenRect: (rect: Rect) => Rect;
  /** physical-pixel -> DIP, for the GRANTED rect. */
  screenToDipRect: (rect: Rect) => Rect;
}

const DISPLAY_EVENTS: DisplayEventName[] = ['display-added', 'display-removed', 'display-metrics-changed'];

/** Owns one AppBar reservation's lifecycle. Cheap to call `sync()` on every redock —
 * it only actually talks to `appBar.reserve` when the "reserve for exactly this
 * configuration" signature changes (see `appBarSignature`'s doc comment in
 * geometry.ts). */
export class AppBarReservation {
  private signature: string | undefined;
  private grantedRectDip: Rect | undefined;
  private grantedDisplayId: number | undefined;
  /** Fix round 1 (C-1): the raw hwnd VALUE (not a `Buffer`) captured the moment
   * `reserve()` last succeeded — `release()` uses this (via `appBar.releaseByValue`)
   * instead of needing a live `BrowserWindow` to re-read a handle from, which can no
   * longer be read once the window is destroyed. */
  private reservedHwndValue: bigint | undefined;
  private attachedListener: (() => void) | undefined;

  constructor(private readonly deps: AppBarReservationDeps) {}

  /** The last GRANTED rect, in DIPs — `undefined` when there is no active
   * reservation. */
  get grantedRect(): Rect | undefined {
    return this.grantedRectDip;
  }

  /** Task 7.1: the granted rect, but ONLY when it was granted for `displayId`
   * specifically (see `StripWindow.grantedDipFor`'s doc comment for why a stale
   * cross-monitor grant must never be used). */
  grantedRectFor(displayId: number): Rect | undefined {
    return this.grantedDisplayId === displayId ? this.grantedRectDip : undefined;
  }

  /** Registers `onDisplaysChanged` on all three display events. Idempotent — a
   * second `attach()` before a matching `detach()` is a no-op (matches `create()`
   * only ever being called once per live window). */
  attach(onDisplaysChanged: () => void): void {
    if (this.attachedListener) return;
    this.attachedListener = onDisplaysChanged;
    for (const event of DISPLAY_EVENTS) this.deps.screenEvents.on(event, onDisplaysChanged);
  }

  /** Removes the listener registered by `attach()`, if any. Idempotent. */
  detach(): void {
    if (!this.attachedListener) return;
    const listener = this.attachedListener;
    this.attachedListener = undefined;
    for (const event of DISPLAY_EVENTS) this.deps.screenEvents.removeListener(event, listener);
  }

  /** Claims (or releases) the reservation for the CURRENT `edge`/`heightDip`/`d`.
   * `hwndBuffer` is only read when `wantReserve` is true (mirrors
   * `StripWindow.syncAppBar`, which only calls `getNativeWindowHandle()` on that
   * path). Fix round 2: the hwnd VALUE is captured immediately once `reserve()`
   * succeeds — before the (possibly throwing) grant->DIP conversion below — so a
   * reservation that succeeded at the OS level is always releasable even if that
   * conversion then throws; previously the hwnd value was stored LAST, so a
   * throwing conversion left the signature recorded with no hwnd value, and
   * `release()` (gated on the signature) silently skipped `ABM_REMOVE`, leaking the
   * reservation. Both conversions are wrapped so an exception here releases the
   * reservation and logs rather than escaping to the caller (`StripWindow.redock`)
   * uncaught. */
  sync(d: DisplayLike, edge: Edge, heightDip: number, wantReserve: boolean, hwndBuffer?: Buffer): void {
    if (!wantReserve || !this.deps.appBar) {
      this.release();
      return;
    }
    const sig = appBarSignature(d, edge, heightDip);
    if (this.signature === sig) return;

    const rectDip = appBarRectDip(d, edge, heightDip);
    let rectPx: RectPx;
    try {
      rectPx = rectToRectPx(this.deps.dipToScreenRect(rectDip));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('AppBarReservation: request DIP->screen conversion failed; skipping this reservation attempt', err);
      return;
    }

    let result: { granted: RectPx } | undefined;
    try {
      result = this.deps.appBar.reserve(hwndBuffer!, edge, rectPx);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('AppBarReservation: reserve failed; docking against the plain work area instead', err);
      result = undefined;
    }

    if (result) {
      // Store the hwnd value FIRST — see this method's doc comment.
      this.reservedHwndValue = hwndValue(hwndBuffer!);
      this.signature = sig;
      try {
        this.grantedRectDip = this.deps.screenToDipRect(rectPxToRect(result.granted));
        this.grantedDisplayId = d.id;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('AppBarReservation: grant DIP conversion failed; releasing the reservation', err);
        this.release();
      }
    } else {
      this.grantedRectDip = undefined;
      this.grantedDisplayId = undefined;
    }
  }

  /** Releases any active reservation (idempotent — safe to call whether or not one
   * is currently held). Fix round 2: gated on `reservedHwndValue`, not the
   * signature — a handle value stored without a matching signature (shouldn't
   * happen any more given the ordering fix above, but this is the belt-and-braces
   * half of that fix) must still be released. */
  release(): void {
    const hwndVal = this.reservedHwndValue;
    if (this.signature === undefined && hwndVal === undefined) return;
    if (this.deps.appBar && hwndVal !== undefined) {
      try {
        this.deps.appBar.releaseByValue(hwndVal);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('AppBarReservation: release failed', err);
      }
    }
    this.signature = undefined;
    this.grantedRectDip = undefined;
    this.grantedDisplayId = undefined;
    this.reservedHwndValue = undefined;
  }
}
