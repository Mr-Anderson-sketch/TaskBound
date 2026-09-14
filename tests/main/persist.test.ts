import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as realFs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { save, load, listBackups, cleanOrphans } from '../../src/main/persist';
import type { PersistDeps } from '../../src/main/persist';
import { createEmptyData } from '../../src/core/defaults';
import { ymd } from '../../src/core/dates';
import type { Data } from '../../src/core/types';

const APP_VERSION = '2.0.0';
const FIXTURE_PATH = path.join(__dirname, '..', 'fixtures', 'legacy-state.json');

// Local-noon epoch ms for a calendar date, avoiding DST-boundary ambiguity while
// still exercising ymd()'s local-date logic under both test time zones.
function localMs(y: number, m: number, d: number): number {
  return new Date(y, m - 1, d, 12, 0, 0).getTime();
}

let tmpDirs: string[] = [];

async function mkTmpDir(): Promise<string> {
  const dir = await realFs.mkdtemp(path.join(os.tmpdir(), 'tb-persist-'));
  tmpDirs.push(dir);
  return dir;
}

function makeDeps(dir: string, now: () => number, overrides: Partial<PersistDeps> = {}): PersistDeps {
  return { dir, now, ...overrides };
}

beforeEach(() => {
  tmpDirs = [];
});

afterEach(async () => {
  for (const dir of tmpDirs) {
    await realFs.rm(dir, { recursive: true, force: true });
  }
});

describe('save + load', () => {
  it('round-trips: load after save returns the same data with source "data"', async () => {
    const dir = await mkTmpDir();
    const deps = makeDeps(dir, () => localMs(2026, 1, 5));
    const data = createEmptyData(deps.now(), APP_VERSION);

    await save(deps, data);
    const result = await load(deps, APP_VERSION);

    expect(result.source).toBe('data');
    expect(result.data).toEqual(data);
  });
});

describe('corruption recovery', () => {
  it('quarantines a corrupt data.json and recovers from a valid backup', async () => {
    const dir = await mkTmpDir();
    const deps = makeDeps(dir, () => localMs(2026, 1, 5));

    // A valid backup from "yesterday".
    await realFs.mkdir(path.join(dir, 'backups'), { recursive: true });
    const goodData = createEmptyData(localMs(2026, 1, 4), APP_VERSION);
    const backupPath = path.join(dir, 'backups', 'data-2026-01-04.json');
    await realFs.writeFile(backupPath, JSON.stringify(goodData, null, 2), 'utf8');

    // A corrupt current data.json (invalid JSON).
    const corruptContent = '{ this is not valid json';
    await realFs.writeFile(path.join(dir, 'data.json'), corruptContent, 'utf8');

    const result = await load(deps, APP_VERSION);

    expect(result.source).toBe('backup');
    expect(result.recoveredFrom).toBe(backupPath);
    expect(result.corruptSavedAs).toBeDefined();
    expect(result.data).toEqual(goodData);

    // The corrupt file was renamed, not deleted, with its original bytes intact.
    const corruptFiles = (await realFs.readdir(dir)).filter((f) => f.startsWith('data.corrupt-'));
    expect(corruptFiles.length).toBe(1);
    const preservedContent = await realFs.readFile(path.join(dir, corruptFiles[0]), 'utf8');
    expect(preservedContent).toBe(corruptContent);
    expect(result.corruptSavedAs).toBe(path.join(dir, corruptFiles[0]));

    // data.json was rewritten with the recovered, valid data.
    const rewritten = JSON.parse(await realFs.readFile(path.join(dir, 'data.json'), 'utf8'));
    expect(rewritten).toEqual(goodData);
  });

  it('falls through to empty data when data.json and all backups are corrupt', async () => {
    const dir = await mkTmpDir();
    const deps = makeDeps(dir, () => localMs(2026, 1, 5));

    await realFs.mkdir(path.join(dir, 'backups'), { recursive: true });
    await realFs.writeFile(path.join(dir, 'backups', 'data-2026-01-04.json'), 'not json either', 'utf8');
    await realFs.writeFile(path.join(dir, 'backups', 'data-2026-01-03.json'), JSON.stringify({ schemaVersion: 2 }), 'utf8');
    await realFs.writeFile(path.join(dir, 'data.json'), '{ broken', 'utf8');

    const result = await load(deps, APP_VERSION);

    expect(result.source).toBe('empty');
    expect(result.corruptSavedAs).toBeDefined();
    expect(result.data.tasks).toEqual([]);
    expect(result.data.meta.appVersion).toBe(APP_VERSION);
  });
});

