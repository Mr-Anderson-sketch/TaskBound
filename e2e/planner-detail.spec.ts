import path from 'node:path';
import { test, expect } from '@playwright/test';
import { launchApp } from './launch';

test.setTimeout(90_000);

const SCREENSHOT_DIR = path.resolve(__dirname, '..', 'docs', 'screenshots');

type Evaluable = { __tb: { store: { dispatch: (a: unknown) => { rev: number }; get: () => { data: unknown } } } };

// Task 4.3 addendum ruling 7: drag the third row above the first in Today (real
// Playwright mouse steps: down, move > 6 px, move to the target, up) — the store order
// changes and persists after relaunch against the same data dir.
test('planner: drag reorder persists after relaunch', async () => {
  const launched = await launchApp();
  const dataDir = launched.dataDir;
  try {
    await launched.window('strip');

    await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as Evaluable).__tb;
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
    await list.focus();
    await expect(planner.locator('.task.sel .t')).toHaveText('First task', { timeout: 3000 });

    // All three land in Today's single "Up next" section (none is a real "current" task
    // until one has focus/makeCurrent — the auto-selected first row here is just
    // candidates()[0], rendered as "Current"). Drag is scoped to "Up next" (ruling 4),
    // so pick the drag source/target from rows actually inside it.
    const source = planner.locator('[data-row-id="k3"]');
    const target = planner.locator('[data-row-id="k1"]');
    await expect(source).toBeVisible({ timeout: 3000 });
    await expect(target).toBeVisible({ timeout: 3000 });

    const sourceBox = (await source.boundingBox())!;
    const targetBox = (await target.boundingBox())!;

    await planner.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await planner.mouse.down();
    // Cross the 6 px PointerSensor activation distance before the first "real" move.
    await planner.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2 - 12, { steps: 5 });
    await planner.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 });
    await planner.mouse.up();

    await expect
      .poll(async () =>
        launched.app.evaluate(() => {
          const tb = (globalThis as unknown as Evaluable).__tb;
          const tasks = (tb.store.get().data as { tasks: Array<{ id: string; order: number }> }).tasks;
          const k1 = tasks.find((t) => t.id === 'k1')!.order;
          const k3 = tasks.find((t) => t.id === 'k3')!.order;
          return k3 < k1;
        })
      )
      .toBe(true);

    await launched.app.evaluate(async () => {
      await (globalThis as unknown as { __tb: { store: { flush: () => Promise<void> } } }).__tb.store.flush();
    });

    expect(launched.errors()).toEqual([]);
  } finally {
    await launched.close();
  }

  const relaunched = await launchApp({ dataDir });
  try {
    await relaunched.window('strip');
    const orders = await relaunched.app.evaluate(() => {
      const tb = (globalThis as unknown as Evaluable).__tb;
      const tasks = (tb.store.get().data as { tasks: Array<{ id: string; order: number }> }).tasks;
      return {
        k1: tasks.find((t) => t.id === 'k1')!.order,
        k2: tasks.find((t) => t.id === 'k2')!.order,
        k3: tasks.find((t) => t.id === 'k3')!.order
      };
    });
    expect(orders.k3).toBeLessThan(orders.k1);
    expect(orders.k3).toBeLessThan(orders.k2);
    expect(relaunched.errors()).toEqual([]);
  } finally {
    await relaunched.close();
  }
});

