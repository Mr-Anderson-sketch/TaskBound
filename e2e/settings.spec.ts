import path from 'node:path';
import { test, expect } from '@playwright/test';
import { launchApp, windowInfo } from './launch';

test.setTimeout(90_000);

const SCREENSHOT_DIR = path.resolve(__dirname, '..', 'docs', 'screenshots');

// Sets a native <input> value the way a real user interaction would (dispatching a
// real 'input' event via the native value setter) so React's onChange actually fires —
// plain `.fill()` isn't reliable for <input type="range">.
async function setRangeValue(locator: import('@playwright/test').Locator, value: string): Promise<void> {
  await locator.evaluate((el: HTMLInputElement, v: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

// Task 5.1 addendum ruling 8 acceptance.
test('settings: Strip/Timer/Startup/Score controls apply instantly; Ctrl+, and the tray path both open Settings', async () => {
  const launched = await launchApp();
  try {
    const strip = await launched.window('strip');

    await launched.app.evaluate(() => {
      (globalThis as unknown as { __tb: { planner: { show: () => void } } }).__tb.planner.show();
    });
    const planner = await launched.window('planner', 5000);

    // --- gear button opens Settings, defaulting to Strip -----------------------------
    await planner.locator('.rail .foot button', { hasText: 'Settings' }).click();
    await expect(planner.locator('.settings-pane h1')).toHaveText('Strip');

    await planner.screenshot({ path: path.join(SCREENSHOT_DIR, 'settings-strip.png') });

    // --- Dock to Top -> strip bounds sit at the work-area top ------------------------
    await planner.locator('.setting-row', { hasText: 'Dock to' }).getByRole('radio', { name: 'Top' }).click();
    await expect
      .poll(async () => {
        const infos = await windowInfo(launched.app);
        const s = infos.find((w) => w.url.includes('#/strip'));
        return s ? Math.abs(s.bounds.y - s.workArea.y) : Infinity;
      })
      .toBeLessThanOrEqual(2);

    // --- Width 600 -> strip window width 600 ------------------------------------------
    const widthRange = planner.locator('.setting-row', { hasText: 'Width' }).locator('input[type="range"]');
    await setRangeValue(widthRange, '600');
    await expect
      .poll(async () => {
        const infos = await windowInfo(launched.app);
        return infos.find((w) => w.url.includes('#/strip'))?.bounds.width;
      })
      .toBe(600);

    // --- Theme section: Text size L -> strip title 14px, strip height <= 44 ----------
    await planner.locator('.settings-nav .i', { hasText: 'Theme' }).click();
    await planner.locator('.setting-row', { hasText: 'Text size' }).getByRole('radio', { name: 'L' }).click();
    await expect
      .poll(() => strip.locator('.strip .title').evaluate((el) => getComputedStyle(el).fontSize))
      .toBe('14px');
    await expect
      .poll(async () => {
        const infos = await windowInfo(launched.app);
        return infos.find((w) => w.url.includes('#/strip'))?.bounds.height;
      })
      .toBeLessThanOrEqual(44);

    await planner.screenshot({ path: path.join(SCREENSHOT_DIR, 'settings-theme.png') });

    // --- Timer: Pomodoro on + Work 30 --------------------------------------------------
    await planner.locator('.settings-nav .i', { hasText: 'Timer' }).click();
    await planner.locator('.setting-row', { hasText: 'Pomodoro' }).getByRole('switch').click();
    const workField = planner.locator('.setting-row', { hasText: 'Work session minutes' }).locator('input[type="number"]');
    await workField.fill('30');
    await workField.blur();
    await expect
      .poll(async () =>
        launched.app.evaluate(
          () =>
            (globalThis as unknown as { __tb: { store: { get: () => { data: { settings: { timer: { pomodoro: boolean; workMinutes: number } } } } } } }).__tb.store.get()
              .data.settings.timer
        )
      )
      .toEqual(expect.objectContaining({ pomodoro: true, workMinutes: 30 }));

    // --- Startup: toggle flips startOnLogin in the store (no OS registration in e2e) --
    await planner.locator('.settings-nav .i', { hasText: 'Startup' }).click();
    await planner.locator('.setting-row', { hasText: 'Start TimeBound when I sign in' }).getByRole('switch').click();
    await expect
      .poll(async () =>
        launched.app.evaluate(
          () =>
            (globalThis as unknown as { __tb: { store: { get: () => { data: { settings: { startOnLogin: boolean } } } } } }).__tb.store.get()
              .data.settings.startOnLogin
        )
      )
      .toBe(true);

    // --- Score: reset with confirm sets value to 0 ------------------------------------
    await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: { store: { dispatch: (a: unknown) => { rev: number } } } }).__tb;
      tb.store.dispatch({ type: 'settings/patch', now: Date.now(), patch: { score: { enabled: true, value: 7 } } });
    });
    await planner.locator('.settings-nav .i', { hasText: 'Score' }).click();
    await expect(planner.locator('.score-value')).toHaveText('7');
    await planner.locator('button', { hasText: 'Reset to 0' }).click();
    await planner.locator('.confirm-inline button', { hasText: 'Reset' }).click();
    await expect(planner.locator('.score-value')).toHaveText('0');

    // --- Ctrl+, opens Settings (from a non-settings view) -----------------------------
    await planner.locator('.rail button', { hasText: 'Today' }).click();
    await expect(planner.locator('.settings-pane')).toHaveCount(0);
    await planner.locator('body').click();
    await planner.keyboard.press('Control+,');
    await expect(planner.locator('.settings-pane h1')).toHaveText('Strip');

    // --- Tray "Settings…" path: main sends `planner:navigate` after showing the
    // planner (via the e2e seam, exercising the same renderer-side listener the real
    // tray click handler drives) --------------------------------------------------------
    await planner.locator('.rail button', { hasText: 'Today' }).click();
    await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: { planner: { show: () => void; webContents?: { send: (c: string, p: unknown) => void } } } })
        .__tb;
      tb.planner.show();
      tb.planner.webContents!.send('planner:navigate', 'settings:strip');
    });
    await expect(planner.locator('.settings-pane h1')).toHaveText('Strip');

    expect(launched.errors()).toEqual([]);
  } finally {
    await launched.close();
  }
});
