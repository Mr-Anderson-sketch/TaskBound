import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as realFs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  save,
  load,
  listBackups,
  cleanOrphans,
  watchDataFile,
  createWriteTracker,
  hasValidDataFile,
  prepareDirSwitch,
  resolveBackupPath
} from '../../src/main/persist';
import type { PersistDeps, WatchDataFileDeps } from '../../src/main/persist';
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

describe('watchDataFile', () => {
  // Real fs.watch + real timers: give the 500 ms debounce real time to settle, plus
  // slack for filesystem event latency.
  const SETTLE_MS = 900;
  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  it('calls onExternalChange with the parsed data when a genuinely external file appears and nothing is pending', async () => {
    const dir = await mkTmpDir();
    const now = localMs(2026, 5, 1);
    const inMemory = createEmptyData(now, APP_VERSION);
    const writeTracker = createWriteTracker();
    await save(makeDeps(dir, () => now, { writeTracker }), inMemory);

    const deps: WatchDataFileDeps = { ...makeDeps(dir, () => now, { writeTracker }), getCurrentData: () => inMemory, hasPendingSave: () => false };
    const onExternalChange = vi.fn();
    const watcher = watchDataFile(deps, onExternalChange);
    try {
      const later = now + 60_000;
      const external = createEmptyData(later, APP_VERSION);
      // Write directly (not via save()) to simulate another process/tool.
      await realFs.writeFile(path.join(dir, 'data.json'), JSON.stringify(external, null, 2), 'utf8');

      await sleep(SETTLE_MS);

      expect(onExternalChange).toHaveBeenCalledTimes(1);
      expect(onExternalChange.mock.calls[0][0]).toEqual(external);
    } finally {
      watcher.stop();
    }
  }, 10000);

  it('ignores its own write, identified by content hash rather than meta.lastSavedAt', async () => {
    const dir = await mkTmpDir();
    const now = localMs(2026, 5, 2);
    const inMemory = createEmptyData(now, APP_VERSION);
    const writeTracker = createWriteTracker();
    // hasPendingSave() true here would make a MISSED-echo bug show up as a conflict
    // file instead of silently doing the wrong thing — a stronger assertion than
    // hasPendingSave: () => false would give.
    const deps: WatchDataFileDeps = { ...makeDeps(dir, () => now, { writeTracker }), getCurrentData: () => inMemory, hasPendingSave: () => true };

    const onExternalChange = vi.fn();
    const watcher = watchDataFile(deps, onExternalChange);
    try {
      // Our own save(), using the SAME writeTracker the watcher reads.
      await save(deps, inMemory);
      await sleep(SETTLE_MS);

      expect(onExternalChange).not.toHaveBeenCalled();
      const entries = await realFs.readdir(dir);
      expect(entries.some((f) => f.startsWith('data.conflict-'))).toBe(false);
    } finally {
      watcher.stop();
    }
  }, 10000);

  it('a genuinely external change shortly after our own save is still recognised as external, not misread as an echo', async () => {
    // Regression: comparing meta.lastSavedAt (which changes on every save, our own
    // included) instead of a content hash used to make an edit landing shortly after
    // a save indistinguishable from that save's own echo.
    const dir = await mkTmpDir();
    const now = localMs(2026, 5, 2, 30);
    const inMemory = createEmptyData(now, APP_VERSION);
    const writeTracker = createWriteTracker();
    await save(makeDeps(dir, () => now, { writeTracker }), inMemory);

    const deps: WatchDataFileDeps = { ...makeDeps(dir, () => now + 1, { writeTracker }), getCurrentData: () => inMemory, hasPendingSave: () => false };
    const onExternalChange = vi.fn();
    const watcher = watchDataFile(deps, onExternalChange);
    try {
      const external = createEmptyData(now + 1, APP_VERSION); // different content, close in time
      await realFs.writeFile(path.join(dir, 'data.json'), JSON.stringify(external, null, 2), 'utf8');

      await sleep(SETTLE_MS);

      expect(onExternalChange).toHaveBeenCalledTimes(1);
      expect(onExternalChange.mock.calls[0][0]).toEqual(external);
    } finally {
      watcher.stop();
    }
  }, 10000);

  it('on conflict (hasPendingSave true, content not ours), preserves the external file as a conflict copy WITHOUT saving directly or calling onExternalChange', async () => {
    const dir = await mkTmpDir();
    const base = localMs(2026, 5, 3);
    const writeTracker = createWriteTracker();
    const ours = createEmptyData(base, APP_VERSION);
    await save(makeDeps(dir, () => base, { writeTracker }), ours);

    const deps: WatchDataFileDeps = {
      ...makeDeps(dir, () => base + 5000, { writeTracker }),
      getCurrentData: () => ours,
      hasPendingSave: () => true // local unsaved changes pending
    };

    const onExternalChange = vi.fn();
    const watcher = watchDataFile(deps, onExternalChange);
    try {
      const external = createEmptyData(base + 1000, APP_VERSION);
      await realFs.writeFile(path.join(dir, 'data.json'), JSON.stringify(external, null, 2), 'utf8');

      await sleep(SETTLE_MS);

      expect(onExternalChange).not.toHaveBeenCalled();

      const entries = await realFs.readdir(dir);
      const conflictFiles = entries.filter((f) => f.startsWith('data.conflict-'));
      expect(conflictFiles.length).toBe(1);
      const conflictContent = JSON.parse(await realFs.readFile(path.join(dir, conflictFiles[0]), 'utf8'));
      expect(conflictContent).toEqual(external);

      // The watcher never saves directly — data.json is left holding the external
      // content; only the Store's own (already scheduled/in-flight) save may
      // overwrite it, so a direct watcher save can never race it and land after.
      const onDisk = JSON.parse(await realFs.readFile(path.join(dir, 'data.json'), 'utf8'));
      expect(onDisk).toEqual(external);
    } finally {
      watcher.stop();
    }
  }, 10000);

  it('stops reacting after stop()', async () => {
    const dir = await mkTmpDir();
    const now = localMs(2026, 5, 4);
    const inMemory = createEmptyData(now, APP_VERSION);
    const writeTracker = createWriteTracker();
    await save(makeDeps(dir, () => now, { writeTracker }), inMemory);

    const deps: WatchDataFileDeps = { ...makeDeps(dir, () => now, { writeTracker }), getCurrentData: () => inMemory, hasPendingSave: () => false };
    const onExternalChange = vi.fn();
    const watcher = watchDataFile(deps, onExternalChange);
    watcher.stop();

    const later = now + 60_000;
    const external = createEmptyData(later, APP_VERSION);
    await realFs.writeFile(path.join(dir, 'data.json'), JSON.stringify(external, null, 2), 'utf8');

    await sleep(SETTLE_MS);

    expect(onExternalChange).not.toHaveBeenCalled();
  }, 10000);
});