// Task 4.3 addendum ruling 7: the detail pane (title rename, tags, repeats, sub-tasks,
// timer) and list rename/delete from the rail.
test('planner: detail pane — title, tags, repeats, sub-tasks, timer, and list management', async () => {
  const launched = await launchApp();
  try {
    await launched.window('strip');

    await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as Evaluable).__tb;
      tb.store.dispatch({ type: 'task/add', id: 'main', now: Date.now(), title: 'Baseline doc', today: true });
    });
    await launched.app.evaluate(() => {
      (globalThis as unknown as { __tb: { planner: { show: () => void } } }).__tb.planner.show();
    });
    const planner = await launched.window('planner', 5000);

    const list = planner.locator('.tl-scroll');
    await list.focus();
    await expect(planner.locator('.task.sel .t')).toHaveText('Baseline doc', { timeout: 3000 });

    // --- Enter opens the detail pane (three-column layout: the 1000 px default window
    // width is >= the 900 px threshold). -------------------------------------------
    await list.press('Enter');
    const detail = planner.locator('.detail');
    await expect(detail).toBeVisible({ timeout: 3000 });

    // --- rename the title ------------------------------------------------------------
    const titleInput = detail.locator('.detail-title');
    await titleInput.fill('Write the baseline document');
    await titleInput.blur();
    await expect(planner.locator('.task .t', { hasText: 'Write the baseline document' })).toBeVisible({ timeout: 3000 });

    // --- add two tags ------------------------------------------------------------------
    const tagInput = detail.locator('.tag-input input');
    await tagInput.fill('deep');
    await tagInput.press('Enter');
    await tagInput.fill('audit');
    await tagInput.press('Enter');
    await expect(detail.locator('.tag-input .chip')).toHaveCount(2, { timeout: 3000 });

    // --- notes (autosave) — filled for the screenshot; not asserted beyond that ------
    await detail.locator('.detail-notes').fill('Screenshots first, then the audit table.');

    // --- repeats: Weekly, Mon + Wed -----------------------------------------------
    await detail.getByRole('button', { name: 'Edit' }).click();
    const recur = detail.locator('.recur-editor');
    await expect(recur).toBeVisible({ timeout: 3000 });
    await recur.getByRole('radio', { name: 'Weekly' }).click();
    await recur.locator('.recur-days .day', { hasText: 'Mon' }).click();
    await recur.locator('.recur-days .day', { hasText: 'Wed' }).click();
    await recur.getByRole('button', { name: 'Save' }).click();
    await expect(recur).toHaveCount(0);

    const afterRecur = await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as Evaluable).__tb;
      const tasks = (tb.store.get().data as { tasks: Array<{ id: string; recurrence?: unknown; due?: unknown }> }).tasks;
      const main = tasks.find((t) => t.id === 'main')!;
      return { recurrence: main.recurrence, due: main.due };
    });
    expect(afterRecur.recurrence).toEqual({ kind: 'weekly', days: [1, 3] });
    expect(afterRecur.due).toBeDefined();

    // --- planned time (for the screenshot, matching variant A's "of 25 min") --------
    await detail.locator('.detail-planned-input').fill('25');
    await detail.locator('.detail-planned-input').blur();
    await expect(detail.locator('.detail-planned')).toHaveText('of 25 min', { timeout: 3000 });

    // --- add a sub-task: indented under the parent, parent shows "0/1" --------------
    const subAdd = detail.locator('.subtask-add');
    await subAdd.fill('Write the audit table');
    await subAdd.press('Enter');
    await expect(detail.locator('.subtask-title')).toHaveValue('Write the audit table', { timeout: 3000 });
    await expect(planner.locator('.task.sub .t')).toHaveText('Write the audit table', { timeout: 3000 });
    await expect(planner.locator('.task .progress', { hasText: '0/1' })).toBeVisible({ timeout: 3000 });

    await planner.screenshot({ path: path.join(SCREENSHOT_DIR, 'planner-detail.png') });

    // --- timer: Start (pomodoro off, this task is Today's only/current task) --------
    await detail.getByRole('button', { name: 'Start' }).click();
    await expect
      .poll(async () =>
        launched.app.evaluate(() => {
          const tb = (globalThis as unknown as Evaluable).__tb;
          const tasks = (tb.store.get().data as { tasks: Array<{ id: string; timer?: { runningSince?: number } }> }).tasks;
          return tasks.find((t) => t.id === 'main')!.timer?.runningSince !== undefined;
        })
      )
      .toBe(true);

    // --- Stop: runningSince cleared --------------------------------------------------
    await detail.getByRole('button', { name: 'Stop' }).click();
    await expect
      .poll(async () =>
        launched.app.evaluate(() => {
          const tb = (globalThis as unknown as Evaluable).__tb;
          const tasks = (tb.store.get().data as { tasks: Array<{ id: string; timer?: { runningSince?: number } }> }).tasks;
          return tasks.find((t) => t.id === 'main')!.timer?.runningSince;
        })
      )
      .toBe(undefined);

    await detail.locator('.detail-close').click();
    await expect(detail).toHaveCount(0);

    // --- rail: create a list, rename it, delete it moving tasks to Inbox ------------
    await planner.locator('[aria-label="Add list"]').click();
    const newListInput = planner.locator('[aria-label="New list name"]');
    await newListInput.fill('Errands');
    await newListInput.press('Enter');
    await expect(planner.locator('.rail-list-row', { hasText: 'Errands' })).toBeVisible({ timeout: 3000 });

    const newListId = await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as Evaluable).__tb;
      const lists = (tb.store.get().data as { lists: Array<{ id: string; name: string }> }).lists;
      return lists.find((l) => l.name === 'Errands')!.id;
    });
    await launched.app.evaluate((listId) => {
      const tb = (globalThis as unknown as Evaluable).__tb;
      tb.store.dispatch({ type: 'task/add', id: 'errand-1', now: Date.now(), title: 'Buy stamps', listId });
    }, newListId);

    await planner.locator('.rail-list-row .i', { hasText: 'Errands' }).dblclick();
    const renameInput = planner.locator('[aria-label="Rename list Errands"]');
    await expect(renameInput).toBeVisible({ timeout: 3000 });
    await renameInput.fill('Chores');
    await renameInput.press('Enter');
    await expect(planner.locator('.rail-list-row', { hasText: 'Chores' })).toBeVisible({ timeout: 3000 });

    await planner.locator('[aria-label="List options for Chores"]').click();
    const optionsMenu = planner.locator('.list-options');
    await expect(optionsMenu).toBeVisible({ timeout: 3000 });
    await optionsMenu.getByRole('menuitem', { name: 'Delete' }).click();
    await optionsMenu.getByRole('button', { name: 'Delete' }).click();
    await expect(planner.locator('.rail-list-row', { hasText: 'Chores' })).toHaveCount(0, { timeout: 3000 });

    const afterDelete = await launched.app.evaluate((listId) => {
      const tb = (globalThis as unknown as Evaluable).__tb;
      const data = tb.store.get().data as { lists: Array<{ id: string }>; tasks: Array<{ id: string; listId: string }> };
      return { listGone: !data.lists.some((l) => l.id === listId), errandListId: data.tasks.find((t) => t.id === 'errand-1')?.listId };
    }, newListId);
    expect(afterDelete.listGone).toBe(true);
    expect(afterDelete.errandListId).toBe('inbox');

    expect(launched.errors()).toEqual([]);
  } finally {
    await launched.close();
  }
});
