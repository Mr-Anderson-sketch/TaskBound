import { test, expect } from '@playwright/test';
import { launchApp, windowInfo } from './launch';

test.setTimeout(60_000);

// Task 1.8+1.9 acceptance (updated by fix round 1, C1 and finding 7): launching
// shows exactly the focus strip, flush against the docked edge with no slack, in
// the empty state, and it tracks task/complete within the completion-feedback hold.
test('focus strip shows on launch, flush to the edge, empty state, and updates as tasks change', async () => {
  const launched = await launchApp();
  try {
    const strip = await launched.window('strip', 5000);

    // Finding 7: wrap the visibility check in expect.poll — the window can still be
    // mid-first-paint right after `window('strip', ...)` resolves (that only waits
    // for domcontentloaded, not `showInactive()`).
    await expect
      .poll(
        async () => {
          const infos = await windowInfo(launched.app);
          return infos.filter((w) => w.visible).length;
        },
        { timeout: 5000 }
      )
      .toBe(1);

    const infos = await windowInfo(launched.app);
    const visible = infos.filter((w) => w.visible);
    const stripInfo = visible[0];
    expect(stripInfo.url).toContain('#/strip');
    expect(stripInfo.bounds.height).toBeLessThanOrEqual(40);
    expect(stripInfo.focusable).toBe(false);
    expect(stripInfo.alwaysOnTop).toBe(true);

    const b = stripInfo.bounds;
    const wa = stripInfo.workArea;
    expect(b.x).toBeGreaterThanOrEqual(wa.x);
    expect(b.y).toBeGreaterThanOrEqual(wa.y);
    expect(b.x + b.width).toBeLessThanOrEqual(wa.x + wa.width);
    // C1 (fix round 1): StripWindow now re-anchors from the ACTUAL (possibly
    // OS-forced-taller) height, so the docked bottom edge is exactly flush with the
    // work area's bottom edge — no slack. (Default dock edge is bottom.)
    expect(b.y + b.height).toBe(wa.y + wa.height);

    // The rendered .strip element is itself aligned flush to the window's own
    // viewport bottom (body[data-route="strip"][data-edge="bottom"]'s flex
    // justify-content — see app.css), regardless of any OS-imposed extra window
    // height above it.
    const stripBox = await strip.evaluate(() => {
      const el = document.querySelector('.strip');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { height: r.height, bottom: r.bottom, innerHeight: window.innerHeight };
    });
    expect(stripBox).not.toBeNull();
    expect(stripBox!.height).toBeLessThanOrEqual(40);
    expect(stripBox!.bottom).toBe(stripBox!.innerHeight);

    // The clip shape StripWindow applies (win32 `setShape`, or its computed
    // equivalent elsewhere) also lands exactly on the work area's bottom edge.
    const shape = await launched.app.evaluate(() => {
      const tb = (
        globalThis as unknown as {
          __tb: { strip: { lastShape?: { x: number; y: number; width: number; height: number } } };
        }
      ).__tb;
      return tb.strip.lastShape;
    });
    expect(shape).toBeDefined();
    expect(shape!.height).toBeLessThanOrEqual(40);
    expect(b.y + shape!.y + shape!.height).toBe(wa.y + wa.height);

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
