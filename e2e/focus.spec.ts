import { test, expect } from '@playwright/test';
import { launchApp, windowInfo } from './launch';

test.setTimeout(60_000);

// Task 1.8+1.9 acceptance: launching shows exactly the focus strip, in the empty
// state, and it tracks task/complete within the completion-feedback hold.
test('focus strip shows on launch, empty state, and updates as tasks change', async () => {
  const launched = await launchApp();
  try {
    const strip = await launched.window('strip', 5000);

    const infos = await windowInfo(launched.app);
    const visible = infos.filter((w) => w.visible);
    expect(visible).toHaveLength(1);
    expect(visible[0].url).toContain('#/strip');
    expect(visible[0].bounds.height).toBeLessThanOrEqual(40);
    expect(visible[0].focusable).toBe(false);
    expect(visible[0].alwaysOnTop).toBe(true);

    const b = visible[0].bounds;
    const wa = visible[0].workArea;
    // Windows enforces a frameless-window minimum height (~39 DIP) regardless of the
    // requested bounds (a documented Electron/Windows constraint StripWindow cannot
    // opt out of), which can push the docked bottom edge a few px past the work area
    // even though the *requested* dock position was flush to it — hence the same
    // slack as the height assertion above (`<= 40`, not `<= 32`).
    const OS_MIN_HEIGHT_SLACK = 8;
    expect(b.x).toBeGreaterThanOrEqual(wa.x);
    expect(b.y).toBeGreaterThanOrEqual(wa.y - OS_MIN_HEIGHT_SLACK);
    expect(b.x + b.width).toBeLessThanOrEqual(wa.x + wa.width);
    expect(b.y + b.height).toBeLessThanOrEqual(wa.y + wa.height + OS_MIN_HEIGHT_SLACK);

    await expect(strip.locator('.strip .title')).toContainText('Nothing yet');
    await expect(strip.locator('.strip .title')).toContainText('to add a task');

    await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: { store: { dispatch: (a: unknown) => number } } }).__tb;
      tb.store.dispatch({ type: 'task/add', id: 'a', now: Date.now(), title: 'Write the baseline doc', today: true });
      tb.store.dispatch({ type: 'task/add', id: 'b', now: Date.now(), title: 'Second task', today: true });
    });

    await expect(strip.locator('.strip .title')).toContainText('Write the baseline doc', { timeout: 5000 });

    await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: { store: { dispatch: (a: unknown) => number } } }).__tb;
      tb.store.dispatch({ type: 'task/complete', id: 'a', now: Date.now(), by: 'user' });
    });

    await expect(strip.locator('.strip .title')).toContainText('Second task', { timeout: 2500 });

    expect(launched.errors()).toEqual([]);
  } finally {
    await launched.close();
  }
});
