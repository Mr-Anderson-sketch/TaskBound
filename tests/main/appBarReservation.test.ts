// tests/main/appBarReservation — Task 7.1 fix round 2: unit tests for the "quit
// latch" behavior (reservation active -> release -> a re-entrant display-metrics-
// changed event must not re-reserve) and for the handle-ordering fix (a throwing
// DIP<->physical conversion must not leak the reservation). `AppBarReservation` is
// constructed directly, injected with a fake `appBar` API, a plain `EventEmitter`
// standing in for Electron's `screen`, and fake conversion functions — no real
// Electron/koffi/win32 API is touched here, matching the discipline in
// tests/main/win32.test.ts.
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { AppBarReservation } from '../../src/main/windows/appBarReservation';
import type { AppBarApi } from '../../src/main/win32/appbar';
import type { DisplayLike, Rect } from '../../src/main/windows/displays';

function makeDisplay(overrides: Partial<DisplayLike> = {}): DisplayLike {
  return {
    id: 1,
    bounds: { x: 0, y: 0, width: 1366, height: 768 },
    workArea: { x: 0, y: 0, width: 1366, height: 768 },
    scaleFactor: 1,
    ...overrides
  };
}

function makeHwnd(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value, 0);
  return buf;
}

const GRANTED_PX = { left: 0, top: 0, right: 1366, bottom: 32 };
const GRANTED_DIP: Rect = { x: 0, y: 0, width: 1366, height: 32 };

/** A fake `appBar` whose `reserve()` always succeeds and grants exactly what was
 * requested — the common case for tests that aren't specifically exercising a
 * reserve failure. */
function makeFakeAppBar(overrides: Partial<AppBarApi> = {}): AppBarApi {
  return {
    reserve: vi.fn(() => ({ granted: GRANTED_PX })),
    release: vi.fn(),
    releaseByValue: vi.fn(),
    ...overrides
  };
}

function makeIdentityConversions() {
  return {
    dipToScreenRect: vi.fn((rect: Rect) => rect),
    screenToDipRect: vi.fn(() => GRANTED_DIP)
  };
}

