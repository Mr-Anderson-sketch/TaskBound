import path from 'node:path';
import { test, expect } from '@playwright/test';
import { launchApp } from './launch';

test.setTimeout(60_000);

const SCREENSHOT_DIR = path.resolve(__dirname, '..', 'docs', 'screenshots');

// Task 2.4 addendum, ruling 6: undo/redo through the global hotkey handler is
// visible in the strip immediately, and the planner's toast confirms it — even
// though the planner didn't trigger it itself — for BOTH an undo and a redo, one of
// which arrives via the planner's own keyboard shortcut (Ctrl+Shift+Z), not the
// hotkey seam.
test('undo via the hotkey handler updates the strip; the planner toast confirms undo and redo', async () => {
  const launched = await launchApp();
  try {
    const strip = await launched.window('strip');

    await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: { store: { dispatch: (a: unknown) => number } } }).__tb;
      const now = Date.now();
      // A real list/tag (not just bare titles) so planner-undo-toast.png's rail isn't
      // all-zero/empty.
      tb.store.dispatch({ type: 'list/add', id: 'seed-work', now, name: 'Work' });
      tb.store.dispatch({ type: 'task/add', id: 'a', now: now + 1, title: 'Draft Q3 roadmap', today: true, listId: 'seed-work', tags: ['planning'] });
      tb.store.dispatch({ type: 'task/add', id: 'b', now: now + 2, title: 'Reply to Priya about invoices', today: true, tags: ['finance'] });
    });

    await expect(strip.locator('.strip .title')).toContainText('Draft Q3 roadmap', { timeout: 5000 });

    // Complete "Draft Q3 roadmap" through the registered global-hotkey handler, not a direct
    // dispatch — this is the seam Task 2.4 adds: `hotkeyHandlers` is the exact record
    // passed to `hotkeys.apply()` (the `Hotkeys` instance itself exposes no handlers).
    await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: { hotkeyHandlers: { completeAdvance: () => void } } }).__tb;
      tb.hotkeyHandlers.completeAdvance();
    });

    await expect(strip.locator('.strip .title')).toContainText('Reply to Priya about invoices', { timeout: 2500 });

    // Undo through the same hotkey-handler seam.
    await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: { hotkeyHandlers: { undo: () => void } } }).__tb;
      tb.hotkeyHandlers.undo();
    });

    await expect(strip.locator('.strip .title')).toContainText('Draft Q3 roadmap', { timeout: 2500 });

    const lastUndoneLabel = await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: { store: { get: () => { lastUndone?: { label: string } } } } }).__tb;
      return tb.store.get().lastUndone?.label;
    });
    expect(lastUndoneLabel).toBe('Completed "Draft Q3 roadmap"');

    // Open the planner: its toast reads the CURRENT snapshot (fetched fresh via
    // `store:get` on mount), which already carries this `lastUndone`, so the toast
    // must appear without any further action.
    await launched.app.evaluate(() => {
      (globalThis as unknown as { __tb: { planner: { show: () => void } } }).__tb.planner.show();
    });
    const planner = await launched.window('planner', 5000);

    // `[role="status"]` alone is ambiguous: dnd-kit (planner drag-reorder) injects its
    // own hidden `#DndLiveRegion-*` with the same role, so scope to the toast's own
    // class (`.toast[role="status"]`, see Toast.tsx) to avoid a strict-mode violation.
    const toast = planner.locator('.toast[role="status"]');
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText('Undid: Completed');
    await planner.screenshot({ path: path.join(SCREENSHOT_DIR, 'planner-undo-toast.png') });

    // Redo via the planner's own keyboard shortcut (addendum ruling 3), not the
    // hotkey seam — there is no global redo hotkey.
    await planner.locator('body').click();
    await planner.keyboard.press('Control+Shift+Z');

    await expect(strip.locator('.strip .title')).toContainText('Reply to Priya about invoices', { timeout: 2500 });
    await expect(toast).toContainText('Redid: Completed', { timeout: 2500 });

    expect(launched.errors()).toEqual([]);
  } finally {
    await launched.close();
  }
});