describe('read-error handling', () => {
  it('retries a transient EBUSY reading data.json and succeeds without quarantining', async () => {
    const dir = await mkTmpDir();
    const now = localMs(2026, 1, 6);
    const data = createEmptyData(now, APP_VERSION);
    const dataJsonPath = path.join(dir, 'data.json');
    await realFs.writeFile(dataJsonPath, JSON.stringify(data, null, 2), 'utf8');

    let callCount = 0;
    const readFileSpy = vi.fn(async (file: Parameters<typeof realFs.readFile>[0], enc: Parameters<typeof realFs.readFile>[1]) => {
      callCount++;
      if (callCount <= 2) {
        throw Object.assign(new Error('fake EBUSY'), { code: 'EBUSY' });
      }
      return realFs.readFile(file, enc);
    });

    const logs: string[] = [];
    const deps: PersistDeps = {
      dir,
      now: () => now,
      fs: { ...realFs, readFile: readFileSpy } as typeof realFs,
      log: (m) => logs.push(m)
    };

    const result = await load(deps, APP_VERSION);

    expect(result.source).toBe('data');
    expect(result.data).toEqual(data);
    expect(logs.length).toBe(2);

    const entries = await realFs.readdir(dir);
    expect(entries.some((f) => f.startsWith('data.corrupt-'))).toBe(false);
  }, 10000);

  it('propagates a persistent non-ENOENT read error instead of quarantining or falling back', async () => {
    const dir = await mkTmpDir();
    const now = localMs(2026, 1, 6);
    const data = createEmptyData(now, APP_VERSION);
    const dataJsonPath = path.join(dir, 'data.json');
    await realFs.writeFile(dataJsonPath, JSON.stringify(data, null, 2), 'utf8');
    const originalBytes = await realFs.readFile(dataJsonPath);

    const readFileSpy = vi.fn(async () => {
      throw Object.assign(new Error('fake EPERM'), { code: 'EPERM' });
    });

    const deps: PersistDeps = {
      dir,
      now: () => now,
      fs: { ...realFs, readFile: readFileSpy } as typeof realFs
    };

    await expect(load(deps, APP_VERSION)).rejects.toMatchObject({ code: 'EPERM' });

    const afterBytes = await realFs.readFile(dataJsonPath);
    expect(afterBytes.equals(originalBytes)).toBe(true);
    const entries = await realFs.readdir(dir);
    expect(entries.some((f) => f.startsWith('data.corrupt-'))).toBe(false);
  }, 10000);

  it('leaves the corrupt file in place when the quarantine rename cannot succeed, still recovering from backup', async () => {
    const dir = await mkTmpDir();
    const today = localMs(2026, 1, 7);

    await realFs.mkdir(path.join(dir, 'backups'), { recursive: true });
    const backupData = createEmptyData(today, APP_VERSION);
    const backupPath = path.join(dir, 'backups', `data-${ymd(today)}.json`);
    await realFs.writeFile(backupPath, JSON.stringify(backupData, null, 2), 'utf8');

    const corruptContent = '{ this is not valid json';
    const dataJsonPath = path.join(dir, 'data.json');
    await realFs.writeFile(dataJsonPath, corruptContent, 'utf8');

    const renameSpy = vi.fn(async (from: Parameters<typeof realFs.rename>[0], to: Parameters<typeof realFs.rename>[1]) => {
      if (typeof to === 'string' && path.basename(to).startsWith('data.corrupt-')) {
        throw Object.assign(new Error('fake EPERM'), { code: 'EPERM' });
      }
      return realFs.rename(from, to);
    });

    const deps: PersistDeps = { dir, now: () => today, fs: { ...realFs, rename: renameSpy } as typeof realFs };

    const result = await load(deps, APP_VERSION);

    expect(result.source).toBe('backup');
    expect(result.corruptSavedAs).toBeUndefined();
    expect(result.data).toEqual(backupData);

    // No data.corrupt-*.json exists: the quarantine rename never succeeded, so
    // the original corrupt bytes just stayed at data.json until save() overwrote them.
    const entries = await realFs.readdir(dir);
    expect(entries.some((f) => f.startsWith('data.corrupt-'))).toBe(false);

    // data.json now holds the recovered, valid data.
    const finalOnDisk = JSON.parse(await realFs.readFile(dataJsonPath, 'utf8'));
    expect(finalOnDisk).toEqual(backupData);
  }, 10000);
});

