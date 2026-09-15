import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchApp } from './launch';
import { fromJson } from '../src/core/export';
import type { Data, Task } from '../src/core/types';

test.setTimeout(60_000);

/**
 * `launchApp()`, retrying on a launch failure. Relaunching against the exact same
 * `userData` path shortly after a prior instance's `close()` (used below by the
 * data-location-pointer tests, which deliberately reuse one `appDataRoot` across two
 * sequential launches) can occasionally lose Electron's single-instance lock if the
 * OS hasn't finished releasing the previous process's lock yet — worse the busier the
 * machine is (e.g. other apps/builders using Electron concurrently). A short backoff
 * and a couple of retries make that OS-timing race a non-issue without masking a
 * real, consistent app failure (which would still fail every attempt).
 */
async function launchAppRetrying(opts: Parameters<typeof launchApp>[0] = {}, attempts = 3): Promise<Awaited<ReturnType<typeof launchApp>>> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 750));
    try {
      return await launchApp(opts);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

// Task 5.3 acceptance, all against temp dirs: export/import via the e2e seam
// (globalThis.__tb.data — the exact code the real dialog-backed IPC handlers call),
// the external-change watcher, and folder switching.

test('export JSON via the seam writes a file whose task ids match the store', async () => {
  const launched = await launchApp();
  try {
    await launched.window('strip');

    await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: { store: { dispatch: (a: unknown) => number } } }).__tb;
      tb.store.dispatch({ type: 'task/add', id: 'export-a', now: Date.now(), title: 'Export me A' });
      tb.store.dispatch({ type: 'task/add', id: 'export-b', now: Date.now(), title: 'Export me B' });
    });

    const storeTaskIds = await launched.app.evaluate(
      () => (globalThis as unknown as { __tb: { store: { get: () => { data: { tasks: Array<{ id: string }> } } } } }).__tb.store.get().data.tasks.map((t) => t.id).sort()
    );

    const exportDir = await mkdtemp(path.join(tmpdir(), 'timebound-e2e-export-'));
    const filePath = path.join(exportDir, 'export.json');

    const result = await launched.app.evaluate(
      async (_electron, { filePath }) => {
        const tb = (globalThis as unknown as { __tb: { data: { exportTo: (format: 'json' | 'md', p: string) => Promise<{ path?: string }> } } }).__tb;
        return tb.data.exportTo('json', filePath);
      },
      { filePath }
    );
    expect(result.path).toBe(filePath);
    expect(existsSync(filePath)).toBe(true);

    const text = await readFile(filePath, 'utf8');
    const exported: Data = fromJson(text);
    expect(exported.tasks.map((t) => t.id).sort()).toEqual(storeTaskIds);
  } finally {
    await launched.close();
  }
});

test('import a Markdown fixture via the seam increases the task count and adds a new list', async () => {
  const launched = await launchApp();
  try {
    await launched.window('strip');

    const before = await launched.app.evaluate(
      () =>
        (globalThis as unknown as { __tb: { store: { get: () => { data: { tasks: unknown[]; lists: Array<{ name: string }> } } } } }).__tb.store.get()
          .data
    );

    const importDir = await mkdtemp(path.join(tmpdir(), 'timebound-e2e-import-'));
    const filePath = path.join(importDir, 'fixture.md');
    const fixture = ['# Imported Project', '- [ ] First imported task', '- [x] Second imported task (already done)', '  - [ ] A subtask'].join('\n');
    await writeFile(filePath, fixture, 'utf8');

    const result = await launched.app.evaluate(
      async (_electron, { filePath }) => {
        const tb = (globalThis as unknown as { __tb: { data: { importFrom: (p: string) => Promise<{ imported?: number; error?: string }> } } }).__tb;
        return tb.data.importFrom(filePath);
      },
      { filePath }
    );
    expect(result.error).toBeUndefined();
    expect(result.imported).toBe(3);

    const after = await launched.app.evaluate(
      () =>
        (globalThis as unknown as { __tb: { store: { get: () => { data: { tasks: Task[]; lists: Array<{ name: string }> } } } } }).__tb.store.get()
          .data
    );

    expect(after.tasks.length).toBe(before.tasks.length + 3);
    expect(after.lists.some((l) => l.name === 'Imported Project')).toBe(true);
    expect(after.tasks.some((t) => t.title === 'Second imported task (already done)' && t.status === 'done')).toBe(true);
  } finally {
    await launched.close();
  }
});

