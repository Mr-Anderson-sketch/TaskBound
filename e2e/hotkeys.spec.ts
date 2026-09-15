import path from 'node:path';
import { test, expect } from '@playwright/test';
import { launchApp } from './launch';

test.setTimeout(60_000);

const SCREENSHOT_DIR = path.resolve(__dirname, '..', 'docs', 'screenshots');

async function getHotkeys(
  app: import('@playwright/test').ElectronApplication
): Promise<Record<string, string>> {
  return app.evaluate(
    () =>
      (globalThis as unknown as { __tb: { store: { get: () => { data: { settings: { hotkeys: Record<string, string> } } } } } }).__tb.store.get()
        .data.settings.hotkeys
  );
}

// Task 5.2 binding ruling acceptance: record a new capture hotkey through the recorder
// by pressing keys in the planner page, and assert the store setting changed.
test('hotkeys: recording a new capture hotkey through the recorder updates the store', async () => {
  const launched = await launchApp();
  try {
    await launched.window('strip');

    await launched.app.evaluate(() => {
      (globalThis as unknown as { __tb: { planner: { show: () => void } } }).__tb.planner.show();
    });
    const planner = await launched.window('planner', 5000);

    await planner.locator('.rail .foot button', { hasText: 'Settings' }).click();
    await planner.locator('.settings-nav .i', { hasText: 'Hotkeys' }).click();
    await expect(planner.locator('.settings-pane h1')).toHaveText('Hotkeys');

    const before = await getHotkeys(launched.app);
    expect(before.capture).toBe('Control+Alt+Space');

    await planner.screenshot({ path: path.join(SCREENSHOT_DIR, 'settings-hotkeys.png') });

    const recorder = planner.getByRole('button', { name: 'Quick capture hotkey' });
    await recorder.focus();
    await expect(recorder).toHaveText('Press keys…');

    // Not on the DENYLIST, has a modifier, single resolvable key -> should validate ok
    // and save immediately.
    await planner.keyboard.press('Control+Alt+K');

    await expect.poll(async () => (await getHotkeys(launched.app)).capture).toBe('Control+Alt+K');
    await expect(recorder).not.toHaveText('Press keys…');
    await expect(planner.locator('.key-recorder-wrap', { has: recorder }).locator('.key-recorder-error')).toHaveCount(0);

    // --- Escape cancels without saving -------------------------------------------------
    await recorder.focus();
    await expect(recorder).toHaveText('Press keys…');
    await planner.keyboard.press('Escape');
    await expect(recorder).not.toHaveText('Press keys…');
    expect((await getHotkeys(launched.app)).capture).toBe('Control+Alt+K');

    // --- Backspace resets to the default -------------------------------------------------
    await recorder.focus();
    await planner.keyboard.press('Backspace');
    await expect.poll(async () => (await getHotkeys(launched.app)).capture).toBe('Control+Alt+Space');

    // --- A bare, unmodified key shows the inline "needs a modifier" reason -------------
    await recorder.focus();
    await planner.keyboard.press('a');
    await expect(planner.locator('.key-recorder-wrap', { has: recorder }).locator('.key-recorder-error')).toContainText(
      'Needs Ctrl, Alt or'
    );

    expect(launched.errors()).toEqual([]);
  } finally {
    await launched.close();
  }
});
