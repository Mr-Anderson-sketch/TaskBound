// tests/main/win32 — Task 7.1 (optional win32 AppBar reservation + fullscreen
// detection). Per the addendum's ruling 6, real Win32 functions and the real koffi
// module are never touched here: the loader's `load` parameter and every
// appbar/fullscreen/watcher dependency are fakes. Only geometry.ts's pure math runs
// unmocked.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadWin32 } from '../../src/main/win32';
import {
  appBarRectDip,
  appBarSignature,
  rectPxToRect,
  rectToRectPx,
  isFullscreenRect,
  isShellClass,
  hwndValue
} from '../../src/main/win32/geometry';
import { createAppBar } from '../../src/main/win32/appbar';
import type { AppBarDataIo } from '../../src/main/win32/appbar';
import { createFullscreen } from '../../src/main/win32/fullscreen';
import { FullscreenWatcher } from '../../src/main/win32/watcher';

// Every `createAppBar` call below needs a `callbackMessageId` (fix round 1, M-4) —
// its exact value is irrelevant to these pure-sequencing tests (only `index.ts`'s
// real `RegisterWindowMessageW` binding matters in production), so a fixed constant
// stands in for it everywhere here.
const TEST_CALLBACK_MESSAGE_ID = 0x8037;

async function withPlatform(platform: NodeJS.Platform, fn: () => void | Promise<void>): Promise<void> {
  const original = process.platform;
  Object.defineProperty(process, 'platform', { value: platform });
  try {
    await fn();
  } finally {
    Object.defineProperty(process, 'platform', { value: original });
  }
}

// --- loader ------------------------------------------------------------------------