describe('AppBarReservation', () => {
  it('(a) active reservation -> disposeAndRelease path (detach then release) -> a re-entrant display-metrics-changed does not re-reserve, and releaseByValue is called once with the stored handle', () => {
    const appBar = makeFakeAppBar();
    const screenEvents = new EventEmitter();
    const { dipToScreenRect, screenToDipRect } = makeIdentityConversions();
    const reservation = new AppBarReservation({ appBar, screenEvents, dipToScreenRect, screenToDipRect });

    const onDisplaysChanged = vi.fn();
    reservation.attach(onDisplaysChanged);

    const d = makeDisplay();
    const hwnd = makeHwnd(0x42n);
    reservation.sync(d, 'bottom', 32, true, hwnd);
    expect(appBar.reserve).toHaveBeenCalledTimes(1);

    // The "quit latch" sequence main.ts's before-quit handler drives via
    // StripWindow.releaseAppBarReservation(): detach BEFORE release, so ABM_REMOVE's
    // own display-metrics-changed (simulated below) can't reach a listener at all.
    reservation.detach();
    reservation.release();

    expect(appBar.releaseByValue).toHaveBeenCalledTimes(1);
    expect(appBar.releaseByValue).toHaveBeenCalledWith(0x42n);

    screenEvents.emit('display-metrics-changed');
    expect(onDisplaysChanged).not.toHaveBeenCalled();
    // No further reserve was ever attempted as a result of that event.
    expect(appBar.reserve).toHaveBeenCalledTimes(1);
  });

  it('(b) the "closed" path (StripWindow.cleanup, window already destroyed) still releases by the stored handle', () => {
    const appBar = makeFakeAppBar();
    const screenEvents = new EventEmitter();
    const { dipToScreenRect, screenToDipRect } = makeIdentityConversions();
    const reservation = new AppBarReservation({ appBar, screenEvents, dipToScreenRect, screenToDipRect });

    const onDisplaysChanged = vi.fn();
    reservation.attach(onDisplaysChanged);
    const hwnd = makeHwnd(0x77n);
    reservation.sync(makeDisplay(), 'bottom', 32, true, hwnd);

    // cleanup()'s order: detach the listeners, then release — mirrors strip.ts.
    // getNativeWindowHandle() is never called again here (the window is already
    // destroyed): release() must work from the value captured at reserve() time.
    reservation.detach();
    reservation.release();

    expect(appBar.releaseByValue).toHaveBeenCalledTimes(1);
    expect(appBar.releaseByValue).toHaveBeenCalledWith(0x77n);
  });

  it('(c) same for the destroy() path', () => {
    const appBar = makeFakeAppBar();
    const screenEvents = new EventEmitter();
    const { dipToScreenRect, screenToDipRect } = makeIdentityConversions();
    const reservation = new AppBarReservation({ appBar, screenEvents, dipToScreenRect, screenToDipRect });

    reservation.attach(vi.fn());
    const hwnd = makeHwnd(0x99n);
    reservation.sync(makeDisplay(), 'bottom', 32, true, hwnd);

    // destroy() calls cleanup(), which does the same detach-then-release as (b).
    reservation.detach();
    reservation.release();

    expect(appBar.releaseByValue).toHaveBeenCalledTimes(1);
    expect(appBar.releaseByValue).toHaveBeenCalledWith(0x99n);
  });

  it('(d) a conversion function that throws on the first reserve still releases by the stored handle, and the exception never escapes sync()', () => {
    const appBar = makeFakeAppBar();
    const screenEvents = new EventEmitter();
    const dipToScreenRect = vi.fn((rect: Rect) => rect);
    // The GRANT conversion (screenToDipRect) throws — the exact bug this fix round
    // targets: a successful OS-level reserve() whose post-processing then throws
    // must still leave the reservation releasable.
    const screenToDipRect = vi.fn(() => {
      throw new Error('boom: screenToDipRect failed');
    });
    const reservation = new AppBarReservation({ appBar, screenEvents, dipToScreenRect, screenToDipRect });

    const hwnd = makeHwnd(0xabn);
    expect(() => reservation.sync(makeDisplay(), 'bottom', 32, true, hwnd)).not.toThrow();

    // The reservation was released as part of handling the throw.
    expect(appBar.releaseByValue).toHaveBeenCalledTimes(1);
    expect(appBar.releaseByValue).toHaveBeenCalledWith(0xabn);
    expect(reservation.grantedRect).toBeUndefined();
  });

  it('(d2) a conversion function that throws on the REQUEST side (dipToScreenRect) also never escapes sync(), and never attempts reserve()', () => {
    const appBar = makeFakeAppBar();
    const screenEvents = new EventEmitter();
    const dipToScreenRect = vi.fn(() => {
      throw new Error('boom: dipToScreenRect failed');
    });
    const screenToDipRect = vi.fn(() => GRANTED_DIP);
    const reservation = new AppBarReservation({ appBar, screenEvents, dipToScreenRect, screenToDipRect });

    const hwnd = makeHwnd(0xcdn);
    expect(() => reservation.sync(makeDisplay(), 'bottom', 32, true, hwnd)).not.toThrow();

    expect(appBar.reserve).not.toHaveBeenCalled();
    expect(reservation.grantedRect).toBeUndefined();
  });

  it('(e) both conversion functions are used: dipToScreenRect for the request, screenToDipRect for the grant', () => {
    const appBar = makeFakeAppBar();
    const screenEvents = new EventEmitter();
    const dipToScreenRect = vi.fn((rect: Rect) => ({ ...rect, x: rect.x + 1000 }));
    const screenToDipRect = vi.fn(() => GRANTED_DIP);
    const reservation = new AppBarReservation({ appBar, screenEvents, dipToScreenRect, screenToDipRect });

    const d = makeDisplay();
    const hwnd = makeHwnd(0xefn);
    // 'top' edge so the DIP rect is flush to y=0 (bounds.y), keeping the expected
    // physical rect below simple; appBarRectDip's edge math itself is covered by
    // geometry.test.ts / win32.test.ts, not re-tested here.
    reservation.sync(d, 'top', 32, true, hwnd);

    // The request conversion ran on the DIP rect appBarRectDip computed for this
    // display/edge/height (x=0 before translation), and its result (translated by
    // +1000) is what was actually passed to reserve().
    expect(dipToScreenRect).toHaveBeenCalledWith({ x: 0, y: 0, width: 1366, height: 32 });
    expect(appBar.reserve).toHaveBeenCalledWith(hwnd, 'top', { left: 1000, top: 0, right: 2366, bottom: 32 });

    // The grant conversion ran on the granted rect reserve() returned.
    expect(screenToDipRect).toHaveBeenCalledWith({ x: 0, y: 0, width: 1366, height: 32 });
    expect(reservation.grantedRect).toEqual(GRANTED_DIP);
    expect(reservation.grantedRectFor(d.id)).toEqual(GRANTED_DIP);
    expect(reservation.grantedRectFor(d.id + 1)).toBeUndefined();
  });

  it('sync() with wantReserve: false releases any active reservation and skips reserve() entirely', () => {
    const appBar = makeFakeAppBar();
    const screenEvents = new EventEmitter();
    const { dipToScreenRect, screenToDipRect } = makeIdentityConversions();
    const reservation = new AppBarReservation({ appBar, screenEvents, dipToScreenRect, screenToDipRect });

    const hwnd = makeHwnd(0x11n);
    reservation.sync(makeDisplay(), 'bottom', 32, true, hwnd);
    expect(appBar.reserve).toHaveBeenCalledTimes(1);

    reservation.sync(makeDisplay(), 'bottom', 32, false);
    expect(appBar.releaseByValue).toHaveBeenCalledWith(0x11n);
    expect(reservation.grantedRect).toBeUndefined();
  });

  it('sync() is a no-op (no reserve call) when the signature has not changed', () => {
    const appBar = makeFakeAppBar();
    const screenEvents = new EventEmitter();
    const { dipToScreenRect, screenToDipRect } = makeIdentityConversions();
    const reservation = new AppBarReservation({ appBar, screenEvents, dipToScreenRect, screenToDipRect });

    const d = makeDisplay();
    const hwnd = makeHwnd(0x22n);
    reservation.sync(d, 'bottom', 32, true, hwnd);
    reservation.sync(d, 'bottom', 32, true, hwnd);
    reservation.sync(d, 'bottom', 32, true, hwnd);
    expect(appBar.reserve).toHaveBeenCalledTimes(1);
  });

  it('attach()/detach() are idempotent and detach() removes exactly the registered listener', () => {
    const screenEvents = new EventEmitter();
    const { dipToScreenRect, screenToDipRect } = makeIdentityConversions();
    const reservation = new AppBarReservation({ appBar: undefined, screenEvents, dipToScreenRect, screenToDipRect });

    const cb = vi.fn();
    reservation.attach(cb);
    reservation.attach(vi.fn()); // second attach before detach: no-op, original cb stays registered
    expect(screenEvents.listenerCount('display-added')).toBe(1);
    expect(screenEvents.listenerCount('display-removed')).toBe(1);
    expect(screenEvents.listenerCount('display-metrics-changed')).toBe(1);

    screenEvents.emit('display-added');
    expect(cb).toHaveBeenCalledTimes(1);

    reservation.detach();
    reservation.detach(); // idempotent
    expect(screenEvents.listenerCount('display-added')).toBe(0);
    expect(screenEvents.listenerCount('display-removed')).toBe(0);
    expect(screenEvents.listenerCount('display-metrics-changed')).toBe(0);
  });

  it('release() is a cheap no-op when nothing is reserved', () => {
    const appBar = makeFakeAppBar();
    const screenEvents = new EventEmitter();
    const { dipToScreenRect, screenToDipRect } = makeIdentityConversions();
    const reservation = new AppBarReservation({ appBar, screenEvents, dipToScreenRect, screenToDipRect });

    reservation.release();
    expect(appBar.releaseByValue).not.toHaveBeenCalled();
  });

  it('no appBar (win32 unavailable): sync() never calls reserve, and behaves as wantReserve: false', () => {
    const screenEvents = new EventEmitter();
    const { dipToScreenRect, screenToDipRect } = makeIdentityConversions();
    const reservation = new AppBarReservation({ appBar: undefined, screenEvents, dipToScreenRect, screenToDipRect });

    reservation.sync(makeDisplay(), 'bottom', 32, true, makeHwnd(0x1n));
    expect(reservation.grantedRect).toBeUndefined();
    expect(dipToScreenRect).not.toHaveBeenCalled();
  });

  it('a failed reserve() (returns undefined) does not remember a signature, so the next sync() retries', () => {
    const appBar = makeFakeAppBar({ reserve: vi.fn(() => undefined) });
    const screenEvents = new EventEmitter();
    const { dipToScreenRect, screenToDipRect } = makeIdentityConversions();
    const reservation = new AppBarReservation({ appBar, screenEvents, dipToScreenRect, screenToDipRect });

    const d = makeDisplay();
    reservation.sync(d, 'bottom', 32, true, makeHwnd(0x1n));
    reservation.sync(d, 'bottom', 32, true, makeHwnd(0x1n));
    expect(appBar.reserve).toHaveBeenCalledTimes(2);
    expect(reservation.grantedRect).toBeUndefined();
  });
});