describe('save write failures', () => {
  it('cleans up the temp file when writeFile fails (e.g. ENOSPC)', async () => {
    const dir = await mkTmpDir();
    const now = localMs(2026, 1, 8);
    const data = createEmptyData(now, APP_VERSION);

    const writeFileSpy = vi.fn(async () => {
      throw Object.assign(new Error('fake ENOSPC'), { code: 'ENOSPC' });
    });

    const deps: PersistDeps = {
      dir,
      now: () => now,
      fs: { ...realFs, writeFile: writeFileSpy } as typeof realFs
    };

    await expect(save(deps, data)).rejects.toMatchObject({ code: 'ENOSPC' });

    const entries = await realFs.readdir(dir).catch(() => [] as string[]);
    expect(entries.some((f) => f.startsWith('data.tmp-'))).toBe(false);
  });
});

describe('rename retries', () => {
  it('retries EPERM twice then succeeds via the real rename, logging each retry', async () => {
    const dir = await mkTmpDir();
    const deps = makeDeps(dir, () => localMs(2026, 1, 5));
    const data = createEmptyData(deps.now(), APP_VERSION);

    let callCount = 0;
    const renameSpy = vi.fn(async (from: Parameters<typeof realFs.rename>[0], to: Parameters<typeof realFs.rename>[1]) => {
      callCount++;
      if (callCount <= 2) {
        const err = Object.assign(new Error('fake EPERM'), { code: 'EPERM' });
        throw err;
      }
      return realFs.rename(from, to);
    });

    const logs: string[] = [];
    const deps2: PersistDeps = {
      ...deps,
      fs: { ...realFs, rename: renameSpy } as typeof realFs,
      log: (m) => logs.push(m)
    };

    await save(deps2, data);

    expect(renameSpy).toHaveBeenCalledTimes(3);
    expect(logs.length).toBe(2);
    const onDisk = JSON.parse(await realFs.readFile(path.join(dir, 'data.json'), 'utf8'));
    expect(onDisk).toEqual(data);
  }, 10000);
});

