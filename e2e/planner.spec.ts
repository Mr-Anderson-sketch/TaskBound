import path from 'node:path';
import { test, expect } from '@playwright/test';
import { launchApp } from './launch';

test.setTimeout(90_000);

const SCREENSHOT_DIR = path.resolve(__dirname, '..', 'docs', 'screenshots');

// Task 4.1 addendum ruling 9: the full planner shell — Today's sections, Upcoming's
// date grouping, rail navigation, inline capture defaulting to the current view's
// list, and a virtualised, fast Logbook with 500 done tasks.
test('planner: Today sections, Upcoming grouping, rail navigation, inline capture, and a virtualised Logbook', async () => {
  const launched = await launchApp();
  try {
    await launched.window('strip');

    // Seed 20 open Today tasks (Current + Up next) and 500 done tasks (Logbook
    // performance/virtualisation) through the e2e seam, in one app.evaluate loop.
    await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: { store: { dispatch: (a: unknown) => { rev: number } } } }).__tb;
      const now = Date.now();
      for (let i = 0; i < 20; i++) {
        tb.store.dispatch({ type: 'task/add', id: `open-${i}`, now, title: `Open task ${i}`, today: true });
      }
      // Oldest (i = 0) completed longest ago -> sorts LAST in the Logbook (newest first),
      // so it's the one visible after scrolling to the bottom.
      for (let i = 0; i < 500; i++) {
        const id = `done-${i}`;
        const at = now - (500 - i) * 1000;
        tb.store.dispatch({ type: 'task/add', id, now: at, title: `Done task ${i}` });
        tb.store.dispatch({ type: 'task/complete', id, now: at, by: 'user' });
      }
    });

    // A task due tomorrow, for Upcoming's "Tomorrow" grouping.
    await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: { store: { dispatch: (a: unknown) => { rev: number } } } }).__tb;
      const d = new Date();
      d.setDate(d.getDate() + 1);
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      tb.store.dispatch({ type: 'task/add', id: 'tomorrow-task', now: Date.now(), title: 'Tomorrow task', due: { date } });
    });

    await launched.app.evaluate(() => {
      (globalThis as unknown as { __tb: { planner: { show: () => void } } }).__tb.planner.show();
    });
    const planner = await launched.window('planner', 5000);

    // --- Today: "Current" and "Up next" sections -------------------------------------
    await expect(planner.locator('.sec')).toHaveCount(2, { timeout: 5000 });
    await expect(planner.locator('.sec')).toContainText(['Current', 'Up next']);
    await expect(planner.locator('.task.cur .t')).toContainText('Open task 0');

    // This spec seeds bulk placeholder tasks to exercise sections and virtualisation,
    // so its capture goes to its own filename. The documentation screenshot of Today
    // (realistic data, used by the README) is written by e2e/screens.spec.ts.
    await planner.screenshot({ path: path.join(SCREENSHOT_DIR, 'planner-sections.png') });

    // --- Upcoming: groups a task due tomorrow under "Tomorrow" -----------------------
    await planner.locator('.rail button', { hasText: 'Upcoming' }).click();
    await expect(planner.locator('.sec').first()).toHaveText('Tomorrow');
    await expect(planner.locator('.task .t', { hasText: 'Tomorrow task' })).toBeVisible();

    // --- Rail: selecting a list shows its tasks ---------------------------------------
    await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: { store: { dispatch: (a: unknown) => { rev: number } } } }).__tb;
      tb.store.dispatch({ type: 'list/add', id: 'work', now: Date.now(), name: 'Work' });
      tb.store.dispatch({ type: 'task/add', id: 'work-task', now: Date.now(), title: 'Work task', listId: 'work' });
    });
    await planner.locator('.rail button', { hasText: 'Work' }).click();
    await expect(planner.locator('.main .task .t')).toHaveText(['Work task']);

    // --- Inline capture from a list view adds the task to THAT list, not Today -------
    // (addendum ruling 7: defaultListId from the current view; today: true only on Today).
    await planner.locator('.tb .cap-trigger').click();
    const captureInput = planner.locator('.tb .cap input');
    await captureInput.fill('New work item');
    await captureInput.press('Enter');
    await expect(planner.locator('.main .task .t', { hasText: 'New work item' })).toBeVisible({ timeout: 2000 });

    const newTask = await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: { store: { get: () => { data: { tasks: Array<{ title: string; listId: string; today: boolean }> } } } } }).__tb;
      return tb.store.get().data.tasks.find((t) => t.title === 'New work item');
    });
    expect(newTask?.listId).toBe('work');
    expect(newTask?.today).toBe(false);

    // --- Logbook: virtualised, fast, and scrolls to the oldest completed task --------
    const timing = await planner.evaluate(async () => {
      const button = Array.from(document.querySelectorAll<HTMLElement>('.rail button')).find((el) => el.textContent?.includes('Logbook'))!;
      const start = performance.now();
      button.click();
      await new Promise<void>((resolve) => {
        const check = (): void => {
          if (document.querySelector('.main [role="option"]')) resolve();
          else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      });
      return performance.now() - start;
    });
    expect(timing).toBeLessThan(200);

    const rowCount = await planner.locator('.main [role="option"]').count();
    expect(rowCount).toBeLessThan(80);

    // Fix round 1, item 3: every option row (virtualised or not) reports its true
    // position/extent within the section, not just its handful of DOM neighbours.
    const firstOption = planner.locator('.main [role="option"]').first();
    await expect(firstOption).toHaveAttribute('aria-setsize', '500');
    await expect(firstOption).toHaveAttribute('aria-posinset', '1');

    await planner.evaluate(() => {
      const scroller = document.querySelector('.main [role="listbox"]') as HTMLElement;
      scroller.scrollTop = scroller.scrollHeight;
    });
    await expect(planner.locator('.task .t', { hasText: 'Done task 0' })).toBeVisible({ timeout: 2000 });
    await expect(planner.locator('.main [role="option"]').last()).toHaveAttribute('aria-posinset', '500');

    expect(launched.errors()).toEqual([]);
  } finally {
    await launched.close();
  }
});