test('an external modification to data.json is reflected in the store within 3 seconds', async () => {
  const launched = await launchApp();
  try {
    await launched.window('strip');

    // Let any launch-time dispatch (e.g. the daily rollover, which always runs once
    // on startup) finish its own debounced save first, so it can't race with — and
    // clobber — the external write below.
    await launched.app.evaluate(async () => {
      await (globalThis as unknown as { __tb: { store: { flush: () => Promise<void> } } }).__tb.store.flush();
    });

    const current = await launched.app.evaluate(() => (globalThis as unknown as { __tb: { store: { get: () => { data: Data } } } }).__tb.store.get().data);

    const externalTask: Task = {
      id: 'external-task',
      title: 'Added by an external tool',
      listId: current.lists[0].id,
      tags: [],
      order: 999_999,
      today: false,
      status: 'open',
      createdAt: current.meta.lastSavedAt + 1,
      updatedAt: current.meta.lastSavedAt + 1
    };
    const externalData: Data = {
      ...current,
      tasks: [...current.tasks, externalTask],
      meta: { ...current.meta, lastSavedAt: current.meta.lastSavedAt + 60_000 }
    };

    await writeFile(path.join(launched.dataDir, 'data.json'), JSON.stringify(externalData, null, 2), 'utf8');

    await expect
      .poll(
        async () =>
          launched.app.evaluate(
            () => (globalThis as unknown as { __tb: { store: { get: () => { data: { tasks: Array<{ id: string }> } } } } }).__tb.store.get().data.tasks.some((t) => t.id === 'external-task')
          ),
        { timeout: 3000, intervals: [200] }
      )
      .toBe(true);
  } finally {
    await launched.close();
  }
});

test('switching the data dir via the seam creates data.json in the new folder and keeps the old one', async () => {
  const launched = await launchApp();
  try {
    await launched.window('strip');
    const oldDir = launched.dataDir;
    expect(existsSync(path.join(oldDir, 'data.json'))).toBe(true);

    const newDir = await mkdtemp(path.join(tmpdir(), 'timebound-e2e-newdir-'));

    const result = await launched.app.evaluate(
      async (_electron, { newDir }) => {
        const tb = (globalThis as unknown as { __tb: { data: { switchDir: (d: string) => Promise<{ dir?: string }> } } }).__tb;
        return tb.data.switchDir(newDir);
      },
      { newDir }
    );
    expect(result.dir).toBe(newDir);

    expect(existsSync(path.join(newDir, 'data.json'))).toBe(true);
    // Never deletes old files: the previous folder's data.json is untouched.
    expect(existsSync(path.join(oldDir, 'data.json'))).toBe(true);

    const settingsDataDir = await launched.app.evaluate(
      () => (globalThis as unknown as { __tb: { store: { get: () => { data: { settings: { dataDir?: string } } } } } }).__tb.store.get().data.settings.dataDir
    );
    expect(settingsDataDir).toBe(newDir);
  } finally {
    await launched.close();
  }
});

// Fix round 2 (must-fix review), items 2-4: the data-location pointer file, startup
// fallback when a redirected folder is unavailable, and adopt/refuse on chooseDir.

