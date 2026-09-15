import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { launchApp } from './launch';

test.setTimeout(60_000);

// Task 1.8+1.9 acceptance: a legacy state.json is imported (27 tasks), copied
// verbatim to legacy-state.json, and the original file is left untouched
// (CLAUDE.md: "never delete user files").
test('legacy state.json is imported without being modified', async () => {
  const legacyFixture = path.resolve(__dirname, '../tests/fixtures/legacy-state.json');
  const originalBytes = await readFile(legacyFixture, 'utf8');

  const launched = await launchApp({ legacyStateFixture: legacyFixture });
  try {
    await launched.window('strip');

    const taskCount = await launched.app.evaluate(
      () => (globalThis as unknown as { __tb: { store: { get: () => { data: { tasks: unknown[] } } } } }).__tb.store.get().data.tasks.length
    );
    expect(taskCount).toBe(27);

    const legacyCopyPath = path.join(launched.dataDir, 'legacy-state.json');
    const legacyCopy = await readFile(legacyCopyPath, 'utf8');
    expect(legacyCopy.length).toBeGreaterThan(0);

    const stateJsonPath = path.join(launched.dataDir, 'state.json');
    const stateJsonBytes = await readFile(stateJsonPath, 'utf8');
    expect(stateJsonBytes).toBe(originalBytes);

    expect(launched.errors()).toEqual([]);
  } finally {
    await launched.close();
  }
});
