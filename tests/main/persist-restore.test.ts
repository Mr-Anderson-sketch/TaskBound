// Final-review fixes 1 and 2 (persistence side):
//  1. Restoring a backup first keeps a copy of the CURRENT data.json in backups/ as
//     `data.pre-restore-<YYYYMMDD-HHmmss>.json` (atomic, bypassing the once-per-day
//     rule), listed and restorable like any other backup; if that copy fails, the
//     restore is aborted and the error surfaces through the restore result.
//  2. `load()` never quarantines a file whose ONLY problem is holding more than
//     MAX_TASKS tasks.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as realFs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { save, load, listBackups, resolveBackupPath, snapshotBeforeRestore, restoreBackup } from '../../src/main/persist';
import type { PersistDeps, RestoreTarget } from '../../src/main/persist';
import { createEmptyData } from '../../src/core/defaults';
import { reduce } from '../../src/core/reducer';
import { MAX_TASKS } from '../../src/core/schema';
import type { Data, Task } from '../../src/core/types';

const APP_VERSION = '2.0.0';

let tmpDirs: string[] = [];

async function mkTmpDir(): Promise<string> {
  const dir = await realFs.mkdtemp(path.join(os.tmpdir(), 'tb-restore-'));
  tmpDirs.push(dir);
  return dir;
}

beforeEach(() => {
  tmpDirs = [];
});

afterEach(async () => {
  for (const dir of tmpDirs) await realFs.rm(dir, { recursive: true, force: true });
});

// 2026-09-14 10:11:12 local.
const NOW = new Date(2026, 8, 14, 10, 11, 12).getTime();

function deps(dir: string, overrides: Partial<PersistDeps> = {}): PersistDeps {
  return { dir, now: () => NOW, ...overrides };
}

function withTitle(title: string): Data {
  return reduce(createEmptyData(NOW, APP_VERSION), { type: 'task/add', id: 'a', now: NOW, title });
}

describe('snapshotBeforeRestore', () => {
  it('copies the current data.json into backups/ as data.pre-restore-<YYYYMMDD-HHmmss>.json, even when today already has a daily backup', async () => {
    const dir = await mkTmpDir();
    const d = deps(dir);
    await save(d, withTitle('first'));
    await save(d, withTitle('current')); // today's daily backup now exists (holding "first")
    const onDisk = await realFs.readFile(path.join(dir, 'data.json'), 'utf8');

    const snapshot = await snapshotBeforeRestore(d);

    expect(snapshot).toBe(path.join(dir, 'backups', 'data.pre-restore-20260914-101112.json'));
    expect(await realFs.readFile(snapshot, 'utf8')).toBe(onDisk);
    // Atomic: no temp file left behind in backups/.
    expect((await realFs.readdir(path.join(dir, 'backups'))).sort()).toEqual(['data-2026-09-14.json', 'data.pre-restore-20260914-101112.json']);
  });

  it('is listed (newest first) and accepted by resolveBackupPath', async () => {
    const dir = await mkTmpDir();
    const d = deps(dir);
    await save(d, withTitle('one'));
    await save(d, withTitle('two'));
    const snapshot = await snapshotBeforeRestore(d);

    const backups = await listBackups(d);
    expect(backups[0]).toBe(snapshot);
    expect(backups).toContain(path.join(dir, 'backups', 'data-2026-09-14.json'));
    expect(await resolveBackupPath(d, snapshot)).toBe(await realFs.realpath(snapshot));
  });

  it('never overwrites an earlier snapshot taken in the same second', async () => {
    const dir = await mkTmpDir();
    const d = deps(dir);
    await save(d, withTitle('one'));
    const first = await snapshotBeforeRestore(d);
    const second = await snapshotBeforeRestore(d);
    expect(second).not.toBe(first);
    expect(await resolveBackupPath(d, second)).toBeDefined();
  });

  it('rejects when the copy cannot be written, leaving no temp file', async () => {
    const dir = await mkTmpDir();
    await save(deps(dir), withTitle('one'));
    const failingFs = { ...realFs, rename: vi.fn(async () => Promise.reject(Object.assign(new Error('disk full'), { code: 'ENOSPC' }))) };
    const d = deps(dir, { fs: failingFs as unknown as typeof realFs });

    await expect(snapshotBeforeRestore(d)).rejects.toThrow('disk full');
    const entries = await realFs.readdir(path.join(dir, 'backups'));
    expect(entries.filter((f) => f.includes('pre-restore') || f.includes('tmp'))).toEqual([]);
  });
});

