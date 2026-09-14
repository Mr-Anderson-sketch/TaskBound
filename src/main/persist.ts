// main/persist — atomic persistence for the main-process store: temp→rename writes,
// daily backup rotation (rolling 30), corruption recovery, and legacy state.json import.
// No Electron import: main.ts supplies `dir` (derived via paths.ts) and `now`.
import * as fsReal from 'node:fs/promises';
import path from 'node:path';
import type { Data } from '../core/types';
import { parseData } from '../core/schema';
import { migrateLegacy } from '../core/migrate';
import { createEmptyData } from '../core/defaults';
import { ymd } from '../core/dates';

export interface PersistDeps {
  dir: string;
  now: () => number;
  fs?: typeof import('node:fs/promises');
  log?: (m: string) => void;
}

export interface LoadResult {
  data: Data;
  source: 'data' | 'backup' | 'legacy' | 'empty';
  recoveredFrom?: string;
  corruptSavedAs?: string;
  legacyDropped?: number;
}

const DATA_FILE = 'data.json';
const BACKUPS_DIR = 'backups';
const MAX_BACKUPS = 30;
const RETRY_DELAYS_MS = [50, 200, 800];
const RETRYABLE_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const ORPHAN_MAX_AGE_MS = 60_000;

type FsModule = typeof import('node:fs/promises');

function fsOf(deps: PersistDeps): FsModule {
  return deps.fs ?? fsReal;
}

function dataPath(deps: PersistDeps): string {
  return path.join(deps.dir, DATA_FILE);
}

function backupsDir(deps: PersistDeps): string {
  return path.join(deps.dir, BACKUPS_DIR);
}

function backupPathFor(deps: PersistDeps, dateKey: string): string {
  return path.join(backupsDir(deps), `data-${dateKey}.json`);
}

function tempPath(deps: PersistDeps): string {
  return path.join(deps.dir, `data.tmp-${process.pid}-${deps.now()}.json`);
}

function corruptPath(deps: PersistDeps): string {
  return path.join(deps.dir, `data.corrupt-${deps.now()}.json`);
}

function legacyStatePath(deps: PersistDeps): string {
  return path.join(deps.dir, 'legacy-state.json');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pathExists(fs: FsModule, p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureDirs(deps: PersistDeps): Promise<void> {
  const fs = fsOf(deps);
  await fs.mkdir(deps.dir, { recursive: true });
  await fs.mkdir(backupsDir(deps), { recursive: true });
}

async function pruneBackups(deps: PersistDeps): Promise<void> {
  const fs = fsOf(deps);
  const dir = backupsDir(deps);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return;
  }
  const backups = entries.filter((f) => f.startsWith('data-') && f.endsWith('.json')).sort();
  if (backups.length > MAX_BACKUPS) {
    const toDelete = backups.slice(0, backups.length - MAX_BACKUPS);
    for (const f of toDelete) {
      await fs.rm(path.join(dir, f), { force: true });
    }
  }
}

/**
 * Copies the current on-disk data.json into today's backup slot, once per local day,
 * then prunes to the 30 newest backups regardless (keeps the invariant even if
 * backups accumulated some other way, e.g. a restored/pre-seeded backups dir).
 */
async function rotateBackup(deps: PersistDeps): Promise<void> {
  const fs = fsOf(deps);
  const dp = dataPath(deps);
  if (await pathExists(fs, dp)) {
    const todayBackup = backupPathFor(deps, ymd(deps.now()));
    if (!(await pathExists(fs, todayBackup))) {
      await fs.copyFile(dp, todayBackup);
    }
  }
  await pruneBackups(deps);
}

/**
 * Writes `data` atomically: temp file → rename over data.json. Rotates the daily
 * backup first (using whatever is currently on disk, before it's overwritten).
 * Renames retry on EPERM/EBUSY/EACCES at 50/200/800ms (three retries, four attempts
 * total); on final failure the temp file is removed and the error is rethrown.
 */
export async function save(deps: PersistDeps, data: Data): Promise<void> {
  const fs = fsOf(deps);
  await ensureDirs(deps);
  await rotateBackup(deps);

  const tmp = tempPath(deps);
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');

  const dp = dataPath(deps);
  let attempt = 0;
  for (;;) {
    try {
      await fs.rename(tmp, dp);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code && RETRYABLE_CODES.has(code) && attempt < RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[attempt];
        deps.log?.(`persist: rename failed (${code}), retrying in ${delay}ms (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length})`);
        await sleep(delay);
        attempt++;
        continue;
      }
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
  }
}

/** Absolute paths of backups/data-*.json, sorted newest first (by filename). */
export async function listBackups(deps: PersistDeps): Promise<string[]> {
  const fs = fsOf(deps);
  const dir = backupsDir(deps);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.startsWith('data-') && f.endsWith('.json'))
    .sort()
    .reverse()
    .map((f) => path.join(dir, f));
}

