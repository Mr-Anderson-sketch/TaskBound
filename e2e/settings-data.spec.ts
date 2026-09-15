import path from 'node:path';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { test, expect } from '@playwright/test';
import { launchApp } from './launch';

test.setTimeout(90_000);

const SCREENSHOT_DIR = path.resolve(__dirname, '..', 'docs', 'screenshots');

// Task 5.3 acceptance: the Settings "Data" section renders the default-location text,
// the export/import controls (never clicked here — `data:export`/`data:import` open a
// real OS dialog outside the e2e seam), and the backups list. A real cross-day save is
// hard to trigger in a single test run, so a backup is instead seeded directly on disk
// (same approach as e2e/data.spec.ts's own fixtures) via the `__tb.data.exportTo` seam
// — the exact code the real `data:export` IPC handler calls — writing straight to the
// `backups/data-2026-09-14.json` path `data:listBackups` expects.
//
// Note: main's own daily-backup rotation (src/main/persist.ts `rotateBackup`) can
// already create a backup for TODAY on the very first real save after boot, so the
// list is not reliably empty by the time this test gets to it — the empty-state text
// ("No backups yet", asserted below only when it's actually true) is exercised
// best-effort, and the main assertion instead checks the rendered rows against
// whatever `data:listBackups` itself returns, which is the reliable ground truth.
test('settings: Data section — default location, export/import controls, backups list and restore', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'timebound-e2e-data-'));
  const launched = await launchApp({ dataDir });
  try {
    await launched.window('strip');

    await launched.app.evaluate(() => {
      (globalThis as unknown as { __tb: { planner: { show: () => void } } }).__tb.planner.show();
    });
    const planner = await launched.window('planner', 5000);

    await planner.locator('.rail .foot button', { hasText: 'Settings' }).click();
    await planner.locator('.settings-nav .i', { hasText: 'Data' }).click();
    await expect(planner.locator('.settings-pane h1')).toHaveText('Data');

    // --- default location, export/import controls, empty backups state --------------
    await expect(planner.locator('.data-folder-path')).toHaveText('Default location');
    await expect(planner.getByRole('button', { name: 'Change folder…' })).toBeVisible();
    await expect(planner.getByRole('button', { name: 'Export JSON' })).toBeVisible();
    await expect(planner.getByRole('button', { name: 'Export Markdown' })).toBeVisible();
    await expect(planner.getByRole('button', { name: 'Import JSON or Markdown…' })).toBeVisible();

    // Best-effort empty-state check: true only if main hasn't rotated a same-day
    // backup yet (see note above) — asserted conditionally so it never flakes.
    const initialBackups = await planner.evaluate(() =>
      (window as unknown as { tb: { invoke: (c: 'data:listBackups') => Promise<string[]> } }).tb.invoke('data:listBackups')
    );
    if (initialBackups.length === 0) {
      await expect(planner.locator('.settings-pane')).toContainText('No backups yet');
    } else {
      await expect(planner.locator('.setting-row', { hasText: 'Restore' })).toHaveCount(initialBackups.length);
    }

    await planner.screenshot({ path: path.join(SCREENSHOT_DIR, 'settings-data.png') });

    // --- seed a real backup file on disk, then remount the section to refetch --------
    const backupsDir = path.join(dataDir, 'backups');
    await mkdir(backupsDir, { recursive: true });
    const backupPath = path.join(backupsDir, 'data-2026-09-14.json');
    const exportResult = await launched.app.evaluate(
      async (_electron, { backupPath }) => {
        const tb = (
          globalThis as unknown as { __tb: { data: { exportTo: (format: 'json' | 'md', p: string) => Promise<{ path?: string }> } } }
        ).__tb;
        return tb.data.exportTo('json', backupPath);
      },
      { backupPath }
    );
    expect(exportResult.path).toBe(backupPath);

    await planner.locator('.settings-nav .i', { hasText: 'Strip' }).click();
    await planner.locator('.settings-nav .i', { hasText: 'Data' }).click();

    // --- backups list matches main's data:listBackups exactly ------------------------
    const backupsAfterSeed = await planner.evaluate(() =>
      (window as unknown as { tb: { invoke: (c: 'data:listBackups') => Promise<string[]> } }).tb.invoke('data:listBackups')
    );
    expect(backupsAfterSeed).toContain(backupPath);
    await expect(planner.locator('.setting-row', { hasText: 'Restore' })).toHaveCount(backupsAfterSeed.length);

    // --- the seeded row renders, date formatted via longDayLabel ---------------------
    const row = planner.locator('.setting-row', { hasText: 'Monday 14 September' });
    await expect(row).toBeVisible();

    // --- restore: Restore -> inline confirm -> Restore -> success message ------------
    await row.getByRole('button', { name: 'Restore' }).click();
    await expect(row).toContainText('Replace your current tasks with this backup?');
    await row.getByRole('button', { name: 'Restore' }).click();
    await expect(planner.locator('.settings-pane')).toContainText('Restored the backup from Monday 14 September');

    expect(launched.errors()).toEqual([]);
  } finally {
    await launched.close();
  }
});
