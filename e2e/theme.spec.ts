import { test, expect } from '@playwright/test';
import { launchApp } from './launch';

test.setTimeout(60_000);

// Task 5.1 addendum ruling 5 acceptance: open planner -> Settings (gear) -> Theme ->
// click the Kraft card -> Appearance Dark -> the STRIP window's <html> reflects the
// change within 1 s, and it survives a relaunch against the same data dir.
test('theme: switching to Kraft dark in Settings applies to the strip and persists', async () => {
  const first = await launchApp();
  const dataDir = first.dataDir;
  try {
    await first.window('strip');

    await first.app.evaluate(() => {
      (globalThis as unknown as { __tb: { planner: { show: () => void } } }).__tb.planner.show();
    });
    const planner = await first.window('planner', 5000);

    await planner.locator('.rail .foot button', { hasText: 'Settings' }).click();
    await planner.locator('.settings-nav .i', { hasText: 'Theme' }).click();

    await planner.locator('.theme-card', { hasText: 'Kraft' }).click();
    await planner.locator('.setting-row', { hasText: 'Appearance' }).getByRole('radio', { name: 'Dark' }).click();

    const strip = await first.window('strip');
    await expect
      .poll(
        async () =>
          strip.evaluate(() => ({
            theme: document.documentElement.getAttribute('data-theme'),
            mode: document.documentElement.getAttribute('data-mode')
          })),
        { timeout: 1000 }
      )
      .toEqual({ theme: 'kraft', mode: 'dark' });

    await first.app.evaluate(async () => {
      await (globalThis as unknown as { __tb: { store: { flush: () => Promise<void> } } }).__tb.store.flush();
    });

    expect(first.errors()).toEqual([]);
  } finally {
    await first.close();
  }

  const second = await launchApp({ dataDir });
  try {
    const strip = await second.window('strip');
    const attrs = await strip.evaluate(() => ({
      theme: document.documentElement.getAttribute('data-theme'),
      mode: document.documentElement.getAttribute('data-mode')
    }));
    expect(attrs).toEqual({ theme: 'kraft', mode: 'dark' });
    expect(second.errors()).toEqual([]);
  } finally {
    await second.close();
  }
});