describe('loadWin32', () => {
  it('returns undefined on a non-win32 platform, without ever calling `load`', async () => {
    const load = vi.fn(async () => ({}));
    await withPlatform('darwin', async () => {
      const result = await loadWin32(load as unknown as () => Promise<unknown>);
      expect(result).toBeUndefined();
    });
    expect(load).not.toHaveBeenCalled();
  });

  it('returns undefined when the loader throws (koffi missing or failing to import)', async () => {
    let result: unknown = 'not yet set';
    await withPlatform('win32', async () => {
      result = await loadWin32(async () => {
        throw new Error('Cannot find module koffi');
      });
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined when a binding call throws (e.g. a DLL function is missing)', async () => {
    let result: unknown = 'not yet set';
    await withPlatform('win32', async () => {
      const fakeKoffi = {
        load: () => {
          throw new Error('user32.dll not found');
        },
        struct: vi.fn(),
        sizeof: vi.fn()
      };
      result = await loadWin32(async () => ({ default: fakeKoffi }));
    });
    expect(result).toBeUndefined();
  });

  it('on win32, with a fully-mocked koffi module, returns a usable Win32 object built entirely from the mock', async () => {
    let result: Awaited<ReturnType<typeof loadWin32>>;
    await withPlatform('win32', async () => {
      const funcCalls: string[] = [];
      const fakeLib = {
        func: (def: string) => {
          funcCalls.push(def);
          // A single generic stub covers every function this loader binds: it never
          // needs to do anything real, only exist and be callable without throwing.
          return (..._args: unknown[]) => 0;
        }
      };
      const fakeKoffi = {
        load: () => fakeLib,
        struct: (_name: string, def: unknown) => def,
        sizeof: () => 40
      };
      result = await loadWin32(async () => ({ default: fakeKoffi }));
      expect(funcCalls.some((d) => d.includes('SHAppBarMessage'))).toBe(true);
      expect(funcCalls.some((d) => d.includes('GetForegroundWindow'))).toBe(true);
    });
    expect(result).toBeDefined();
    expect(typeof result!.appBar.reserve).toBe('function');
    expect(typeof result!.appBar.release).toBe('function');
    expect(typeof result!.appBar.releaseByValue).toBe('function');
    expect(typeof result!.fullscreen.isForegroundFullscreen).toBe('function');
    // Calling into the mocked bindings must not throw (GetForegroundWindow's stub
    // returns 0 -> "no foreground window" -> false, without any real Win32 call).
    expect(result!.fullscreen.isForegroundFullscreen([])).toBe(false);
  });

  // Fix round 1 (M-3): idempotent — relies on the PRECEDING test in this file having
  // already loaded successfully (module-level cache in src/main/win32/index.ts), so
  // this call reuses that cached `Win32` object instead of invoking `loader` at all —
  // proving `loadWin32` never re-registers a koffi struct name (which throws on a
  // real `koffi` module if attempted twice) on a second call.
  it('is idempotent: a call after an already-successful load reuses the cached result and never invokes the new loader', async () => {
    await withPlatform('win32', async () => {
      const loader = vi.fn(async () => {
        throw new Error(
          'should never be invoked — the preceding test in this file already loaded successfully and loadWin32 must reuse that cached result'
        );
      });
      const result = await loadWin32(loader as unknown as () => Promise<unknown>);
      expect(loader).not.toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(typeof result!.appBar.reserve).toBe('function');
    });
  });
});

// --- geometry (pure) -----------------------------------------------------------------

describe('appBarRectDip', () => {
  it('bottom edge: full display width, flush to the physical bottom edge (DIP units)', () => {
    const d = { id: 1, bounds: { x: 0, y: 0, width: 1366, height: 768 }, workArea: { x: 0, y: 0, width: 1366, height: 720 }, scaleFactor: 1 };
    const rc = appBarRectDip(d, 'bottom', 32);
    expect(rc).toEqual({ x: 0, y: 768 - 32, width: 1366, height: 32 });
  });

  it('top edge: flush to the physical top edge', () => {
    const d = { id: 1, bounds: { x: 0, y: 0, width: 1366, height: 768 }, workArea: { x: 0, y: 0, width: 1366, height: 768 }, scaleFactor: 1 };
    const rc = appBarRectDip(d, 'top', 32);
    expect(rc).toEqual({ x: 0, y: 0, width: 1366, height: 32 });
  });

  // I-1 (fix round 1): the OLD `appBarRect` multiplied every dimension by
  // `display.scaleFactor` here — WRONG for a secondary display with a different
  // scale factor than the primary, since Windows' per-monitor DPI virtualization does
  // NOT place a secondary monitor's physical origin at `dipOrigin * itsOwnScaleFactor`
  // (that conversion is now `StripWindow`'s job, via the OS-correct, injectable
  // `screen.dipToScreenRect`/`screenToDipRect` — see win32.spec.ts and strip.ts's
  // `syncAppBar`). This function stays in DIPs regardless of `scaleFactor`: a
  // high-DPI secondary display's rect here is identical in SHAPE to a scale-1
  // display's, just offset by its own `bounds.x`/`bounds.y` — no multiplication.
  it('a secondary display with a non-zero bounds.x and a different scale factor stays in pure DIPs (no scaling)', () => {
    const d = { id: 2, bounds: { x: 1366, y: 0, width: 1280, height: 720 }, workArea: { x: 1366, y: 0, width: 1280, height: 720 }, scaleFactor: 1.5 };
    const rc = appBarRectDip(d, 'top', 32);
    expect(rc).toEqual({ x: 1366, y: 0, width: 1280, height: 32 });
  });
});

describe('rectPxToRect / rectToRectPx', () => {
  it('rectPxToRect converts a Win32 RECT (left/top/right/bottom) to x/y/width/height', () => {
    expect(rectPxToRect({ left: 0, top: 688, right: 1366, bottom: 720 })).toEqual({ x: 0, y: 688, width: 1366, height: 32 });
  });

  it('rectToRectPx is the exact inverse — no scaling, pure reshaping', () => {
    const rect = { x: 0, y: 688, width: 1366, height: 32 };
    expect(rectToRectPx(rect)).toEqual({ left: 0, top: 688, right: 1366, bottom: 720 });
    expect(rectPxToRect(rectToRectPx(rect))).toEqual(rect);
  });
});

describe('appBarSignature', () => {
  const d = { id: 1, bounds: { x: 0, y: 0, width: 1366, height: 768 }, workArea: { x: 0, y: 0, width: 1366, height: 720 }, scaleFactor: 1 };

  it('is stable for the same display/edge/height', () => {
    expect(appBarSignature(d, 'bottom', 32)).toBe(appBarSignature({ ...d }, 'bottom', 32));
  });

  it('changes when the edge or the content height changes', () => {
    const base = appBarSignature(d, 'bottom', 32);
    expect(appBarSignature(d, 'top', 32)).not.toBe(base);
    expect(appBarSignature(d, 'bottom', 40)).not.toBe(base);
  });

  // I-2 (fix round 1): a display metrics change that leaves `id` untouched (a
  // resolution change, a monitor rearranged in the OS's display settings) must still
  // change the signature, so `StripWindow.syncAppBar` re-reserves instead of leaving
  // a STALE grant (sized/positioned for the display's previous metrics) in place.
  it('changes when bounds change but the id stays the same', () => {
    const base = appBarSignature(d, 'bottom', 32);
    const moved = { ...d, bounds: { ...d.bounds, width: 1920 } };
    expect(appBarSignature(moved, 'bottom', 32)).not.toBe(base);
  });

  it('changes when scaleFactor changes but the id and bounds stay the same', () => {
    const base = appBarSignature(d, 'bottom', 32);
    const rescaled = { ...d, scaleFactor: 1.5 };
    expect(appBarSignature(rescaled, 'bottom', 32)).not.toBe(base);
  });
});

describe('isFullscreenRect', () => {
  const monitor = { left: 0, top: 0, right: 1920, bottom: 1080 };

  it('true when the window rect exactly equals the monitor rect', () => {
    expect(isFullscreenRect({ ...monitor }, monitor)).toBe(true);
  });

  it('true within the default 1px tolerance', () => {
    expect(isFullscreenRect({ left: 1, top: 0, right: 1920, bottom: 1079 }, monitor)).toBe(true);
  });

  it('false beyond the tolerance on any single edge', () => {
    expect(isFullscreenRect({ left: 2, top: 0, right: 1920, bottom: 1080 }, monitor)).toBe(false);
    expect(isFullscreenRect({ left: 0, top: 0, right: 1918, bottom: 1080 }, monitor)).toBe(false);
  });

  it('respects a custom tolerance', () => {
    const rect = { left: 5, top: 5, right: 1915, bottom: 1075 };
    expect(isFullscreenRect(rect, monitor, 5)).toBe(true);
    expect(isFullscreenRect(rect, monitor, 4)).toBe(false);
  });
});

describe('isShellClass', () => {
  it('true for every known shell class', () => {
    expect(isShellClass('Progman')).toBe(true);
    expect(isShellClass('WorkerW')).toBe(true);
    expect(isShellClass('Shell_TrayWnd')).toBe(true);
    expect(isShellClass('Shell_SecondaryTrayWnd')).toBe(true);
  });

  it('false for an ordinary app window class', () => {
    expect(isShellClass('Chrome_WidgetWin_1')).toBe(false);
    expect(isShellClass('')).toBe(false);
  });
});

describe('hwndValue', () => {
  it('reads a little-endian 64-bit handle from an 8-byte buffer', () => {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(0x00000000_00abcdefn, 0);
    expect(hwndValue(buf)).toBe(0x00000000_00abcdefn);
  });

  it('reads a little-endian 32-bit handle from a 4-byte buffer (ia32)', () => {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(0x1234, 0);
    expect(hwndValue(buf)).toBe(0x1234n);
  });
});

// --- appbar.ts (pure sequencing over an injected shAppBarMessage) -------------------

describe('createAppBar', () => {
  function makeHwnd(value: bigint): Buffer {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(value, 0);
    return buf;
  }

  it('reserve(): sends ABM_NEW once, then ABM_QUERYPOS, then ABM_SETPOS, and returns the granted rect', () => {
    const calls: { msg: number; data: AppBarDataIo }[] = [];
    const shAppBarMessage = vi.fn((dwMessage: number, data: AppBarDataIo) => {
      calls.push({ msg: dwMessage, data: { ...data, rc: { ...data.rc } } });
      if (dwMessage === 0x2 /* ABM_QUERYPOS */) {
        data.rc = { ...data.rc, bottom: data.rc.bottom - 5 }; // simulate Windows shrinking it
      }
      return 1;
    });
    const appBar = createAppBar({ cbSize: 40, shAppBarMessage, callbackMessageId: TEST_CALLBACK_MESSAGE_ID });

    const rectPx = { left: 0, top: 688, right: 1366, bottom: 720 };
    const result = appBar.reserve(makeHwnd(0x1n), 'bottom', rectPx);

    expect(calls.map((c) => c.msg)).toEqual([0x0 /* ABM_NEW */, 0x2 /* ABM_QUERYPOS */, 0x3 /* ABM_SETPOS */]);
    // QUERYPOS's fake shrinks `bottom` (720 -> 715), the "variable" edge for a
    // bottom-docked bar — `reserve()` then re-derives `top` from that adjusted
    // `bottom` to restore the original 32px height (715 - 32 = 683), the standard
    // two-step AppBar dance (see appbar.ts's `reserve` doc comment).
    expect(result).toEqual({ granted: { left: 0, top: 683, right: 1366, bottom: 715 } });
  });

  it('reserve(): top edge re-derives `bottom` from a QUERYPOS-adjusted `top`', () => {
    const shAppBarMessage = vi.fn((dwMessage: number, data: AppBarDataIo) => {
      if (dwMessage === 0x2 /* ABM_QUERYPOS */) {
        data.rc = { ...data.rc, top: data.rc.top + 8 }; // simulate Windows pushing it down
      }
      return 1;
    });
    const appBar = createAppBar({ cbSize: 40, shAppBarMessage, callbackMessageId: TEST_CALLBACK_MESSAGE_ID });
    const rectPx = { left: 0, top: 0, right: 1366, bottom: 32 };
    const result = appBar.reserve(makeHwnd(0x6n), 'top', rectPx);
    // top: 0 -> 8; bottom re-derived to restore the 32px height: 8 + 32 = 40.
    expect(result).toEqual({ granted: { left: 0, top: 8, right: 1366, bottom: 40 } });
  });

  it('reserve(): a no-op QUERYPOS (nothing else registered on this edge) leaves the requested rect unchanged', () => {
    const shAppBarMessage = vi.fn(() => 1); // never mutates rc
    const appBar = createAppBar({ cbSize: 40, shAppBarMessage, callbackMessageId: TEST_CALLBACK_MESSAGE_ID });
    const rectPx = { left: 0, top: 688, right: 1366, bottom: 720 };
    const result = appBar.reserve(makeHwnd(0x7n), 'bottom', rectPx);
    expect(result).toEqual({ granted: rectPx });
  });

  it('reserve(): a second call for the SAME hwnd skips ABM_NEW (only re-runs QUERYPOS/SETPOS)', () => {
    const calls: number[] = [];
    const shAppBarMessage = vi.fn((dwMessage: number, _data: AppBarDataIo) => {
      calls.push(dwMessage);
      return 1;
    });
    const appBar = createAppBar({ cbSize: 40, shAppBarMessage, callbackMessageId: TEST_CALLBACK_MESSAGE_ID });
    const rectPx = { left: 0, top: 688, right: 1366, bottom: 720 };
    const hwnd = makeHwnd(0x2n);

    appBar.reserve(hwnd, 'bottom', rectPx);
    calls.length = 0;
    appBar.reserve(hwnd, 'bottom', rectPx);

    expect(calls).toEqual([0x2 /* ABM_QUERYPOS */, 0x3 /* ABM_SETPOS */]);
  });

  it('reserve(): returns undefined when ABM_NEW fails, and never sends QUERYPOS/SETPOS', () => {
    const calls: number[] = [];
    const shAppBarMessage = vi.fn((dwMessage: number, _data: AppBarDataIo) => {
      calls.push(dwMessage);
      return 0; // ABM_NEW failed
    });
    const appBar = createAppBar({ cbSize: 40, shAppBarMessage, callbackMessageId: TEST_CALLBACK_MESSAGE_ID });
    const result = appBar.reserve(makeHwnd(0x3n), 'bottom', { left: 0, top: 0, right: 1366, bottom: 32 });
    expect(result).toBeUndefined();
    expect(calls).toEqual([0x0]);
  });

  it('release(): sends ABM_REMOVE for a registered hwnd, and is idempotent (no second call)', () => {
    const calls: number[] = [];
    const shAppBarMessage = vi.fn((dwMessage: number, _data: AppBarDataIo) => {
      calls.push(dwMessage);
      return 1;
    });
    const appBar = createAppBar({ cbSize: 40, shAppBarMessage, callbackMessageId: TEST_CALLBACK_MESSAGE_ID });
    const hwnd = makeHwnd(0x4n);
    appBar.reserve(hwnd, 'bottom', { left: 0, top: 0, right: 1366, bottom: 32 });
    calls.length = 0;

    appBar.release(hwnd);
    expect(calls).toEqual([0x1 /* ABM_REMOVE */]);

    calls.length = 0;
    appBar.release(hwnd); // idempotent: never registered again since the first release
    expect(calls).toEqual([]);
  });

  it('release(): a no-op (sends nothing) for an hwnd that was never reserved', () => {
    const shAppBarMessage = vi.fn(() => 1);
    const appBar = createAppBar({ cbSize: 40, shAppBarMessage, callbackMessageId: TEST_CALLBACK_MESSAGE_ID });
    appBar.release(makeHwnd(0x5n));
    expect(shAppBarMessage).not.toHaveBeenCalled();
  });

  // Fix round 1 (C-1): `releaseByValue` is what `StripWindow`'s `closed`/`destroy`
  // cleanup calls — the whole point is that it works from just the raw handle VALUE,
  // with no `Buffer`/live `BrowserWindow` involved at all.
  it('releaseByValue(): sends ABM_REMOVE for a registered hwnd VALUE, and is idempotent', () => {
    const calls: number[] = [];
    const shAppBarMessage = vi.fn((dwMessage: number, _data: AppBarDataIo) => {
      calls.push(dwMessage);
      return 1;
    });
    const appBar = createAppBar({ cbSize: 40, shAppBarMessage, callbackMessageId: TEST_CALLBACK_MESSAGE_ID });
    const value = 0x8n;
    appBar.reserve(makeHwnd(value), 'bottom', { left: 0, top: 0, right: 1366, bottom: 32 });
    calls.length = 0;

    appBar.releaseByValue(value);
    expect(calls).toEqual([0x1 /* ABM_REMOVE */]);

    calls.length = 0;
    appBar.releaseByValue(value); // idempotent
    expect(calls).toEqual([]);
  });

  it('releaseByValue(): a no-op for a value that was never reserved', () => {
    const shAppBarMessage = vi.fn(() => 1);
    const appBar = createAppBar({ cbSize: 40, shAppBarMessage, callbackMessageId: TEST_CALLBACK_MESSAGE_ID });
    appBar.releaseByValue(0x9n);
    expect(shAppBarMessage).not.toHaveBeenCalled();
  });

  it('reserve() then release() then releaseByValue() for the SAME value: the second (releaseByValue) is a no-op', () => {
    const calls: number[] = [];
    const shAppBarMessage = vi.fn((dwMessage: number, _data: AppBarDataIo) => {
      calls.push(dwMessage);
      return 1;
    });
    const appBar = createAppBar({ cbSize: 40, shAppBarMessage, callbackMessageId: TEST_CALLBACK_MESSAGE_ID });
    const value = 0xan;
    appBar.reserve(makeHwnd(value), 'bottom', { left: 0, top: 0, right: 1366, bottom: 32 });
    calls.length = 0;

    appBar.release(makeHwnd(value));
    expect(calls).toEqual([0x1]);

    calls.length = 0;
    appBar.releaseByValue(value);
    expect(calls).toEqual([]);
  });
});

// --- fullscreen.ts (pure orchestration over injected Win32 calls) ------------------

describe('createFullscreen', () => {
  const monitorRect = { left: 0, top: 0, right: 1920, bottom: 1080 };
  const fullscreenWindowRect = { ...monitorRect };
  const windowedRect = { left: 100, top: 100, right: 900, bottom: 700 };

  function baseDeps(overrides: Partial<Parameters<typeof createFullscreen>[0]> = {}) {
    return {
      getForegroundWindow: () => 0x100n,
      getWindowRect: () => fullscreenWindowRect,
      monitorFromWindow: () => 0x9n,
      getMonitorRect: () => monitorRect,
      getClassName: () => 'SomeApp',
      getShellWindow: () => 0x999n,
      getDesktopWindow: () => 0x998n,
      ...overrides
    };
  }

  it('true when the foreground window fills its monitor', () => {
    const fs = createFullscreen(baseDeps());
    expect(fs.isForegroundFullscreen([])).toBe(true);
  });

  it('false when the foreground window does not fill its monitor', () => {
    const fs = createFullscreen(baseDeps({ getWindowRect: () => windowedRect }));
    expect(fs.isForegroundFullscreen([])).toBe(false);
  });

  it('false when there is no foreground window', () => {
    const fs = createFullscreen(baseDeps({ getForegroundWindow: () => 0n }));
    expect(fs.isForegroundFullscreen([])).toBe(false);
  });

  it('false when the foreground window is one of ours (the strip must never hide itself)', () => {
    const fs = createFullscreen(baseDeps());
    const own = Buffer.alloc(8);
    own.writeBigUInt64LE(0x100n, 0);
    expect(fs.isForegroundFullscreen([own])).toBe(false);
  });

  it('false when the foreground window IS the shell window (by handle)', () => {
    const fs = createFullscreen(baseDeps({ getForegroundWindow: () => 0x999n }));
    expect(fs.isForegroundFullscreen([])).toBe(false);
  });

  it('false when the foreground window IS the desktop window (by handle)', () => {
    const fs = createFullscreen(baseDeps({ getForegroundWindow: () => 0x998n }));
    expect(fs.isForegroundFullscreen([])).toBe(false);
  });

  it('false when the foreground window class is a shell class', () => {
    const fs = createFullscreen(baseDeps({ getClassName: () => 'Shell_TrayWnd' }));
    expect(fs.isForegroundFullscreen([])).toBe(false);
  });

  it('false when GetWindowRect fails', () => {
    const fs = createFullscreen(baseDeps({ getWindowRect: () => undefined }));
    expect(fs.isForegroundFullscreen([])).toBe(false);
  });

  it('false when GetMonitorInfoW fails', () => {
    const fs = createFullscreen(baseDeps({ getMonitorRect: () => undefined }));
    expect(fs.isForegroundFullscreen([])).toBe(false);
  });
});

// --- watcher.ts (fake scheduler, no real timers) ------------------------------------

/** A tiny fake `setInterval`/`clearInterval` pair, matching this codebase's existing
 * convention (see tests/main/clock.test.ts's `makeFakeScheduler`) of hand-rolled
 * fake schedulers over vitest's global fake timers. */
function makeFakeIntervalScheduler() {
  let nextHandle = 1;
  const pending = new Map<number, { fn: () => void; ms: number }>();
  return {
    setInterval: (fn: () => void, ms: number): unknown => {
      const handle = nextHandle++;
      pending.set(handle, { fn, ms });
      return handle;
    },
    clearInterval: (handle: unknown): void => {
      pending.delete(handle as number);
    },
    fireAll: (): void => {
      for (const { fn } of pending.values()) fn();
    },
    pendingCount: (): number => pending.size
  };
}

describe('FullscreenWatcher', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not poll until start() is called', () => {
    const scheduler = makeFakeIntervalScheduler();
    let fullscreen = false;
    const watcher = new FullscreenWatcher({
      isFullscreen: () => fullscreen,
      setInterval: scheduler.setInterval,
      clearInterval: scheduler.clearInterval,
      onEnter: vi.fn(),
      onExit: vi.fn()
    });
    expect(watcher.running).toBe(false);
    expect(scheduler.pendingCount()).toBe(0);
    fullscreen = true;
    scheduler.fireAll(); // nothing pending -> no-op
    expect(watcher.running).toBe(false);
  });

  it('fires onEnter exactly once on the transition into fullscreen, not on every subsequent tick', () => {
    const scheduler = makeFakeIntervalScheduler();
    let fullscreen = false;
    const onEnter = vi.fn();
    const onExit = vi.fn();
    const watcher = new FullscreenWatcher({
      isFullscreen: () => fullscreen,
      setInterval: scheduler.setInterval,
      clearInterval: scheduler.clearInterval,
      onEnter,
      onExit
    });
    watcher.start(2000);
    expect(watcher.running).toBe(true);

    scheduler.fireAll(); // still not fullscreen
    expect(onEnter).not.toHaveBeenCalled();

    fullscreen = true;
    scheduler.fireAll();
    scheduler.fireAll();
    scheduler.fireAll();
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
  });

  it('fires onExit exactly once on the transition OUT of fullscreen', () => {
    const scheduler = makeFakeIntervalScheduler();
    let fullscreen = true;
    const onEnter = vi.fn();
    const onExit = vi.fn();
    const watcher = new FullscreenWatcher({
      isFullscreen: () => fullscreen,
      setInterval: scheduler.setInterval,
      clearInterval: scheduler.clearInterval,
      onEnter,
      onExit
    });
    watcher.start();
    scheduler.fireAll();
    expect(onEnter).toHaveBeenCalledTimes(1);

    fullscreen = false;
    scheduler.fireAll();
    scheduler.fireAll();
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('stop() halts polling: no further onEnter/onExit even if isFullscreen changes', () => {
    const scheduler = makeFakeIntervalScheduler();
    let fullscreen = false;
    const onEnter = vi.fn();
    const watcher = new FullscreenWatcher({
      isFullscreen: () => fullscreen,
      setInterval: scheduler.setInterval,
      clearInterval: scheduler.clearInterval,
      onEnter,
      onExit: vi.fn()
    });
    watcher.start();
    watcher.stop();
    expect(watcher.running).toBe(false);
    expect(scheduler.pendingCount()).toBe(0);

    fullscreen = true;
    scheduler.fireAll(); // nothing pending
    expect(onEnter).not.toHaveBeenCalled();
  });

  // M-1 (fix round 1): stop() while genuinely mid-fullscreen must not leave the
  // strip stuck auto-hidden forever — there is no more polling left to ever notice
  // the fullscreen app closing, so stop() itself must fire the exit.
  it('stop() while in fullscreen resets state and fires onExit exactly once, so the strip is not left auto-hidden', () => {
    const scheduler = makeFakeIntervalScheduler();
    let fullscreen = true;
    const onEnter = vi.fn();
    const onExit = vi.fn();
    const watcher = new FullscreenWatcher({
      isFullscreen: () => fullscreen,
      setInterval: scheduler.setInterval,
      clearInterval: scheduler.clearInterval,
      onEnter,
      onExit
    });
    watcher.start();
    scheduler.fireAll();
    expect(onEnter).toHaveBeenCalledTimes(1);

    watcher.stop();
    expect(onExit).toHaveBeenCalledTimes(1);

    // A later start()+tick(), still fullscreen, fires onEnter again — proof
    // `inFullscreen` was actually reset to false by stop(), not just that onExit
    // happened to be called once more on top of an unchanged internal state.
    watcher.start();
    scheduler.fireAll();
    expect(onEnter).toHaveBeenCalledTimes(2);
  });

  it('stop() while NOT in fullscreen does not fire onExit (unchanged behaviour)', () => {
    const scheduler = makeFakeIntervalScheduler();
    const onExit = vi.fn();
    const watcher = new FullscreenWatcher({
      isFullscreen: () => false,
      setInterval: scheduler.setInterval,
      clearInterval: scheduler.clearInterval,
      onEnter: vi.fn(),
      onExit
    });
    watcher.start();
    scheduler.fireAll();
    watcher.stop();
    expect(onExit).not.toHaveBeenCalled();
  });

  it('stop() when never started is a harmless no-op (does not fire onExit)', () => {
    const scheduler = makeFakeIntervalScheduler();
    const onExit = vi.fn();
    const watcher = new FullscreenWatcher({
      isFullscreen: () => true,
      setInterval: scheduler.setInterval,
      clearInterval: scheduler.clearInterval,
      onEnter: vi.fn(),
      onExit
    });
    watcher.stop();
    expect(onExit).not.toHaveBeenCalled();
  });

  it('start() is idempotent: a second start() does not schedule a second timer', () => {
    const scheduler = makeFakeIntervalScheduler();
    const watcher = new FullscreenWatcher({
      isFullscreen: () => false,
      setInterval: scheduler.setInterval,
      clearInterval: scheduler.clearInterval,
      onEnter: vi.fn(),
      onExit: vi.fn()
    });
    watcher.start();
    watcher.start();
    expect(scheduler.pendingCount()).toBe(1);
  });

  it('a user toggle-hide surviving a fullscreen exit is the composing caller\'s job, not the watcher\'s: onExit still fires even if the caller chooses not to act on it', () => {
    // This documents the contract (addendum ruling 5): the watcher only reports
    // enter/exit transitions. StripWindow.setAutoHidden is what actually decides
    // whether the strip becomes visible again, composing with any separate
    // user-driven hide — that composition is exercised by e2e/win32.spec.ts against
    // the real StripWindow, not re-implemented here against a fake.
    const scheduler = makeFakeIntervalScheduler();
    let fullscreen = true;
    let visible = false; // pretend the user separately hid the strip and it stays hidden
    const watcher = new FullscreenWatcher({
      isFullscreen: () => fullscreen,
      setInterval: scheduler.setInterval,
      clearInterval: scheduler.clearInterval,
      onEnter: () => {
        visible = false;
      },
      onExit: () => {
        // A real caller (StripWindow.setAutoHidden) would only show it here if no
        // OTHER reason is still hiding it; this fake caller simulates "user hid it
        // too" by intentionally not setting `visible = true`.
      }
    });
    watcher.start();
    scheduler.fireAll();
    expect(visible).toBe(false);
    fullscreen = false;
    scheduler.fireAll();
    expect(visible).toBe(false); // stayed hidden — the fake caller chose not to show it
  });
});