describe('hasValidDataFile', () => {
  it('is true when data.json exists and is valid', async () => {
    const dir = await mkTmpDir();
    const deps = makeDeps(dir, () => localMs(2026, 6, 1));
    await save(deps, createEmptyData(deps.now(), APP_VERSION));

    expect(await hasValidDataFile(deps)).toBe(true);
  });

  it('is false when data.json is missing, and creates nothing', async () => {
    const dir = await mkTmpDir();
    const deps = makeDeps(dir, () => localMs(2026, 6, 1));

    expect(await hasValidDataFile(deps)).toBe(false);

    const entries = await realFs.readdir(dir).catch(() => [] as string[]);
    expect(entries).toEqual([]);
  });

  it('is false when data.json exists but is invalid, and does not quarantine it', async () => {
    const dir = await mkTmpDir();
    await realFs.mkdir(dir, { recursive: true });
    await realFs.writeFile(path.join(dir, 'data.json'), '{ not valid json', 'utf8');
    const deps = makeDeps(dir, () => localMs(2026, 6, 1));

    expect(await hasValidDataFile(deps)).toBe(false);

    const entries = await realFs.readdir(dir);
    expect(entries).toEqual(['data.json']); // untouched: no quarantine, no fallback
  });
});

describe('prepareDirSwitch', () => {
  it("'switched': target has no data.json — saves the current data there", async () => {
    const dir = await mkTmpDir();
    const deps = makeDeps(dir, () => localMs(2026, 6, 2));
    const current = createEmptyData(deps.now(), APP_VERSION);

    const outcome = await prepareDirSwitch(deps, current);

    expect(outcome).toEqual({ kind: 'switched' });
    const onDisk = JSON.parse(await realFs.readFile(path.join(dir, 'data.json'), 'utf8'));
    expect(onDisk).toEqual(current);
  });

  it("'adopted': target already has valid data.json — returns it, and preserves current data as data.previous-<ts>.json", async () => {
    const dir = await mkTmpDir();
    const targetData = createEmptyData(localMs(2026, 6, 1), APP_VERSION);
    const deps = makeDeps(dir, () => localMs(2026, 6, 3));
    await save(makeDeps(dir, () => localMs(2026, 6, 1)), targetData);

    const current = { ...createEmptyData(localMs(2026, 6, 2), APP_VERSION), tasks: [] };
    const outcome = await prepareDirSwitch(deps, current);

    expect(outcome).toEqual({ kind: 'adopted', data: targetData });

    const entries = await realFs.readdir(dir);
    const previousFiles = entries.filter((f) => f.startsWith('data.previous-'));
    expect(previousFiles.length).toBe(1);
    const preserved = JSON.parse(await realFs.readFile(path.join(dir, previousFiles[0]), 'utf8'));
    expect(preserved).toEqual(current);

    // Target's data.json itself is untouched by the adoption.
    const onDisk = JSON.parse(await realFs.readFile(path.join(dir, 'data.json'), 'utf8'));
    expect(onDisk).toEqual(targetData);
  });

  it("'refused': target has an invalid data.json — nothing is written, current data is not saved", async () => {
    const dir = await mkTmpDir();
    await realFs.mkdir(dir, { recursive: true });
    await realFs.writeFile(path.join(dir, 'data.json'), '{ not valid json', 'utf8');
    const deps = makeDeps(dir, () => localMs(2026, 6, 4));
    const current = createEmptyData(deps.now(), APP_VERSION);

    const outcome = await prepareDirSwitch(deps, current);

    expect(outcome).toEqual({ kind: 'refused', error: 'That folder has a TimeBound data file that could not be read.' });
    const entries = await realFs.readdir(dir);
    expect(entries).toEqual(['data.json']); // untouched — no previous-*, no backups dir created
  });
});

