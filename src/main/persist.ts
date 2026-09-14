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

function errorCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code;
}

function isRetryableFsError(err: unknown): boolean {
  const code = errorCode(err);
  return !!code && RETRYABLE_CODES.has(code);
}

/**
 * Runs `op`, retrying on failure at 50/200/800ms (three retries, four attempts
 * total) as long as `isRetryable(err)` says so; each retry is logged via
 * `deps.log`. On final failure the error is rethrown to the caller. Shared by
 * every fs operation in this module that needs the same crash-tolerant retry
 * schedule (the save rename, the quarantine rename, and reading data.json).
 */
async function withRetry<T>(deps: PersistDeps, label: string, op: () => Promise<T>, isRetryable: (err: unknown) => boolean = isRetryableFsError): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await op();
    } catch (err) {
      if (attempt < RETRY_DELAYS_MS.length && isRetryable(err)) {
        const delay = RETRY_DELAYS_MS[attempt];
        deps.log?.(`persist: ${label} failed (${errorCode(err) ?? 'error'}), retrying in ${delay}ms (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length})`);
        await sleep(delay);
        attempt++;
        continue;
      }
      throw err;
    }
  }
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
 * Both the temp-file write and the rename are covered by one try/catch: any
 * failure (a failed write, e.g. ENOSPC, or a rename that's still failing after
 * retries) removes the temp file before rethrowing, so a failed save never
 * leaves a partial data.tmp-*.json behind.
 */
export async function save(deps: PersistDeps, data: Data): Promise<void> {
  const fs = fsOf(deps);
  await ensureDirs(deps);
  await rotateBackup(deps);

  const tmp = tempPath(deps);
  const dp = dataPath(deps);
  try {
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await withRetry(deps, 'save rename', () => fs.rename(tmp, dp));
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
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

/**
 * Reads `file` as text, retrying on any error other than ENOENT (a transient
 * EBUSY/EPERM/EMFILE on an otherwise-fine file must not be mistaken for
 * "missing"). Returns `undefined` for ENOENT ("no such file"); rethrows any
 * other error once retries are exhausted, so the caller can tell "could not
 * read" apart from "read but invalid".
 */
async function readFileRetrying(deps: PersistDeps, file: string): Promise<string | undefined> {
  const fs = fsOf(deps);
  try {
    return await withRetry(deps, `read ${path.basename(file)}`, () => fs.readFile(file, 'utf8'), (err) => errorCode(err) !== 'ENOENT');
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return undefined;
    throw err;
  }
}

type ReadOutcome = { kind: 'missing' } | { kind: 'invalid' } | { kind: 'valid'; data: Data };

/**
 * Reads and validates `file`. Distinguishes three outcomes: the file doesn't
 * exist ('missing'); it was read successfully but isn't valid JSON or doesn't
 * pass parseData ('invalid' — this, and only this, is "corrupt"); or it read
 * and parsed fine ('valid'). A persistent read error (see readFileRetrying)
 * propagates out of this function rather than resolving to any of the three.
 */
async function readAndValidate(deps: PersistDeps, file: string): Promise<ReadOutcome> {
  const raw = await readFileRetrying(deps, file);
  if (raw === undefined) return { kind: 'missing' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'invalid' };
  }
  try {
    return { kind: 'valid', data: parseData(parsed) };
  } catch {
    return { kind: 'invalid' };
  }
}

/** Swallows every read/parse/validate failure — used for the backup scan, where any candidate that isn't readable is simply skipped in favor of the next. */
async function readValidDataLoose(fs: FsModule, file: string): Promise<Data | undefined> {
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
 * Loads persisted data, in order: clean orphaned temp files; read+validate data.json.
 *  - Read succeeds and validates → source 'data'.
 *  - Read succeeds but the bytes are invalid JSON or fail parseData → quarantine it
 *    as data.corrupt-<ts>.json (retried the same way as the save rename; if the
 *    rename still fails, log it and leave the corrupt file in place rather than
 *    throwing — corruptSavedAs stays undefined), then try each backup newest→oldest,
 *    first valid one wins (source 'backup', rewriting data.json via save).
 *  - Read itself fails for anything other than "no such file" (e.g. a stuck EPERM
 *    even after retries) → propagate the error. This is a transient failure on a
 *    perfectly good file, not corruption: it must never be quarantined or silently
 *    reverted to a backup.
 *  - No data.json and no valid backup: import legacyPath if given and readable
 *    (source 'legacy', copying — never modifying — the original to legacy-state.json).
 *  - Otherwise start fresh (source 'empty').
 */
export async function load(deps: PersistDeps, appVersion: string, legacyPath?: string): Promise<LoadResult> {
  await cleanOrphans(deps);

  const fs = fsOf(deps);
  const dp = dataPath(deps);
  let corruptSavedAs: string | undefined;

  const outcome = await readAndValidate(deps, dp);

  if (outcome.kind === 'valid') {
    return { data: outcome.data, source: 'data' };
  }

  if (outcome.kind === 'invalid') {
    const cp = corruptPath(deps);
    try {
      await withRetry(deps, 'quarantine rename', () => fs.rename(dp, cp));
      corruptSavedAs = cp;
    } catch (err) {
      deps.log?.(`persist: quarantine rename failed permanently (${errorCode(err) ?? 'error'}), leaving corrupt data.json in place`);
    }
  }

  for (const backupPath of await listBackups(deps)) {
    const data = await readValidDataLoose(fs, backupPath);
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