describe('daily backup rotation', () => {
  it('two saves on the same local day produce exactly one backup file', async () => {
    const dir = await mkTmpDir();
    const day = localMs(2026, 2, 10);
    const deps = makeDeps(dir, () => day);

    await save(deps, createEmptyData(day, APP_VERSION));
    await save(deps, { ...createEmptyData(day, APP_VERSION), tasks: [] });

    const backups = await listBackups(deps);
    expect(backups.length).toBe(1);
    expect(backups[0]).toBe(path.join(dir, 'backups', 'data-2026-02-10.json'));
  });

  it('prunes to the 30 newest backups after pre-seeding 31 distinct days', async () => {
    const dir = await mkTmpDir();
    const backupsDir = path.join(dir, 'backups');
    await realFs.mkdir(backupsDir, { recursive: true });

    // 31 distinct days in March 2026 (all before "today" below).
    for (let d = 1; d <= 31; d++) {
      const key = `2026-03-${String(d).padStart(2, '0')}`;
      const seedData = createEmptyData(localMs(2026, 3, d), APP_VERSION);
      await realFs.writeFile(path.join(backupsDir, `data-${key}.json`), JSON.stringify(seedData), 'utf8');
    }

    // A pre-existing data.json so the save below has something to back up.
    const prior = createEmptyData(localMs(2026, 3, 31), APP_VERSION);
    await realFs.writeFile(path.join(dir, 'data.json'), JSON.stringify(prior, null, 2), 'utf8');

    const today = localMs(2026, 4, 1);
    const deps = makeDeps(dir, () => today);
    await save(deps, createEmptyData(today, APP_VERSION));

    const backups = await listBackups(deps);
    expect(backups.length).toBe(30);
    // The oldest pre-seeded backup (March 1st) was pruned away.
    expect(backups.some((b) => b.endsWith('data-2026-03-01.json'))).toBe(false);
    // The newest (today's) backup survives, sorted first.
    expect(backups[0]).toBe(path.join(backupsDir, 'data-2026-04-01.json'));
  });
});

describe('legacy import', () => {
  it('imports state.json when there is no data.json, leaving the original untouched', async () => {
    const dir = await mkTmpDir();
    const legacyPath = path.join(dir, 'state.json');
    const fixtureBytes = await realFs.readFile(FIXTURE_PATH);
    await realFs.writeFile(legacyPath, fixtureBytes);
    const statBefore = await realFs.stat(legacyPath);

    const deps = makeDeps(dir, () => localMs(2026, 1, 5));
    const result = await load(deps, APP_VERSION, legacyPath);

    expect(result.source).toBe('legacy');
    expect(result.data.tasks.length).toBe(27);
    expect(result.legacyDropped).toBe(0);

    // legacy-state.json is a copy, original file is byte- and mtime-identical.
    const copiedBytes = await realFs.readFile(path.join(dir, 'legacy-state.json'));
    expect(copiedBytes.equals(fixtureBytes)).toBe(true);
    const originalBytesAfter = await realFs.readFile(legacyPath);
    expect(originalBytesAfter.equals(fixtureBytes)).toBe(true);
    const statAfter = await realFs.stat(legacyPath);
    expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);

    // data.json was written with the migrated data.
    const onDisk = JSON.parse(await realFs.readFile(path.join(dir, 'data.json'), 'utf8')) as Data;
    expect(onDisk.tasks.length).toBe(27);
  });

  it('starts empty when there is no data.json, no backups, and no legacy path', async () => {
    const dir = await mkTmpDir();
    const deps = makeDeps(dir, () => localMs(2026, 1, 5));

    const result = await load(deps, APP_VERSION);

    expect(result.source).toBe('empty');
    expect(result.data.tasks).toEqual([]);
  });
});

describe('cleanOrphans', () => {
  it('removes a stale temp file and keeps a fresh one', async () => {
    const dir = await mkTmpDir();
    const now = localMs(2026, 1, 5);
    const deps = makeDeps(dir, () => now);

    const stale = path.join(dir, 'data.tmp-1234-1000.json');
    const fresh = path.join(dir, 'data.tmp-5678-2000.json');
    await realFs.writeFile(stale, '{}', 'utf8');
    await realFs.writeFile(fresh, '{}', 'utf8');

    const oldTime = new Date(now - 120_000);
    await realFs.utimes(stale, oldTime, oldTime);
    const freshTime = new Date(now - 5_000);
    await realFs.utimes(fresh, freshTime, freshTime);

    await cleanOrphans(deps);

    const remaining = await realFs.readdir(dir);
    expect(remaining).not.toContain('data.tmp-1234-1000.json');
    expect(remaining).toContain('data.tmp-5678-2000.json');
  });

  it('tolerates a missing directory', async () => {
    const dir = path.join(os.tmpdir(), 'tb-persist-does-not-exist-' + Date.now());
    const deps = makeDeps(dir, () => localMs(2026, 1, 5));
    await expect(cleanOrphans(deps)).resolves.toBeUndefined();
  });
});
