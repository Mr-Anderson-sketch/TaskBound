import path from 'node:path';
import { test, expect } from '@playwright/test';
import { launchApp, windowInfo } from './launch';

test.setTimeout(60_000);

const SCREENSHOT_DIR = path.resolve(__dirname, '..', 'docs', 'screenshots');

// Task 5.4 acceptance: a clean data dir shows the palette in onboarding mode after
// launch; typing a task + Enter on card 1 adds it (the strip shows it) and advances to
// card 2; picking "Top" there moves the strip live; card 3's "Start" finishes
// onboarding (sets onboardingDone, hides the palette); a relaunch with the same data
// dir does not show onboarding again.
test('onboarding: first run walks capture -> edge -> keys, then a relaunch skips it', async () => {
  const first = await launchApp({ onboarding: true });
  try {
    await first.window('strip');
    const palette = await first.window('palette', 5000);

    // --- card 1: add your first task (embeds the real Capture) ----------------------
    await expect(palette.locator('.onboarding')).toBeVisible();
    await expect(palette.locator('.onboarding .ob-step')).toHaveText('1 / 3');
    await expect(palette.locator('.onboarding .title')).toHaveText('Add your first task');
    await palette.screenshot({ path: path.join(SCREENSHOT_DIR, 'onboarding-1.png') });

    const input = palette.locator('.onboarding .ob-capture input');
    await input.click();
    await input.fill('Write the baseline doc');
    await input.press('Enter');

    const strip = await first.window('strip');
    await expect(strip.locator('.strip .title')).toContainText('Write the baseline doc', { timeout: 2000 });

    // --- card 2: pick an edge (advanced to automatically by Capture's onDone) -------
    await expect(palette.locator('.onboarding .ob-step')).toHaveText('2 / 3', { timeout: 2000 });
    await expect(palette.locator('.onboarding .title')).toHaveText('Pick an edge');
    await palette.screenshot({ path: path.join(SCREENSHOT_DIR, 'onboarding-2.png') });

    await palette.getByRole('radio', { name: 'Top' }).click();
    await expect
      .poll(async () => {
        const infos = await windowInfo(first.app);
        const s = infos.find((w) => w.url.includes('#/strip'));
        return s ? Math.abs(s.bounds.y - s.workArea.y) : Infinity;
      })
      .toBeLessThanOrEqual(2);

    await palette.getByRole('button', { name: 'Next' }).click();

    // --- card 3: five keys to remember ------------------------------------------------
    await expect(palette.locator('.onboarding .ob-step')).toHaveText('3 / 3');
    await expect(palette.locator('.onboarding .title')).toHaveText('Five keys to remember');
    await expect(palette.locator('.onboarding .ob-key')).toHaveCount(5);
    await palette.screenshot({ path: path.join(SCREENSHOT_DIR, 'onboarding-3.png') });

    await palette.getByRole('button', { name: 'Start' }).click();

    await expect
      .poll(async () => {
        const infos = await windowInfo(first.app);
        return infos.find((w) => w.url.includes('#/palette'))?.visible ?? false;
      })
      .toBe(false);

    const onboardingDone = await first.app.evaluate(
      () =>
        (globalThis as unknown as { __tb: { store: { get: () => { data: { settings: { onboardingDone: boolean } } } } } }).__tb.store.get()
          .data.settings.onboardingDone
    );
    expect(onboardingDone).toBe(true);

    expect(first.errors()).toEqual([]);
  } finally {
    await first.close();
  }

  // --- relaunch with the same (now onboardingDone: true) data dir: no onboarding ---
  const second = await launchApp({ dataDir: first.dataDir, onboarding: true });
  try {
    await second.window('strip');
    // Give main's did-finish-load -> palette.show('onboarding') path a moment to have
    // fired if onboardingDone had (wrongly) not persisted.
    await second.app.evaluate(() => new Promise((resolve) => setTimeout(resolve, 500)));

    const infos = await windowInfo(second.app);
    const paletteVisible = infos.find((w) => w.url.includes('#/palette'))?.visible ?? false;
    expect(paletteVisible).toBe(false);

    expect(second.errors()).toEqual([]);
  } finally {
    await second.close();
  }
});

// Task 5.4 addendum: existing data (a legacy import) skips the capture prompt on card
// 1 in favour of an "Imported N tasks" summary, N = tasks with createdAt <= the
// import instant (see onboardingModel.ts) — every one of the fixture's 27 migrated
// tasks (e2e/legacy.spec.ts: "a legacy state.json is imported (27 tasks)").
test('onboarding: an existing-data first run shows the imported task count instead of capture', async () => {
  const legacyFixture = path.resolve(__dirname, '../tests/fixtures/legacy-state.json');
  const launched = await launchApp({ onboarding: true, legacyStateFixture: legacyFixture });
  try {
    await launched.window('strip');
    const palette = await launched.window('palette', 5000);

    await expect(palette.locator('.onboarding .ob-step')).toHaveText('1 / 3');
    await expect(palette.locator('.onboarding .title')).toHaveText('Imported 27 tasks from your previous TimeBound');
    await expect(palette.locator('.onboarding .ob-capture')).toHaveCount(0);

    expect(launched.errors()).toEqual([]);
  } finally {
    await launched.close();
  }
});
