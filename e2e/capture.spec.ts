import { test, expect } from '@playwright/test';
import { launchApp, windowInfo } from './launch';

test.setTimeout(60_000);

// Task 1.8+1.9 acceptance: the capture palette adds a task, updates the strip, and
// hides itself — without ever giving the (non-focusable) strip window OS focus.
test('capture palette adds a task and hides, strip stays unfocused', async () => {
  const launched = await launchApp();
  try {
    await launched.window('strip');

    await launched.app.evaluate(() => {
      (globalThis as unknown as { __tb: { palette: { show: (m: string) => void } } }).__tb.palette.show('capture');
    });

    const palette = await launched.window('palette', 5000);
    const beforeInfos = await windowInfo(launched.app);
    expect(beforeInfos.find((w) => w.url.includes('#/palette'))?.visible).toBe(true);

    const input = palette.locator('.palette input');
    await input.click();
    await input.fill('Write the baseline doc');
    await input.press('Enter');

    const strip = await launched.window('strip');
    await expect(strip.locator('.strip .title')).toContainText('Write the baseline doc', { timeout: 2000 });

    await expect
      .poll(
        async () => {
          const infos = await windowInfo(launched.app);
          return infos.find((w) => w.url.includes('#/palette'))?.visible ?? false;
        },
        { timeout: 3000 }
      )
      .toBe(false);

    const afterInfos = await windowInfo(launched.app);
    const stripInfo = afterInfos.find((w) => w.url.includes('#/strip'))!;
    expect(stripInfo.focused).toBe(false);

    expect(launched.errors()).toEqual([]);
  } finally {
    await launched.close();
  }
});

// Task 2.2 acceptance: typed text is live-parsed into token chips (when/timer/tag/list/
// repeat), and Enter dispatches a task carrying every field the parser found.
test('capture live-parses tokens into chips and dispatches a fully-parsed task', async () => {
  const launched = await launchApp();
  try {
    await launched.window('strip');
    await launched.app.evaluate(() => {
      (globalThis as unknown as { __tb: { palette: { show: (m: string) => void } } }).__tb.palette.show('capture');
    });
    const palette = await launched.window('palette', 5000);

    const input = palette.locator('.palette input');
    await input.click();
    await input.type('call bank tomorrow 3pm #finance');

    const chips = palette.locator('.palette .tok');
    await expect(chips).toHaveCount(3, { timeout: 2000 }); // title, when, tag
    await expect(chips).toContainText(['#finance']);

    await input.press('Enter');

    const tasks = await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: { store: { get: () => { data: { tasks: unknown[] } } } } }).__tb;
      return tb.store.get().data.tasks as Array<{ title: string; due?: { time?: string }; tags: string[] }>;
    });
    const task = tasks.find((t) => t.title === 'call bank');
    expect(task).toBeDefined();
    expect(task!.due?.time).toBe('15:00');
    expect(task!.tags).toContain('finance');

    const strip = await launched.window('strip');
    await expect(strip.locator('.strip .title')).toContainText('call bank', { timeout: 2000 });

    expect(launched.errors()).toEqual([]);
  } finally {
    await launched.close();
  }
});

// Task 2.2 acceptance: Escape once disables parsing (wraps the text in quotes) and keeps
// the palette open; Enter after that adds the literal text with no parsed fields.
test('Escape then Enter keeps the typed text literal', async () => {
  const launched = await launchApp();
  try {
    await launched.window('strip');
    await launched.app.evaluate(() => {
      (globalThis as unknown as { __tb: { palette: { show: (m: string) => void } } }).__tb.palette.show('capture');
    });
    const palette = await launched.window('palette', 5000);

    const input = palette.locator('.palette input');
    await input.click();
    await input.type('tomorrow');
    await input.press('Escape');

    await expect(input).toHaveValue('"tomorrow"');
    const infos = await windowInfo(launched.app);
    expect(infos.find((w) => w.url.includes('#/palette'))?.visible).toBe(true);

    await input.press('Enter');

    const tasks = await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: { store: { get: () => { data: { tasks: unknown[] } } } } }).__tb;
      return tb.store.get().data.tasks as Array<{ title: string; due?: unknown }>;
    });
    const task = tasks.find((t) => t.title === 'tomorrow');
    expect(task).toBeDefined();
    expect(task!.due).toBeUndefined();

    expect(launched.errors()).toEqual([]);
  } finally {
    await launched.close();
  }
});

// Task 2.2 acceptance: pasting several non-empty lines adds one task per line and hides
// the palette, instead of capturing the whole paste as a single title.
test('pasting multiple lines adds one task per line', async () => {
  const launched = await launchApp();
  try {
    await launched.window('strip');
    await launched.app.evaluate(() => {
      (globalThis as unknown as { __tb: { palette: { show: (m: string) => void } } }).__tb.palette.show('capture');
    });
    const palette = await launched.window('palette', 5000);

    const input = palette.locator('.palette input');
    await input.click();

    await palette.evaluate(() => {
      const el = document.querySelector('.palette input') as HTMLInputElement;
      const dt = new DataTransfer();
      dt.setData('text/plain', 'buy milk\ncall bank\nwrite report');
      const event = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      el.dispatchEvent(event);
    });

    await expect
      .poll(
        async () => {
          const infos = await windowInfo(launched.app);
          return infos.find((w) => w.url.includes('#/palette'))?.visible ?? false;
        },
        { timeout: 3000 }
      )
      .toBe(false);

    const tasks = await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: { store: { get: () => { data: { tasks: unknown[] } } } } }).__tb;
      return tb.store.get().data.tasks as Array<{ title: string }>;
    });
    expect(tasks.map((t) => t.title).sort()).toEqual(['buy milk', 'call bank', 'write report']);

    expect(launched.errors()).toEqual([]);
  } finally {
    await launched.close();
  }
});
