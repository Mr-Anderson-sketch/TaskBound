import { test, expect } from '@playwright/test';
import { launchApp, windowInfo } from './launch';

test.setTimeout(60_000);

// Task 1.8+1.9 acceptance: tasks, dock edge, and position survive a full restart
// against the same data dir.
test('restart preserves tasks, dock edge, and position', async () => {
  const first = await launchApp();
  const dataDir = first.dataDir;
  try {
    await first.window('strip');

    await first.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: { store: { dispatch: (a: unknown) => number } } }).__tb;
      tb.store.dispatch({ type: 'task/add', id: 'a', now: Date.now(), title: 'Task A', today: true });
      tb.store.dispatch({ type: 'task/add', id: 'b', now: Date.now(), title: 'Task B', today: true });
    });

    await first.app.evaluate(() => {
      (globalThis as unknown as { __tb: { strip: { setEdge: (e: string) => void } } }).__tb.strip.setEdge('top');
    });

    await expect
      .poll(
        async () => {
          const infos = await windowInfo(first.app);
          const strip = infos.find((w) => w.url.includes('#/strip'));
          return strip ? Math.abs(strip.bounds.y - strip.workArea.y) : Infinity;
        },
        { timeout: 5000 }
      )
      .toBeLessThanOrEqual(2);

    await first.app.evaluate(async () => {
      await (globalThis as unknown as { __tb: { store: { flush: () => Promise<void> } } }).__tb.store.flush();
    });
  } finally {
    await first.close();
  }

  const second = await launchApp({ dataDir });
  try {
    await second.window('strip');

    const taskCount = await second.app.evaluate(
      () => (globalThis as unknown as { __tb: { store: { get: () => { data: { tasks: unknown[] } } } } }).__tb.store.get().data.tasks.length
    );
    expect(taskCount).toBe(2);

    const edge = await second.app.evaluate(
      () =>
        (globalThis as unknown as { __tb: { store: { get: () => { data: { settings: { strip: { edge: string } } } } } } }).__tb.store.get()
          .data.settings.strip.edge
    );
    expect(edge).toBe('top');

    const infos = await windowInfo(second.app);
    const strip = infos.find((w) => w.url.includes('#/strip'))!;
    expect(Math.abs(strip.bounds.y - strip.workArea.y)).toBeLessThanOrEqual(2);

    expect(second.errors()).toEqual([]);
  } finally {
    await second.close();
  }
});