describe('resolveBackupPath', () => {
  async function seedBackup(dir: string, filename: string): Promise<string> {
    const backupsDirPath = path.join(dir, 'backups');
    await realFs.mkdir(backupsDirPath, { recursive: true });
    const p = path.join(backupsDirPath, filename);
    await realFs.writeFile(p, '{}', 'utf8');
    return p;
  }

  it('resolves a real backup file inside the backups folder', async () => {
    const dir = await mkTmpDir();
    const backupPath = await seedBackup(dir, 'data-2026-01-01.json');
    const deps = makeDeps(dir, () => localMs(2026, 1, 5));

    const resolved = await resolveBackupPath(deps, backupPath);

    expect(resolved).toBe(await realFs.realpath(backupPath));
  });

  it('rejects a path outside the backups folder', async () => {
    const dir = await mkTmpDir();
    await seedBackup(dir, 'data-2026-01-01.json');
    // data.json itself: exists, but is not inside backups/.
    await realFs.writeFile(path.join(dir, 'data.json'), '{}', 'utf8');
    const deps = makeDeps(dir, () => localMs(2026, 1, 5));

    expect(await resolveBackupPath(deps, path.join(dir, 'data.json'))).toBeUndefined();
  });

  it('rejects a traversal attempt out of the backups folder via ".."', async () => {
    const dir = await mkTmpDir();
    await seedBackup(dir, 'data-2026-01-01.json');
    await realFs.writeFile(path.join(dir, 'data.json'), '{}', 'utf8');
    const deps = makeDeps(dir, () => localMs(2026, 1, 5));

    const traversal = path.join(dir, 'backups', '..', 'data.json');
    expect(await resolveBackupPath(deps, traversal)).toBeUndefined();
  });

  it('rejects a file inside the backups folder whose name is not a backup filename', async () => {
    const dir = await mkTmpDir();
    const backupsDirPath = path.join(dir, 'backups');
    await realFs.mkdir(backupsDirPath, { recursive: true });
    const impostor = path.join(backupsDirPath, 'not-a-backup.json');
    await realFs.writeFile(impostor, '{}', 'utf8');
    const deps = makeDeps(dir, () => localMs(2026, 1, 5));

    expect(await resolveBackupPath(deps, impostor)).toBeUndefined();
  });

  it('rejects a path that does not exist', async () => {
    const dir = await mkTmpDir();
    const deps = makeDeps(dir, () => localMs(2026, 1, 5));

    expect(await resolveBackupPath(deps, path.join(dir, 'backups', 'data-2099-01-01.json'))).toBeUndefined();
  });
});