describe('restoreBackup', () => {
  function fakeTarget(): RestoreTarget & { calls: string[]; replaced?: Data } {
    const t: RestoreTarget & { calls: string[]; replaced?: Data } = {
      calls: [],
      flush: async () => {
        t.calls.push('flush');
      },
      replace: (data) => {
        t.calls.push('replace');
        t.replaced = data;
      },
      saveNow: async () => {
        t.calls.push('saveNow');
      }
    };
    return t;
  }

  it('flushes, snapshots the current data, then replaces and saves', async () => {
    const dir = await mkTmpDir();
    const d = deps(dir);
    await save(d, withTitle('backup day'));
    const backupPath = path.join(dir, 'backups', 'data-2026-09-13.json');
    await realFs.copyFile(path.join(dir, 'data.json'), backupPath);
    await save(d, withTitle('current'));

    const target = fakeTarget();
    const result = await restoreBackup(d, backupPath, target);

    expect(result).toEqual({ ok: true });
    expect(target.calls).toEqual(['flush', 'replace', 'saveNow']);
    expect(target.replaced?.tasks[0].title).toBe('backup day');
    const snapshot = (await listBackups(d)).find((p) => path.basename(p).startsWith('data.pre-restore-'));
    expect(snapshot).toBeDefined();
    expect(JSON.parse(await realFs.readFile(snapshot!, 'utf8')).tasks[0].title).toBe('current');
  });

  it('aborts without replacing anything when the pre-restore copy fails', async () => {
    const dir = await mkTmpDir();
    await save(deps(dir), withTitle('backup day'));
    const backupPath = path.join(dir, 'backups', 'data-2026-09-13.json');
    await realFs.copyFile(path.join(dir, 'data.json'), backupPath);
    const failingFs = { ...realFs, rename: vi.fn(async () => Promise.reject(Object.assign(new Error('disk full'), { code: 'ENOSPC' }))) };
    const d = deps(dir, { fs: failingFs as unknown as typeof realFs });

    const target = fakeTarget();
    const result = await restoreBackup(d, backupPath, target);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/disk full/);
    expect(target.calls).toEqual(['flush']);
  });

  it('rejects a path outside the backups folder without flushing or snapshotting', async () => {
    const dir = await mkTmpDir();
    const d = deps(dir);
    await save(d, withTitle('x'));
    const target = fakeTarget();
    const result = await restoreBackup(d, path.join(dir, 'data.json'), target);
    expect(result).toEqual({ ok: false, error: 'Backup path is outside the backups folder.' });
    expect(target.calls).toEqual([]);
  });

  it('can restore a pre-restore snapshot itself', async () => {
    const dir = await mkTmpDir();
    const d = deps(dir);
    await save(d, withTitle('before'));
    const snapshot = await snapshotBeforeRestore(d);
    const target = fakeTarget();
    expect(await restoreBackup(d, snapshot, target)).toEqual({ ok: true });
    expect(target.replaced?.tasks[0].title).toBe('before');
  });
});

describe('load: over-cap task count', () => {
  it('loads a data.json with more than MAX_TASKS tasks as-is instead of quarantining it', async () => {
    const dir = await mkTmpDir();
    const base = createEmptyData(NOW, APP_VERSION);
    const tasks: Task[] = Array.from({ length: MAX_TASKS + 1 }, (_, i) => ({
      id: `t${i}`,
      title: 'T',
      listId: 'inbox',
      tags: [],
      order: i,
      today: false,
      status: 'open',
      createdAt: NOW,
      updatedAt: NOW
    }));
    await realFs.writeFile(path.join(dir, 'data.json'), JSON.stringify({ ...base, tasks }), 'utf8');

    const result = await load(deps(dir), APP_VERSION);

    expect(result.source).toBe('data');
    expect(result.corruptSavedAs).toBeUndefined();
    expect(result.data.tasks.length).toBe(MAX_TASKS + 1);
    expect((await realFs.readdir(dir)).some((f) => f.startsWith('data.corrupt-'))).toBe(false);
    // Further adds are simply blocked.
    expect(reduce(result.data, { type: 'task/add', id: 'more', now: NOW, title: 'More' })).toBe(result.data);
  }, 60_000);
});
