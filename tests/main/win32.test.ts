// tests/main/win32 — Task 7.1 (optional win32 AppBar reservation + fullscreen
// detection). Per the addendum's ruling 6, real Win32 functions and the real koffi
// module are never touched here: the loader's `load` parameter and every
// appbar/fullscreen/watcher dependency are fakes. Only geometry.ts's pure math runs
// unmocked.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadWin32 } from '../../src/main/win32';
import { appBarRect, rectPxToDip, isFullscreenRect, isShellClass, hwndValue } from '../../src/main/win32/geometry';
import { createAppBar } from '../../src/main/win32/appbar';
import type { AppBarDataIo } from '../../src/main/win32/appbar';
import { createFullscreen } from '../../src/main/win32/fullscreen';
import { FullscreenWatcher } from '../../src/main/win32/watcher';

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
    expect(typeof result!.fullscreen.isForegroundFullscreen).toBe('function');
    // Calling into the mocked bindings must not throw (GetForegroundWindow's stub
    // returns 0 -> "no foreground window" -> false, without any real Win32 call).
    expect(result!.fullscreen.isForegroundFullscreen([])).toBe(false);
  });
});

// --- geometry (pure) -----------------------------------------------------------------

describe('appBarRect', () => {
  it('at scale 1, bottom edge: full display width, flush to the physical bottom edge', () => {
    const d = { id: 1, bounds: { x: 0, y: 0, width: 1366, height: 768 }, workArea: { x: 0, y: 0, width: 1366, height: 720 }, scaleFactor: 1 };
    const rc = appBarRect(d, 'bottom', 32);
    expect(rc).toEqual({ left: 0, top: 768 - 32, right: 1366, bottom: 768 });
  });

  it('at scale 1, top edge: flush to the physical top edge', () => {
    const d = { id: 1, bounds: { x: 0, y: 0, width: 1366, height: 768 }, workArea: { x: 0, y: 0, width: 1366, height: 768 }, scaleFactor: 1 };
    const rc = appBarRect(d, 'top', 32);
    expect(rc).toEqual({ left: 0, top: 0, right: 1366, bottom: 32 });
  });

  it('at scale 1.25, scales every dimension and rounds', () => {
    const d = { id: 1, bounds: { x: 0, y: 0, width: 1366, height: 768 }, workArea: { x: 0, y: 0, width: 1366, height: 768 }, scaleFactor: 1.25 };
    const rc = appBarRect(d, 'bottom', 32);
    // 1366*1.25 = 1707.5 -> 1708 (rounded); 768*1.25 = 960; 32*1.25 = 40.
    expect(rc.left).toBe(0);
    expect(rc.right).toBe(1708);
    expect(rc.bottom).toBe(960);
    expect(rc.top).toBe(960 - 40);
  });

  it('at scale 1.5 on a secondary display with a non-zero bounds.x, offsets and scales left/right together', () => {
    const d = { id: 2, bounds: { x: 1366, y: 0, width: 1280, height: 720 }, workArea: { x: 1366, y: 0, width: 1280, height: 720 }, scaleFactor: 1.5 };
    const rc = appBarRect(d, 'top', 32);
    expect(rc.left).toBe(Math.round(1366 * 1.5));
    expect(rc.right).toBe(Math.round((1366 + 1280) * 1.5));
    expect(rc.top).toBe(0);
    expect(rc.bottom).toBe(Math.round(32 * 1.5));
  });
});

describe('rectPxToDip', () => {
  it('is the inverse of appBarRect at scale 1', () => {
    const rc = { left: 0, top: 688, right: 1366, bottom: 720 };
    expect(rectPxToDip(rc, 1)).toEqual({ x: 0, y: 688, width: 1366, height: 32 });
  });

  it('divides by scaleFactor and rounds', () => {
    const rc = { left: 0, top: 960 - 40, right: 1708, bottom: 960 };
    const dip = rectPxToDip(rc, 1.25);
    expect(dip.width).toBe(Math.round(1708 / 1.25));
    expect(dip.height).toBe(32);
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
    const appBar = createAppBar({ cbSize: 40, shAppBarMessage });

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
    const appBar = createAppBar({ cbSize: 40, shAppBarMessage });
    const rectPx = { left: 0, top: 0, right: 1366, bottom: 32 };
    const result = appBar.reserve(makeHwnd(0x6n), 'top', rectPx);
    // top: 0 -> 8; bottom re-derived to restore the 32px height: 8 + 32 = 40.
    expect(result).toEqual({ granted: { left: 0, top: 8, right: 1366, bottom: 40 } });
  });

  it('reserve(): a no-op QUERYPOS (nothing else registered on this edge) leaves the requested rect unchanged', () => {
    const shAppBarMessage = vi.fn(() => 1); // never mutates rc
    const appBar = createAppBar({ cbSize: 40, shAppBarMessage });
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
    const appBar = createAppBar({ cbSize: 40, shAppBarMessage });
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
    const appBar = createAppBar({ cbSize: 40, shAppBarMessage });
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
    const appBar = createAppBar({ cbSize: 40, shAppBarMessage });
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
    const appBar = createAppBar({ cbSize: 40, shAppBarMessage });
    appBar.release(makeHwnd(0x5n));
    expect(shAppBarMessage).not.toHaveBeenCalled();
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
