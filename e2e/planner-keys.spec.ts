import path from 'node:path';
import { test, expect } from '@playwright/test';
import { launchApp } from './launch';

test.setTimeout(90_000);

const SCREENSHOT_DIR = path.resolve(__dirname, '..', 'docs', 'screenshots');

// Task 4.2 addendum ruling 7: keyboard-only flow through the planner — j/k navigation
// and single-key actions, Shift+reorder, undo after delete, and the in-planner command
// palette (Ctrl+K on win32/linux, Meta+K on darwin). `locator.press()` focuses its
// element before sending the key, so an explicit click/focus is only needed once, to
// document that the container itself (not a row) is what owns the keyboard model.
test('planner: keyboard model — nav, complete, reorder, today, delete+undo, snooze, and the command palette', async () => {
  const launched = await launchApp();
  try {
    await launched.window('strip');

    // Seed three plain Today tasks (same list, no parent) — true task/move siblings —
    // in a known order.
    await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: { store: { dispatch: (a: unknown) => { rev: number } } } }).__tb;
      const now = Date.now();
      tb.store.dispatch({ type: 'task/add', id: 'k1', now, title: 'First task', today: true });
      tb.store.dispatch({ type: 'task/add', id: 'k2', now: now + 1, title: 'Second task', today: true });
      tb.store.dispatch({ type: 'task/add', id: 'k3', now: now + 2, title: 'Third task', today: true });
    });

    await launched.app.evaluate(() => {
      (globalThis as unknown as { __tb: { planner: { show: () => void } } }).__tb.planner.show();
    });
    const planner = await launched.window('planner', 5000);

    const list = planner.locator('.tl-scroll');
    await list.focus(); // ruling 6: the container is tabIndex=0 and owns the keyboard model
    // The container auto-selects the first row once it has visible rows (ruling 2's
    // "selects the first row when nothing is selected", applied proactively) — so
    // "First task" is already selected here, before any keypress.
    await expect(planner.locator('.task.sel .t')).toHaveText('First task', { timeout: 3000 });

    // --- j j Space: First -> Second -> Third, then complete the third task ---
    await list.press('j');
    await list.press('j');
    await expect(planner.locator('.task.sel .t')).toHaveText('Third task');
    await list.press(' ');
    await expect(planner.locator('.sec', { hasText: 'Done' })).toBeVisible({ timeout: 3000 });
    await expect(planner.locator('.task', { hasText: 'Third task' })).toHaveClass(/done/);

    const platform = await launched.app.evaluate(() => process.platform);

    // --- k then Shift+ArrowUp: reorder the second task ahead of the first ---
    await list.press('k'); // Third (still selected, now in "Done") -> Second
    await expect(planner.locator('.task.sel .t')).toHaveText('Second task');
    await list.press('Shift+ArrowUp');

    const orderAfterReorder = await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: { store: { get: () => { data: { tasks: Array<{ id: string; order: number }> } } } } }).__tb;
      const tasks = tb.store.get().data.tasks;
      return { k1: tasks.find((t) => t.id === 'k1')!.order, k2: tasks.find((t) => t.id === 'k2')!.order };
    });
    expect(orderAfterReorder.k2).toBeLessThan(orderAfterReorder.k1);
    // Selection stays on the moved task (ruling 3).
    await expect(planner.locator('.task.sel .t')).toHaveText('Second task');

    // --- t: toggle today off the selected task ---
    await list.press('t');
    const todayAfterToggle = await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: { store: { get: () => { data: { tasks: Array<{ id: string; today: boolean }> } } } } }).__tb;
      return tb.store.get().data.tasks.find((t) => t.id === 'k2')!.today;
    });
    expect(todayAfterToggle).toBe(false);
    // Toggling `today` off removed that task from Today's visible rows, which moved
    // keyboard selection elsewhere (the "selection follows the next visible row" rule
    // this task also implements) — restore it with a direct dispatch rather than a
    // second `t` press, which would now land on a different task.
    await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: { store: { dispatch: (a: unknown) => { rev: number } } } }).__tb;
      tb.store.dispatch({ type: 'task/setToday', ids: ['k2'], now: Date.now(), today: true });
    });

    // --- x: delete the selected task; toast shows Deleted "..." with Undo; Undo restores it ---
    const selectedTitle = await planner.locator('.task.sel .t').textContent();
    await list.press('x');
    const toast = planner.locator('[role="status"]');
    await expect(toast).toContainText(`Deleted "${selectedTitle}"`, { timeout: 3000 });
    await expect(planner.locator('.task .t', { hasText: selectedTitle! })).toHaveCount(0);
    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(planner.locator('.task .t', { hasText: selectedTitle! })).toBeVisible({ timeout: 3000 });

    // --- s then Tomorrow: snoozedUntil is tomorrow 09:00 local ---
    await list.press('s');
    const menu = planner.locator('[role="menu"]');
    await expect(menu).toBeVisible({ timeout: 3000 });
    await menu.getByRole('menuitem', { name: 'Tomorrow' }).click();
    await expect(menu).toHaveCount(0);

    const snoozedUntil = await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: { store: { get: () => { data: { tasks: Array<{ snoozedUntil?: number }> } } } } }).__tb;
      return tb.store.get().data.tasks.find((t) => t.snoozedUntil !== undefined)?.snoozedUntil;
    });
    expect(snoozedUntil).toBeDefined();
    const expectedTomorrow9am = (() => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d.getTime();
    })();
    expect(snoozedUntil).toBe(expectedTomorrow9am);

    // --- Ctrl+K (Meta+K on darwin), type "inbox", Enter -> view title is Inbox ---
    await list.press(platform === 'darwin' ? 'Meta+K' : 'Control+K');
    const palette = planner.locator('[role="dialog"]');
    await expect(palette).toBeVisible({ timeout: 3000 });
    await palette.locator('input').fill('inbox');
    await expect(palette.locator('[role="option"]').first()).toContainText('Go to Inbox');
    await planner.screenshot({ path: path.join(SCREENSHOT_DIR, 'planner-commands.png') });
    await palette.locator('input').press('Enter');
    await expect(palette).toHaveCount(0);
    await expect(planner.locator('.main .h .d')).toHaveText('Inbox', { timeout: 3000 });

    expect(launched.errors()).toEqual([]);
  } finally {
    await launched.close();
  }
});
