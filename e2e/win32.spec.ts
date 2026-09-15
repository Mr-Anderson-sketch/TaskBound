import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { launchApp, windowInfo } from './launch';

const execFileAsync = promisify(execFile);

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

// Fix round 1 (C-1): reads the PRIMARY display's work-area height directly from the
// OS via PowerShell, from the Playwright TEST process — not `app.evaluate` (Electron
// `screen` module), which the new "quitting..." test below needs AFTER the app
// process has already exited (`app.close()`), when there is no more `app.evaluate`
// to call. Matches this task's SAFETY protocol (`[System.Windows.Forms.Screen]`).
async function primaryWorkAreaHeight(): Promise<number> {
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-Command',
    "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea.Height"
  ]);
  const n = parseInt(stdout.trim(), 10);
  if (Number.isNaN(n)) throw new Error(`win32.spec.ts: could not parse PowerShell work-area output: ${JSON.stringify(stdout)}`);
  return n;
}

async function pollPrimaryWorkAreaHeight(expected: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = NaN;
  while (Date.now() < deadline) {
    last = await primaryWorkAreaHeight();
    if (last === expected) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(
    `win32.spec.ts: primary work area height did not return to ${expected} within ${timeoutMs}ms (last seen: ${last})`
  );
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

    // I-4 (fix round 1): "disabling restores the work area" is asserted HERE, inside
    // `try` — it is a real assertion this test can fail on, not just something the
    // `finally` safety net below happens to also do on the way out.
    await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: Tb }).__tb;
      tb.store.dispatch({ type: 'settings/patch', now: Date.now(), patch: { strip: { reserveSpace: false } } });
    });
    await expect
      .poll(async () => launched.app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea.height), { timeout: 3000 })
      .toBe(originalHeight);

    expect(launched.errors()).toEqual([]);
  } finally {
    // SAFETY NET: patch reserveSpace back to false and WAIT for the OS to actually
    // restore the work area — unconditionally, even if an assertion above (including
    // the disable-and-restore assertion itself) threw before this point — before
    // closing the app. Redundant with the `try` block on the happy path; this is what
    // actually matters when something up there failed. Wrapped in its own try/catch
    // so a failure here (e.g. the app already crashed) still reaches
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

// C-1 (fix round 1): quitting with `reserveSpace` on used to be able to leak the
// AppBar reservation forever — `before-quit` released it, but `settings.reserveSpace`
// stayed true and `ABM_REMOVE`'s own `display-metrics-changed` event re-entered
// `redock -> syncAppBar`, which re-reserved on the spot (and the window's `closed`
// cleanup then skipped `ABM_REMOVE` a second time because the window already reported
// destroyed). This test exercises the REAL quit path end to end: enable
// `reserveSpace`, quit normally via `app.close()` WITHOUT turning the setting off
// first (the exact scenario that used to leak), then confirm — from OUTSIDE the now-
// exited Electron process, since there is no more `app.evaluate` once it's gone — that
// the OS's real primary work area actually came back.
test('quitting with reserveSpace on restores the work area (C-1)', async () => {
  const launched = await launchApp();
  const dataDir = launched.dataDir;
  let originalHeight: number | undefined;
  let closedViaQuit = false;
  try {
    await launched.window('strip', 5000);

    const before = await launched.app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
    originalHeight = before.height;

    await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: Tb }).__tb;
      tb.store.dispatch({ type: 'settings/patch', now: Date.now(), patch: { strip: { reserveSpace: true } } });
    });
    await expect
      .poll(async () => launched.app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea.height), { timeout: 3000 })
      .toBeLessThan(before.height);

    // The real quit path (Electron's `before-quit`) — deliberately WITHOUT patching
    // `reserveSpace` back to false first. `app.close()` triggers the same app.quit()
    // a user closing every window / choosing Quit would.
    await launched.app.close();
    closedViaQuit = true;

    // The Electron process is gone now: read the real OS work area from OUTSIDE it.
    await pollPrimaryWorkAreaHeight(originalHeight, 5000);
  } finally {
    if (!closedViaQuit) {
      // An assertion above threw before we ever reached `app.close()` — the app (and
      // possibly the reservation) is still alive; fall back to the ordinary safe
      // teardown used by the other tests in this file.
      try {
        await launched.app.evaluate(() => {
          const tb = (globalThis as unknown as { __tb: Tb }).__tb;
          tb.store.dispatch({ type: 'settings/patch', now: Date.now(), patch: { strip: { reserveSpace: false } } });
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('win32.spec.ts: failed to disable reserveSpace on the still-running app', err);
      }
      await launched.close();
    } else if (originalHeight !== undefined) {
      // SAFETY: confirm the real work area actually came back; if it did not
      // (`pollPrimaryWorkAreaHeight` above threw, or this test is being re-run after
      // a prior failure left it shrunk), relaunch with the SAME data dir, explicitly
      // disable reserveSpace, wait for the restore, close, and fail loudly — never
      // leave the user's desktop shrunk silently.
      const stillShrunk = (await primaryWorkAreaHeight().catch(() => NaN)) !== originalHeight;
      if (stillShrunk) {
        const recovery = await launchApp({ dataDir });
        try {
          await recovery.window('strip', 5000);
          await recovery.app.evaluate(() => {
            const tb = (globalThis as unknown as { __tb: Tb }).__tb;
            tb.store.dispatch({ type: 'settings/patch', now: Date.now(), patch: { strip: { reserveSpace: false } } });
          });
          await expect
            .poll(async () => recovery.app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea.height), { timeout: 5000 })
            .toBe(originalHeight);
        } finally {
          await recovery.close();
        }
        throw new Error(
          'win32.spec.ts SAFETY: quitting with reserveSpace on left the primary work area shrunk after app.close(); ' +
            'recovered by relaunching with the same data dir and disabling reserveSpace. This IS the C-1 bug — ' +
            'investigate StripWindow.releaseAppBarReservation()/before-quit before re-running this test.'
        );
      }
    }
  }
});
