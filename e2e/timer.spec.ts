import { test, expect } from '@playwright/test';
import { launchApp } from './launch';

test.setTimeout(60_000);

// Task 3.2 addendum ruling 9: a running planned timer counts down on the strip,
// notifies exactly once at expiry (via the __tbEvents seam wrapping Notifier.timerDone
// — see main.ts's test seam), and the strip enters overtime.
test('a running planned timer counts down and notifies once at expiry, entering overtime', async () => {
  const launched = await launchApp();
  try {
    const strip = await launched.window('strip', 5000);

    await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: { store: { dispatch: (a: unknown) => number } } }).__tb;
      // Fix round 1, item 3 minor: the __tbEvents seam counts a Notifier call before
      // Notifier's own settings check runs, so turning notifications off here still
      // lets the test count `timerDone` calls while ensuring no real OS toast appears.
      tb.store.dispatch({ type: 'settings/patch', now: Date.now(), patch: { notifications: false } });
      tb.store.dispatch({ type: 'task/add', id: 't1', now: Date.now(), title: 'Timed task', today: true, plannedSeconds: 2 });
      tb.store.dispatch({ type: 'timer/start', id: 't1', now: Date.now() });
    });

    const chip = strip.locator('.strip .chip');
    const firstText = await chip.textContent();
    // useDisplayTime ticks once per second from whenever the renderer actually saw
    // `runningSince` (an IPC round-trip after the dispatch above), so allow a little
    // slack past that 1 s — well short of the ~2 s expiry asserted below.
    await expect.poll(async () => chip.textContent(), { timeout: 3000 }).not.toBe(firstText);

    await expect(strip.locator('.strip')).toHaveAttribute('data-state', 'overtime', { timeout: 4000 });
    await expect(chip).toContainText(/^\+00:0\d/, { timeout: 2000 });

    const timerDoneCalls = await launched.app.evaluate(() => {
      const events = (globalThis as unknown as { __tbEvents: Array<{ type: string }> }).__tbEvents;
      return events.filter((e) => e.type === 'timerDone').length;
    });
    expect(timerDoneCalls).toBe(1);

    expect(launched.errors()).toEqual([]);
  } finally {
    await launched.close();
  }
});

// Task 3.2 addendum ruling 9: with pomodoro on, expiry pauses the task and the strip
// shows a "Break" state for breakMinutes.
test('pomodoro: timer expiry pauses the task and starts a break shown on the strip', async () => {
  const launched = await launchApp();
  try {
    const strip = await launched.window('strip', 5000);

    await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: { store: { dispatch: (a: unknown) => number } } }).__tb;
      tb.store.dispatch({ type: 'settings/patch', now: Date.now(), patch: { notifications: false } });
      tb.store.dispatch({
        type: 'settings/patch',
        now: Date.now(),
        patch: { timer: { pomodoro: true, breakMinutes: 1 } }
      });
      tb.store.dispatch({ type: 'task/add', id: 't2', now: Date.now(), title: 'Pomodoro task', today: true, plannedSeconds: 2 });
      tb.store.dispatch({ type: 'timer/start', id: 't2', now: Date.now() });
    });

    await expect(strip.locator('.strip')).toHaveAttribute('data-state', 'break', { timeout: 5000 });
    await expect(strip.locator('.strip .title')).toContainText('Break');

    const runningSince = await launched.app.evaluate(() => {
      const tb = (
        globalThis as unknown as {
          __tb: { store: { get: () => { data: { tasks: Array<{ id: string; timer?: { runningSince?: number } }> } } } };
        }
      ).__tb;
      return tb.store.get().data.tasks.find((t) => t.id === 't2')?.timer?.runningSince;
    });
    expect(runningSince).toBeUndefined();

    // Ship-measurement task note: this screenshot started reproducibly hanging past
    // Playwright's default 30s screenshot timeout on this machine, 100% of the time
    // across many repeats regardless of `animations: 'disabled'` or a post-tick retry
    // (same class of Electron/Chromium screenshot-capture issue chased at length in
    // e2e/screens.spec.ts and docs/FOOTPRINT.md while building the ship-measurement
    // docs, but this exact scenario — a strip window mid a REAL, live-ticking pomodoro
    // break — never recovered). The behavior this screenshot exists to document is
    // already fully asserted above (data-state, title, timer cleared) and a valid
    // docs/screenshots/strip-break.png already exists from an earlier successful run;
    // don't let an environmental capture issue in an incidental screenshot fail this
    // test's real assertions.
    try {
      await strip.screenshot({ path: 'docs/screenshots/strip-break.png', animations: 'disabled', timeout: 10_000 });
    } catch (err) {
      console.warn('strip-break.png screenshot failed (non-fatal, see comment above):', err);
    }

    expect(launched.errors()).toEqual([]);
  } finally {
    await launched.close();
  }
});

// Task 3.2 fix round 2, item 2: a reload (of any kind — a manual devtools reload, or
// the automatic one `render-process-gone` triggers in main.ts) must replay the CURRENT
// break, not just the window's very first load. `did-finish-load` fires again on
// reload for the SAME webContents, so `main.ts` listens with `.on`, not `.once`.
test('a reloaded strip window replays the active pomodoro break', async () => {
  const launched = await launchApp();
  try {
    const strip = await launched.window('strip', 5000);

    await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: { store: { dispatch: (a: unknown) => number } } }).__tb;
      tb.store.dispatch({ type: 'settings/patch', now: Date.now(), patch: { notifications: false } });
      tb.store.dispatch({
        type: 'settings/patch',
        now: Date.now(),
        patch: { timer: { pomodoro: true, breakMinutes: 1 } }
      });
      tb.store.dispatch({ type: 'task/add', id: 't3', now: Date.now(), title: 'Reload task', today: true, plannedSeconds: 2 });
      tb.store.dispatch({ type: 'timer/start', id: 't3', now: Date.now() });
    });

    await expect(strip.locator('.strip')).toHaveAttribute('data-state', 'break', { timeout: 5000 });

    await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: { strip: { webContents?: { reload: () => void } } } }).__tb;
      tb.strip.webContents?.reload();
    });

    // Same Page/webContents, just navigated — the break must show again once the
    // reloaded renderer re-mounts and main replays `timer:break` on THIS load too.
    await expect(strip.locator('.strip')).toHaveAttribute('data-state', 'break', { timeout: 5000 });
    await expect(strip.locator('.strip .title')).toContainText('Break');

    expect(launched.errors()).toEqual([]);
  } finally {
    await launched.close();
  }
});
