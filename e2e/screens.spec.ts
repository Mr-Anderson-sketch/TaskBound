// e2e/screens.spec.ts — Deliverable 3 (ship-measurement): screenshots of every screen and
// theme, plus realistic seed data for the planner Today view. Skipped by default; run
// with `TB_SCREENS=1 playwright test e2e/screens.spec.ts`. Intentionally overwrites a
// few filenames the normal e2e suite also produces (planner-today.png) with a version
// seeded with realistic tasks instead of synthetic "Open task N" ones, per the ship
// docs brief — run this AFTER the normal suite so this version wins.
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { launchApp, windowInfo } from './launch';

const SCREENSHOT_DIR = path.resolve(__dirname, '..', 'docs', 'screenshots');

type Evaluable = {
  __tb: {
    store: { dispatch: (a: unknown) => unknown };
    planner: { show: () => void; hide: () => void };
    strip: { webContents?: { send: (c: string, p: unknown) => void } };
  };
};

const THEMES = ['ledger', 'kraft', 'phosphor', 'slate'] as const;
const MODES = ['light', 'dark'] as const;

test.describe('screens: theme/state grid + realistic planner seed data', () => {
  test.skip(!process.env.TB_SCREENS, 'set TB_SCREENS=1 to capture the full screen/theme set');
  test.setTimeout(5 * 60_000);

  // Each state (normal/running/collapsed/break) runs in its OWN fresh launch — bounding
  // every session to 8 screenshots (one per theme x light/dark). Found while writing
  // this spec: taking 16+ page.screenshot()s of this tiny always-on-top/transparent/
  // shaped strip window back-to-back in one session eventually hangs the actual
  // Chromium capture step forever (fonts report loaded, then nothing — no error, no
  // timeout recovery), reproducibly around the 8th-12th shot; a fresh 8-shot session
  // never hit it. Looks like a real Electron/Chromium capture-pipeline issue specific
  // to this odd window shape on this machine, not something to chase down here.
  async function captureStateGrid(state: string, setup: (launched: Awaited<ReturnType<typeof launchApp>>, strip: import('@playwright/test').Page) => Promise<void>) {
    test(`strip: 4 themes x light/dark — ${state}`, async () => {
      const launched = await launchApp();
      try {
        const strip = await launched.window('strip');
        await launched.app.evaluate(() => {
          const tb = (globalThis as unknown as Evaluable).__tb;
          tb.store.dispatch({
            type: 'task/add',
            id: 'screens-task',
            now: Date.now(),
            title: 'Draft the release notes',
            today: true,
            plannedSeconds: 1500
          });
        });
        await setup(launched, strip);

        for (const theme of THEMES) {
          for (const mode of MODES) {
            await launched.app.evaluate(
              (_electron, { name, mode }) => {
                const tb = (globalThis as unknown as Evaluable).__tb;
                tb.store.dispatch({ type: 'settings/patch', now: Date.now(), patch: { theme: { name, mode } } });
              },
              { name: theme, mode }
            );
            await expect
              .poll(() =>
                strip.evaluate(() => ({
                  theme: document.documentElement.getAttribute('data-theme'),
                  mode: document.documentElement.getAttribute('data-mode')
                }))
              )
              .toEqual({ theme, mode });
            const file = path.join(SCREENSHOT_DIR, `strip-${theme}-${mode}-${state}.png`);
            await strip.screenshot({ path: file, timeout: 15_000, animations: 'disabled' });
          }
        }

        expect(launched.errors()).toEqual([]);
      } finally {
        await launched.close();
      }
    });
  }

  captureStateGrid('normal', async (launched) => {
    await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as Evaluable).__tb;
      tb.store.dispatch({ type: 'settings/patch', now: Date.now(), patch: { strip: { collapsed: false }, notifications: false } });
    });
  });

  captureStateGrid('running', async (launched, strip) => {
    await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as Evaluable).__tb;
      tb.store.dispatch({ type: 'settings/patch', now: Date.now(), patch: { strip: { collapsed: false }, notifications: false } });
      tb.store.dispatch({ type: 'timer/start', id: 'screens-task', now: Date.now() });
    });
    await expect(strip.locator('.strip')).toHaveAttribute('data-state', 'running', { timeout: 3000 });
  });

  captureStateGrid('collapsed', async (launched, strip) => {
    await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as Evaluable).__tb;
      tb.store.dispatch({ type: 'settings/patch', now: Date.now(), patch: { strip: { collapsed: false }, notifications: false } });
      tb.store.dispatch({ type: 'timer/start', id: 'screens-task', now: Date.now() });
    });
    await expect(strip.locator('.strip')).toHaveAttribute('data-state', 'running', { timeout: 3000 });
    await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as Evaluable).__tb;
      tb.store.dispatch({ type: 'settings/patch', now: Date.now(), patch: { strip: { collapsed: true } } });
    });
    await expect(strip.locator('.pill')).toBeVisible({ timeout: 3000 });
  });

  // Push a synthetic pomodoro break via the same `timer:break` IPC channel main sends
  // on real expiry (src/main/main.ts), targeted directly at the strip's webContents
  // (`tb.strip.webContents.send`) so the theme loop doesn't race a real countdown.
  captureStateGrid('break', async (launched, strip) => {
    await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as Evaluable).__tb;
      tb.store.dispatch({ type: 'settings/patch', now: Date.now(), patch: { strip: { collapsed: false }, notifications: false } });
      tb.strip.webContents?.send('timer:break', { endsAt: Date.now() + 10 * 60_000 });
    });
    await expect(strip.locator('.strip')).toHaveAttribute('data-state', 'break', { timeout: 3000 });
  });

  // Deliverable 3 asks for a "palette capture" screenshot — the live-parsed token
  // chips (when/tag) mid-type, same interaction capture.spec.ts exercises without
  // itself taking a screenshot.
  test('palette: capture with live-parsed token chips', async () => {
    const launched = await launchApp();
    try {
      await launched.window('strip');
      await launched.app.evaluate(() => {
        (globalThis as unknown as { __tb: { palette: { show: (m: string) => void } } }).__tb.palette.show('capture');
      });
      const palette = await launched.window('palette', 5000);

      const input = palette.locator('.palette input');
      await input.click();
      await input.type('email investor update tomorrow 9am #fundraising');
      await expect(palette.locator('.palette .tok')).toHaveCount(3, { timeout: 2000 });
      await palette.screenshot({ path: path.join(SCREENSHOT_DIR, 'capture-chips.png') });

      expect(launched.errors()).toEqual([]);
    } finally {
      await launched.close();
    }
  });

  test('settings: Timer section screenshot', async () => {
    const launched = await launchApp();
    try {
      await launched.window('strip');
      await launched.app.evaluate(() => (globalThis as unknown as Evaluable).__tb.planner.show());
      const planner = await launched.window('planner', 5000);

      await planner.locator('.rail .foot button', { hasText: 'Settings' }).click();
      await planner.locator('.settings-nav .i', { hasText: 'Timer' }).click();
      await expect(planner.locator('.settings-pane h1')).toHaveText('Timer & pomodoro');
      await planner.screenshot({ path: path.join(SCREENSHOT_DIR, 'settings-timer.png') });

      expect(launched.errors()).toEqual([]);
    } finally {
      await launched.close();
    }
  });

  // Realistic planner Today view: three real-looking tasks (a roadmap doc, a reply-to-
  // someone task, a PR review) with tags, a due date, a sub-task, and a running timer —
  // deliberately overwrites planner-today.png (also produced by the normal suite's
  // planner.spec.ts with synthetic "Open task N" titles) since this task's brief asks
  // for realistic example data in the final doc set.
  test('planner: Today view with realistic seed data', async () => {
    const launched = await launchApp();
    try {
      await launched.window('strip');

      await launched.app.evaluate(() => {
        const tb = (globalThis as unknown as Evaluable).__tb;
        const now = Date.now();
        const d = new Date();
        d.setDate(d.getDate() + 3);
        const dueDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

        tb.store.dispatch({
          type: 'task/add',
          id: 'roadmap',
          now,
          title: 'Draft Q3 roadmap',
          today: true,
          tags: ['planning'],
          due: { date: dueDate },
          plannedSeconds: 3600
        });
        tb.store.dispatch({ type: 'timer/start', id: 'roadmap', now });

        tb.store.dispatch({
          type: 'task/add',
          id: 'priya',
          now: now + 1,
          title: 'Reply to Priya about invoices',
          today: true,
          tags: ['finance']
        });

        tb.store.dispatch({
          type: 'task/add',
          id: 'pr182',
          now: now + 2,
          title: 'Review PR #182',
          today: true,
          tags: ['eng']
        });
        tb.store.dispatch({
          type: 'task/add',
          id: 'pr182-sub',
          now: now + 3,
          title: 'Check the migration script',
          parentId: 'pr182'
        });
      });

      await launched.app.evaluate(() => (globalThis as unknown as Evaluable).__tb.planner.show());
      const planner = await launched.window('planner', 5000);
      await expect(planner.locator('.task .t', { hasText: 'Draft Q3 roadmap' })).toBeVisible({ timeout: 3000 });

      const info = (await windowInfo(launched.app)).find((w) => w.url.includes('#/planner'));
      expect(info?.bounds.width).toBe(1000);
      expect(info?.bounds.height).toBe(640);

      await planner.screenshot({ path: path.join(SCREENSHOT_DIR, 'planner-today.png') });

      expect(launched.errors()).toEqual([]);
    } finally {
      await launched.close();
    }
  });
});