/** Removes data.tmp-*.json files older than 60s — leftovers from a crash mid-save. */
export async function cleanOrphans(deps: PersistDeps): Promise<void> {
  const fs = fsOf(deps);
  let entries: string[];
  try {
    entries = await fs.readdir(deps.dir);
  } catch {
    return;
  }
  const now = deps.now();
  for (const f of entries) {
    if (!f.startsWith('data.tmp-') || !f.endsWith('.json')) continue;
    const p = path.join(deps.dir, f);
    try {
      const st = await fs.stat(p);
      if (now - st.mtimeMs > ORPHAN_MAX_AGE_MS) {
        await fs.rm(p, { force: true });
      }
    } catch {
      // lost the race with another process/save; ignore
    }
  }
}

async function readValidData(fs: FsModule, file: string): Promise<Data | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  try {
    return parseData(parsed);
  } catch {
    return undefined;
  }
}

/**
 * Loads persisted data, in order: clean orphaned temp files; read+validate data.json
 * (source 'data'); if data.json exists but is invalid, quarantine it as
 * data.corrupt-<ts>.json and try each backup newest→oldest (source 'backup',
 * rewriting data.json with the recovered copy); if there's still nothing usable,
 * import legacyPath if given and readable (source 'legacy', copying the original file
 * to legacy-state.json, never touching it); otherwise start fresh (source 'empty').
 */
export async function load(deps: PersistDeps, appVersion: string, legacyPath?: string): Promise<LoadResult> {
  await cleanOrphans(deps);

  const fs = fsOf(deps);
  const dp = dataPath(deps);
  let corruptSavedAs: string | undefined;

  if (await pathExists(fs, dp)) {
    const data = await readValidData(fs, dp);
    if (data) {
      return { data, source: 'data' };
    }
    const cp = corruptPath(deps);
    await fs.rename(dp, cp);
    corruptSavedAs = cp;
  }

  for (const backupPath of await listBackups(deps)) {
    const data = await readValidData(fs, backupPath);
    if (data) {
      await save(deps, data);
      return { data, source: 'backup', recoveredFrom: backupPath, ...(corruptSavedAs ? { corruptSavedAs } : {}) };
    }
  }

  if (legacyPath) {
    let legacyRaw: string | undefined;
    try {
      legacyRaw = await fs.readFile(legacyPath, 'utf8');
    } catch {
      legacyRaw = undefined;
    }
    if (legacyRaw !== undefined) {
      let legacyParsed: unknown;
      let legacyJsonOk = true;
      try {
        legacyParsed = JSON.parse(legacyRaw);
      } catch {
        legacyJsonOk = false;
      }
      if (legacyJsonOk) {
        const { data, dropped } = migrateLegacy(legacyParsed, deps.now(), appVersion);
        await save(deps, data);
        await fs.copyFile(legacyPath, legacyStatePath(deps));
        return { data, source: 'legacy', legacyDropped: dropped, ...(corruptSavedAs ? { corruptSavedAs } : {}) };
      }
    }
  }

  const data = createEmptyData(deps.now(), appVersion);
  await save(deps, data);
  return { data, source: 'empty', ...(corruptSavedAs ? { corruptSavedAs } : {}) };
}