test('switch then relaunch with the same default folder opens the new folder', async () => {
  // TIMEBOUND_DATA_DIR overridden to '' (falsy) so main.ts takes its normal "default
  // userData folder" path (where the data-location pointer lives) instead of the
  // harness's usual forced dir. Both launches share one `dataDir`, so `launchApp()`'s
  // own default `TIMEBOUND_USERDATA_DIR` (`<dataDir>/userData` — see e2e/launch.ts)
  // resolves to the same isolated folder both times, without this spec needing to
  // compute or pass it itself.
  const sharedDir = await mkdtemp(path.join(tmpdir(), 'timebound-e2e-userdata-'));
  const newDir = await mkdtemp(path.join(tmpdir(), 'timebound-e2e-target-'));

  const first = await launchAppRetrying({ dataDir: sharedDir, env: { TIMEBOUND_DATA_DIR: '' } });
  try {
    await first.window('strip');
    await first.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: { store: { dispatch: (a: unknown) => number } } }).__tb;
      tb.store.dispatch({ type: 'task/add', id: 'relaunch-task', now: Date.now(), title: 'Task that should survive the switch' });
    });
    await first.app.evaluate(async () => {
      await (globalThis as unknown as { __tb: { store: { flush: () => Promise<void> } } }).__tb.store.flush();
    });

    const result = await first.app.evaluate(
      async (_electron, { newDir }) => {
        const tb = (globalThis as unknown as { __tb: { data: { switchDir: (d: string) => Promise<{ dir?: string; error?: string }> } } }).__tb;
        return tb.data.switchDir(newDir);
      },
      { newDir }
    );
    expect(result.error).toBeUndefined();
    expect(result.dir).toBe(newDir);
  } finally {
    await first.close();
  }

  const second = await launchAppRetrying({ dataDir: sharedDir, env: { TIMEBOUND_DATA_DIR: '' } });
  try {
    await second.window('strip');
    const tasks = await second.app.evaluate(
      () => (globalThis as unknown as { __tb: { store: { get: () => { data: { tasks: Array<{ id: string }> } } } } }).__tb.store.get().data.tasks
    );
    expect(tasks.some((t) => t.id === 'relaunch-task')).toBe(true);
  } finally {
    await second.close();
  }
});

test('a redirected folder that no longer exists falls back to the default folder, creates nothing there, and flags dataLocationUnavailable', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'timebound-e2e-userdata-missing-'));
  // launchApp() defaults TIMEBOUND_USERDATA_DIR to `<dataDir>/userData` (e2e/launch.ts)
  // — computed here up front so the pointer file below can be pre-seeded in the same
  // place before the app ever launches.
  const userDataDir = path.join(dataDir, 'userData');
  const missingParent = await mkdtemp(path.join(tmpdir(), 'timebound-e2e-missing-parent-'));
  const missingDir = path.join(missingParent, 'never-created');

  // Pre-seed the pointer file at the (isolated, known in advance) default folder,
  // pointing at a folder that doesn't exist (simulating an unmounted drive /
  // not-yet-synced folder / manually deleted one).
  await mkdir(userDataDir, { recursive: true });
  await writeFile(path.join(userDataDir, 'data-location.json'), JSON.stringify({ dataDir: missingDir }, null, 2), 'utf8');

  const launched = await launchAppRetrying({ dataDir, env: { TIMEBOUND_DATA_DIR: '' } });
  try {
    await launched.window('strip');

    // Nothing was created in the missing/unavailable folder.
    expect(existsSync(missingDir)).toBe(false);

    const unavailable = await launched.app.evaluate(
      () => (globalThis as unknown as { __tb: { store: { get: () => { dataLocationUnavailable?: string } } } }).__tb.store.get().dataLocationUnavailable
    );
    expect(unavailable).toBe(missingDir);

    // The app still works, on the default folder.
    expect(existsSync(path.join(userDataDir, 'data.json'))).toBe(true);
  } finally {
    await launched.close();
  }
});

