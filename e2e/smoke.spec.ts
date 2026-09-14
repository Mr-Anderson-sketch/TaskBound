import { test, expect } from '@playwright/test';
import { launchApp, windowInfo } from './launch';

// Smoke: the built app launches, shows a window, and logs no console errors.
// This must stay green after every task in docs/PLAN.md.
test('app launches with a visible window and no console errors', async () => {
  const launched = await launchApp();
  try {
    const first = await launched.app.firstWindow();
    await first.waitForLoadState('domcontentloaded');
    await first.waitForTimeout(1500);
    const info = await windowInfo(launched.app);
    expect(info.some((w) => w.visible)).toBe(true);
    expect(launched.errors()).toEqual([]);
  } finally {
    await launched.close();
  }
});
