// e2e/soak.spec.ts — Deliverable 1 (ship-measurement): a long-running stability soak.
// Skipped by default (test.skip below) so `npm run e2e` never picks this up; run it
// explicitly with `npm run e2e:soak` (sets TB_SOAK=1). Drives the strip/palette/planner
// through capture, complete, timer start/pause, theme switching, and window show/hide in
// a ~5s loop for 10 minutes wall clock, collecting console errors from every window plus
// main-process stderr, then records per-process memory via app.getAppMetrics() into
// docs/SOAK.md.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { launchApp } from './launch';

const SOAK_MS = 10 * 60_000;
const TICK_MS = 5_000;
const DOC_PATH = path.resolve(__dirname, '..', 'docs', 'SOAK.md');

const THEMES = ['ledger', 'kraft', 'phosphor', 'slate'] as const;
const MODES = ['light', 'dark'] as const;

type Evaluable = {
  __tb: {
    store: {
      dispatch: (a: unknown) => unknown;
      get: () => { data: { tasks: Array<{ id: string; done?: boolean; timer?: { runningSince?: number } }> } };
    };
    palette: { show: (m: string) => void; hide: () => void };
    planner: { show: () => void; hide: () => void };
  };
};

test('soak: 10 minutes of capture/complete/timer/theme/window churn with zero console or main-process errors', async () => {
  test.skip(!process.env.TB_SOAK, 'set TB_SOAK=1 (npm run e2e:soak) to run the soak test');
  test.setTimeout(12 * 60_000);

  const launched = await launchApp();
  const mainErrors: string[] = [];
  const proc = launched.app.process();
  proc.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    // Electron/Chromium emit a lot of benign stderr noise (GPU/DevTools chatter); only
    // count lines that look like real JS errors/stack traces.
    if (/error|exception|unhandled/i.test(text)) mainErrors.push(text.trim());
  });

  try {
    await launched.window('strip');

    const start = Date.now();
    let iterations = 0;
    let themeIdx = 0;

    while (Date.now() - start < SOAK_MS) {
      const action = iterations % 6;
      try {
        if (action === 0) {
          // --- capture a task via the palette -------------------------------------
          await launched.app.evaluate((_e) => {
            (globalThis as unknown as Evaluable).__tb.palette.show('capture');
          });
          const palette = await launched.window('palette', 5000);
          const input = palette.locator('.palette input');
          await input.click();
          await input.fill(`Soak task ${iterations} @ ${Date.now()}`);
          await input.press('Enter');
        } else if (action === 1) {
          // --- complete a task (dispatched directly, same as other e2e specs) ----
          await launched.app.evaluate(() => {
            const tb = (globalThis as unknown as Evaluable).__tb;
            const open = tb.store.get().data.tasks.find((t) => !t.done);
            if (open) tb.store.dispatch({ type: 'task/complete', id: open.id, now: Date.now(), by: 'user' });
          });
        } else if (action === 2) {
          // --- start or pause the timer on whatever task is current -----------------
          await launched.app.evaluate(() => {
            const tb = (globalThis as unknown as Evaluable).__tb;
            const tasks = tb.store.get().data.tasks.filter((t) => !t.done);
            const running = tasks.find((t) => t.timer?.runningSince !== undefined);
            if (running) {
              tb.store.dispatch({ type: 'timer/pause', id: running.id, now: Date.now() });
            } else if (tasks.length > 0) {
              tb.store.dispatch({ type: 'timer/start', id: tasks[0].id, now: Date.now() });
            }
          });
        } else if (action === 3) {
          // --- cycle theme (4 themes x light/dark) -----------------------------------
          const theme = THEMES[themeIdx % THEMES.length];
          const mode = MODES[Math.floor(themeIdx / THEMES.length) % MODES.length];
          themeIdx++;
          await launched.app.evaluate(
            (_electron, { name, mode }) => {
              const tb = (globalThis as unknown as Evaluable).__tb;
              tb.store.dispatch({ type: 'settings/patch', now: Date.now(), patch: { theme: { name, mode } } });
            },
            { name: theme, mode }
          );
        } else if (action === 4) {
          // --- open/close the planner --------------------------------------------
          await launched.app.evaluate(() => (globalThis as unknown as Evaluable).__tb.planner.show());
          await launched.window('planner', 5000);
          await launched.app.evaluate(() => (globalThis as unknown as Evaluable).__tb.planner.hide());
        } else {
          // --- open/close the palette ---------------------------------------------
          await launched.app.evaluate(() => (globalThis as unknown as Evaluable).__tb.palette.show('capture'));
          await launched.window('palette', 5000);
          await launched.app.evaluate(() => (globalThis as unknown as Evaluable).__tb.palette.hide());
        }
      } catch (err) {
        mainErrors.push(`iteration ${iterations} action ${action} threw: ${err instanceof Error ? err.message : String(err)}`);
      }

      iterations++;
      const elapsed = Date.now() - start;
      const nextTick = start + iterations * TICK_MS;
      const wait = Math.max(0, nextTick - Date.now());
      if (elapsed < SOAK_MS) await new Promise((r) => setTimeout(r, wait));
    }

    const durationMs = Date.now() - start;

    // --- per-process memory ---------------------------------------------------------
    const metrics = await launched.app.evaluate(({ app }) => app.getAppMetrics());

    const consoleErrors = launched.errors();
    const allErrors = [...consoleErrors, ...mainErrors];

    // --- write docs/SOAK.md before asserting, so a failure still leaves the report --
    const rows = metrics
      .map((m) => {
        const mb = (n: number | undefined) => (n === undefined ? 'n/a' : (n / 1024).toFixed(1));
        return `| ${m.type} | ${m.pid} | ${mb(m.memory?.workingSetSize)} | ${mb(m.memory?.privateBytes)} |`;
      })
      .join('\n');

    const doc = `# Soak test — docs/SOAK.md

- Date: ${new Date().toISOString()}
- Machine: Windows 11, 1366x768 display
- Duration: ${(durationMs / 60000).toFixed(2)} min (target 10 min)
- Iterations: ${iterations}
- Console/main-process errors: ${allErrors.length}

## Process memory (app.getAppMetrics(), at end of soak)

| process type | pid | workingSetSize (MB) | privateBytes (MB) |
| --- | --- | --- | --- |
${rows}

${allErrors.length > 0 ? `## Errors\n\n\`\`\`\n${allErrors.slice(0, 50).join('\n')}\n\`\`\`\n` : ''}
`;
    fs.mkdirSync(path.dirname(DOC_PATH), { recursive: true });
    fs.writeFileSync(DOC_PATH, doc);

    expect(allErrors).toEqual([]);
  } finally {
    await launched.close();
  }
});