test('choosing a folder that already has valid data adopts it, preserving the current data as data.previous-*.json', async () => {
  // Session 1: builds up a folder that "already has TimeBound data in it".
  const targetDir = await mkdtemp(path.join(tmpdir(), 'timebound-e2e-existing-target-'));
  const seed = await launchApp({ dataDir: targetDir });
  try {
    await seed.window('strip');
    await seed.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: { store: { dispatch: (a: unknown) => number } } }).__tb;
      tb.store.dispatch({ type: 'task/add', id: 'target-task', now: Date.now(), title: 'Task that already lived in the target folder' });
    });
    await seed.app.evaluate(async () => {
      await (globalThis as unknown as { __tb: { store: { flush: () => Promise<void> } } }).__tb.store.flush();
    });
  } finally {
    await seed.close();
  }
  expect(existsSync(path.join(targetDir, 'data.json'))).toBe(true);

  // Session 2: a separate, unrelated session with its OWN current data, now pointed
  // at that same folder.
  const launched = await launchApp();
  try {
    await launched.window('strip');
    await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: { store: { dispatch: (a: unknown) => number } } }).__tb;
      tb.store.dispatch({ type: 'task/add', id: 'current-session-task', now: Date.now(), title: 'Task from the current session' });
    });

    const result = await launched.app.evaluate(
      async (_electron, { targetDir }) => {
        const tb = (globalThis as unknown as { __tb: { data: { switchDir: (d: string) => Promise<{ dir?: string; error?: string }> } } }).__tb;
        return tb.data.switchDir(targetDir);
      },
      { targetDir }
    );
    expect(result.error).toBeUndefined();
    expect(result.dir).toBe(targetDir);

    // Adopted: the store now reflects the TARGET folder's data, not the current
    // session's task.
    const tasks = await launched.app.evaluate(
      () => (globalThis as unknown as { __tb: { store: { get: () => { data: { tasks: Array<{ id: string }> } } } } }).__tb.store.get().data.tasks
    );
    expect(tasks.some((t) => t.id === 'target-task')).toBe(true);
    expect(tasks.some((t) => t.id === 'current-session-task')).toBe(false);

    // Nothing lost: the current session's data was preserved in the target folder.
    const entries = await readdir(targetDir);
    const previousFiles = entries.filter((f) => f.startsWith('data.previous-'));
    expect(previousFiles.length).toBe(1);
    const preserved = JSON.parse(await readFile(path.join(targetDir, previousFiles[0]), 'utf8'));
    expect(preserved.tasks.some((t: { id: string }) => t.id === 'current-session-task')).toBe(true);
  } finally {
    await launched.close();
  }
});

test('choosing a folder with an unreadable data.json refuses the switch and leaves the current session untouched', async () => {
  const targetDir = await mkdtemp(path.join(tmpdir(), 'timebound-e2e-invalid-target-'));
  await writeFile(path.join(targetDir, 'data.json'), '{ this is not valid json', 'utf8');

  const launched = await launchApp();
  try {
    await launched.window('strip');
    await launched.app.evaluate(() => {
      const tb = (globalThis as unknown as { __tb: { store: { dispatch: (a: unknown) => number } } }).__tb;
      tb.store.dispatch({ type: 'task/add', id: 'kept-task', now: Date.now(), title: 'Should stay in the current session' });
    });

    const result = await launched.app.evaluate(
      async (_electron, { targetDir }) => {
        const tb = (globalThis as unknown as { __tb: { data: { switchDir: (d: string) => Promise<{ dir?: string; error?: string }> } } }).__tb;
        return tb.data.switchDir(targetDir);
      },
      { targetDir }
    );
    expect(result.dir).toBeUndefined();
    expect(result.error).toBe('That folder has a TimeBound data file that could not be read.');

    // Nothing was dispatched away: the current session's task is still there.
    const tasks = await launched.app.evaluate(
      () => (globalThis as unknown as { __tb: { store: { get: () => { data: { tasks: Array<{ id: string }> } } } } }).__tb.store.get().data.tasks
    );
    expect(tasks.some((t) => t.id === 'kept-task')).toBe(true);

    // The refused target folder's invalid file is untouched — no previous-*/backups.
    const entries = await readdir(targetDir);
    expect(entries).toEqual(['data.json']);
  } finally {
    await launched.close();
  }
});
