import { test, expect } from '@playwright/test';
import { launchApp, windowInfo } from './launch';

test.setTimeout(60_000);

// Task 1.8+1.9 acceptance: the capture palette adds a task, updates the strip, and
// hides itself — without ever giving the (non-focusable) strip window OS focus.
test('capture palette adds a task and hides, strip stays unfocused', async () => {
  const launched = await launchApp();
  try {
    await launched.window('strip');

    await launched.app.evaluate(() => {
      (globalThis as unknown as { __tb: { palette: { show: (m: string) => void } } }).__tb.palette.show('capture');
    });

    const palette = await launched.window('palette', 5000);
    const beforeInfos = await windowInfo(launched.app);
    expect(beforeInfos.find((w) => w.url.includes('#/palette'))?.visible).toBe(true);

    const input = palette.locator('.palette input');
    await input.click();
    await input.fill('Write the baseline doc');
    await input.press('Enter');

    const strip = await launched.window('strip');
    await expect(strip.locator('.strip .title')).toContainText('Write the baseline doc', { timeout: 2000 });

    await expect
      .poll(
        async () => {
          const infos = await windowInfo(launched.app);
          return infos.find((w) => w.url.includes('#/palette'))?.visible ?? false;
        },
        { timeout: 3000 }
      )
      .toBe(false);

    const afterInfos = await windowInfo(launched.app);
    const stripInfo = afterInfos.find((w) => w.url.includes('#/strip'))!;
    expect(stripInfo.focused).toBe(false);

    expect(launched.errors()).toEqual([]);
  } finally {
    await launched.close();
  }
});
