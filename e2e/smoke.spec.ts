import path from 'node:path';
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

// e2e isolation regression guard: Electron on Windows ignores the `APPDATA` env
// override, so without launch.ts's `TIMEBOUND_USERDATA_DIR` (main.ts's
// `app.setPath('userData', …)` test seam) every launch's Chromium profile,
// single-instance lock, and data-location.json pointer would silently land in the
// real, shared `%APPDATA%\TimeBound-dev` folder instead of this launch's own temp
// dir. Assert the launched app's actual `userData` path stays inside `dataDir`.
test('a launched test app resolves userData inside its own temp dir, never the real APPDATA folder', async () => {
  const launched = await launchApp();
  try {
    await launched.window('strip');
    const userDataPath = await launched.app.evaluate(({ app }) => app.getPath('userData'));
    const resolvedUserData = path.resolve(userDataPath);
    const resolvedDataDir = path.resolve(launched.dataDir);
    expect(resolvedUserData.startsWith(resolvedDataDir + path.sep) || resolvedUserData === resolvedDataDir).toBe(true);
    expect(resolvedUserData.toLowerCase()).not.toContain('timebound-dev');
  } finally {
    await launched.close();
  }
});
