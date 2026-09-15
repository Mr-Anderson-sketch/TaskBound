import { test, expect } from '@playwright/test';
import { launchApp, windowInfo } from './launch';

test.setTimeout(60_000);

// Task 7.1: win32-only AppBar reservation + fullscreen detection. Skipped entirely
// on any other platform — koffi's win32 bindings simply don't exist there, and
// `capabilities.appBar`/`capabilities.fullscreenDetect` are always false by design.
test.skip(process.platform !== 'win32', 'win32-only: AppBar reservation and fullscreen detection (Task 7.1)');

type Tb = {
  store: { dispatch: (a: unknown) => number; get: () => { capabilities: { appBar: boolean; fullscreenDetect: boolean } } };
  strip: {
    isVisible: () => boolean;
    grantedRect: { x: number; y: number; width: number; height: number } | undefined;
    lastShape: { x: number; y: number; width: number; height: number } | undefined;
  };
  win32: {
    capabilities: { appBar: boolean; fullscreenDetect: boolean };
    setFullscreenStub: (value: boolean | undefined) => void;
    tick: () => void;
  };
};

function getTb() {
  return (globalThis as unknown as { __tb: Tb }).__tb;
}

test('capabilities are true on this Windows machine (koffi loads and every binding succeeds)', async () => {
  const launched = await launchApp();
  try {
    // The `__tb` test seam is only assigned once `app.whenReady().then(...)` has
    // run to completion; waiting for the strip window (created inside that same
    // callback) is what actually guarantees it exists before `evaluate` reads it.
    await launched.window('strip', 5000);

    const capabilities = await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: Tb }).__tb;
      return tb.store.get().capabilities;
    });
    expect(capabilities).toEqual({ appBar: true, fullscreenDetect: true });

    // Same value is also exposed directly on the win32 test seam.
    const seamCapabilities = await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: Tb }).__tb;
      return tb.win32.capabilities;
    });
    expect(seamCapabilities).toEqual({ appBar: true, fullscreenDetect: true });

    expect(launched.errors()).toEqual([]);
  } finally {
    await launched.close();
  }
});

// SAFETY (see task instructions): a leaked AppBar reservation shrinks the user's
// real desktop work area until they log out. This test releases in `finally`
// UNCONDITIONALLY — patches reserveSpace back to false and waits for the OS to
// actually restore the primary work area's height BEFORE closing the app, so even
// an assertion failure above never leaves the reservation behind.
test('reserveSpace shrinks the primary work area and the strip docks flush to the granted rect; disabling restores it', async () => {
  const launched = await launchApp();
  // Declared outside `try` (not `const` inside it) so the `finally` block below can
  // poll back to this exact value regardless of where in `try` an assertion failed.
  let originalHeight: number | undefined;
  try {
    await launched.window('strip', 5000);

    const before = await launched.app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
    originalHeight = before.height;

    await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: Tb }).__tb;
      tb.store.dispatch({ type: 'settings/patch', now: Date.now(), patch: { strip: { reserveSpace: true } } });
    });

    // The work area shrinks by (about) the strip's own content height within 3s.
    await expect
      .poll(async () => launched.app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea.height), { timeout: 3000 })
      .toBeLessThan(before.height);

    const after = await launched.app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
    const grantedRect = await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: Tb }).__tb;
      return tb.strip.grantedRect;
    });
    expect(grantedRect).toBeDefined();
    expect(Math.abs(before.height - after.height - grantedRect!.height)).toBeLessThanOrEqual(2);

    // The strip's own content (clipped via setShape — see StripWindow.lastShape)
    // sits flush against the GRANTED rect's bottom edge, not the (now-shrunk)
    // work area's bottom edge — ruling 4's whole point.
    const infos = await windowInfo(launched.app);
    const stripInfo = infos.find((w) => w.url.includes('#/strip'));
    expect(stripInfo).toBeDefined();
    const shape = await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: Tb }).__tb;
      return tb.strip.lastShape;
    });
    expect(shape).toBeDefined();
    const contentBottom = stripInfo!.bounds.y + shape!.y + shape!.height;
    expect(Math.abs(contentBottom - (grantedRect!.y + grantedRect!.height))).toBeLessThanOrEqual(2);

    expect(launched.errors()).toEqual([]);
  } finally {
    // SAFETY: patch reserveSpace back to false and WAIT for the OS to actually
    // restore the work area — unconditionally, even if an assertion above threw —
    // before closing the app. `before-quit` also releases (belt and suspenders),
    // but the poll below is the actual proof the reservation is gone. Wrapped in its
    // own try/catch so a failure here (e.g. the app already crashed) still reaches
    // `launched.close()` rather than leaking the Electron process too.
    try {
      await launched.app.evaluate(() => {
        const tb = (globalThis as unknown as { __tb: Tb }).__tb;
        tb.store.dispatch({ type: 'settings/patch', now: Date.now(), patch: { strip: { reserveSpace: false } } });
      });
      if (originalHeight !== undefined) {
        await expect
          .poll(async () => launched.app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea.height), { timeout: 5000 })
          .toBe(originalHeight);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('win32.spec.ts: failed to confirm the AppBar reservation was released before closing', err);
    }
    await launched.close();
  }
});

test('hideOverFullscreen: the watcher hides the strip when told a foreground app is fullscreen, and shows it again when told it is not', async () => {
  const launched = await launchApp();
  try {
    await launched.window('strip', 5000);

    const isVisible = () =>
      launched.app.evaluate(() => {
        const tb = (globalThis as unknown as { __tb: Tb }).__tb;
        return tb.strip.isVisible();
      });

    // hideOverFullscreen defaults to true (core/defaults.ts) and the strip defaults
    // to enabled — no settings/patch needed for the watcher's gate.
    await expect.poll(isVisible, { timeout: 5000 }).toBe(true);

    await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: Tb }).__tb;
      tb.win32.setFullscreenStub(true);
      tb.win32.tick();
    });
    await expect.poll(isVisible, { timeout: 2000 }).toBe(false);

    await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: Tb }).__tb;
      tb.win32.setFullscreenStub(false);
      tb.win32.tick();
    });
    await expect.poll(isVisible, { timeout: 2000 }).toBe(true);

    // Clear the stub so nothing lingers past this test.
    await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: Tb }).__tb;
      tb.win32.setFullscreenStub(undefined);
    });

    expect(launched.errors()).toEqual([]);
  } finally {
    await launched.close();
  }
});
