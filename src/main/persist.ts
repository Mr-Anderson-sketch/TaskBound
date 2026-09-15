// main/persist — atomic persistence for the main-process store: temp→rename writes,
// daily backup rotation (rolling 30), corruption recovery, and legacy state.json import.
// No Electron import: main.ts supplies `dir` (derived via paths.ts) and `now`.
import * as fsReal from 'node:fs/promises';
import { watch as fsWatch } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Data } from '../core/types';
import { parseData } from '../core/schema';
import { migrateLegacy } from '../core/migrate';
import { createEmptyData } from '../core/defaults';
import { ymd } from '../core/dates';

/** Mutable, shared between every `save()` call for a session and `watchDataFile` (Task
 * 5.3 fix round 2, item 1): records a hash of the exact bytes `save()` last wrote, so
 * the watcher can tell its OWN writes apart from genuine external ones without relying
 * on `meta.lastSavedAt` (which changes on every in-memory edit, saved or not, and so
 * can't distinguish "just saved" from "has unsaved changes"). One tracker instance is
 * reused across a data-folder switch — the initial save into the new folder and the
 * watcher that starts watching it right after share the same object. */
export interface WriteTracker {
  lastWrittenHash?: string;
}

export function createWriteTracker(): WriteTracker {
  return {};
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export interface PersistDeps {
  dir: string;
  now: () => number;
  fs?: typeof import('node:fs/promises');
  log?: (m: string) => void;
  writeTracker?: WriteTracker;
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

  const text = JSON.stringify(data, null, 2);
  const tmp = tempPath(deps);
  const dp = dataPath(deps);
  try {
    await fs.writeFile(tmp, text, 'utf8');

    // Fix round 3, item 1: the Store's own debounce (250 ms) is shorter than the
    // watcher's (500 ms), so a save can land BEFORE the watcher ever notices an
    // external write that happened in between — and once this overwrites
    // data.json with our own content, the watcher's later check sees our own
    // (matching) hash and never learns anything external happened at all. Guard
    // against this HERE, immediately before the rename that would clobber it:
    // if the file currently on disk isn't what we last wrote (its hash doesn't
    // match the tracker), preserve it as a conflict copy first. Skipped when the
    // tracker has no recorded hash yet — this session's very first save has no
    // baseline to compare against (a freshly loaded data.json is the starting
    // point, not a foreign change), and the watcher's own hasPendingSave()-gated
    // check already covers that narrow window from the moment it starts at boot.
    if (deps.writeTracker?.lastWrittenHash !== undefined) {
      try {
        const onDisk = await readFileRetrying(deps, dp);
        if (onDisk !== undefined && hashText(onDisk) !== deps.writeTracker.lastWrittenHash) {
          const conflictPath = path.join(deps.dir, `data.conflict-${deps.now()}.json`);
          await fs.writeFile(conflictPath, onDisk, 'utf8').catch(() => {});
        }
      } catch (err) {
        // A read failure here must never block the save itself — best-effort only.
        deps.log?.(`persist: pre-save conflict check failed (${errorCode(err) ?? 'error'})`);
      }
    }

    await withRetry(deps, 'save rename', () => fs.rename(tmp, dp));
    // Only recorded once the rename actually lands data.json — a failed save must
    // not make the watcher think this (unwritten) content is now "ours".
    if (deps.writeTracker) deps.writeTracker.lastWrittenHash = hashText(text);
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

/** Whether `dir`'s data.json currently exists AND is valid — a pure read-only check
 * (Task 5.3 fix round 2, item 3): no quarantine, no backup fallback, no fresh-data
 * creation, unlike `load()`. Used at startup to decide whether a redirected data
 * folder (the data-location pointer, or previously `settings.dataDir`) is safe to
 * adopt — a missing, unmounted, or not-yet-synced folder must never get files
 * created in it just because the app looked at it. */
export async function hasValidDataFile(deps: PersistDeps): Promise<boolean> {
  const outcome = await readAndValidate(deps, dataPath(deps));
  return outcome.kind === 'valid';
}

// --- data folder switch (Task 5.3 fix round 2, item 4) ----------------------------

export type PrepareDirSwitchOutcome =
  | { kind: 'adopted'; data: Data }
  | { kind: 'switched' }
  | { kind: 'refused'; error: string };

/**
 * Decides what `data:chooseDir` should do about `deps.dir` (the NEW target folder),
 * given the CURRENT in-memory `currentData`. Never touches the old folder.
 *  - Target already has a VALID data.json: 'adopted' — the caller should
 *    `store.replace(outcome.data)`. `currentData` would otherwise be silently
 *    discarded, so it's preserved first, written to `data.previous-<ts>.json` INSIDE
 *    the target folder.
 *  - Target's data.json exists but fails to parse/validate: 'refused' — nothing is
 *    written anywhere; the caller must leave persistence and the watcher untouched.
 *  - Target has no data.json: 'switched' — `currentData` is saved there (unchanged
 *    behavior from before this fix: first time this folder is used).
 */
export async function prepareDirSwitch(deps: PersistDeps, currentData: Data): Promise<PrepareDirSwitchOutcome> {
  const outcome = await readAndValidate(deps, dataPath(deps));

  if (outcome.kind === 'invalid') {
    return { kind: 'refused', error: 'That folder has a TimeBound data file that could not be read.' };
  }

  if (outcome.kind === 'valid') {
    const fs = fsOf(deps);
    await ensureDirs(deps);
    const previousPath = path.join(deps.dir, `data.previous-${deps.now()}.json`);
    await fs.writeFile(previousPath, JSON.stringify(currentData, null, 2), 'utf8');
    return { kind: 'adopted', data: outcome.data };
  }

  await save(deps, currentData);
  return { kind: 'switched' };
}

// --- backup restore path safety (Task 5.3 fix round 2, item 6) --------------------

const BACKUP_FILENAME_RE = /^data-\d{4}-\d{2}-\d{2}\.json$/;

/**
 * Resolves `requestedPath` to a real, absolute path strictly INSIDE `dir`'s backups
 * folder, or `undefined` if it isn't one. Follows symlinks/junctions on BOTH sides via
 * `fs.realpath` before comparing, so a link inside the backups folder that points
 * outside it can't be used to escape it (a plain string-prefix/`path.relative` check
 * on the un-resolved paths cannot catch this). Also requires the filename to match a
 * real backup's `data-YYYY-MM-DD.json` shape, so nothing else that happens to live in
 * the backups folder can be "restored". Returns `undefined` (never throws) for a
 * path that doesn't exist, isn't inside the real backups folder, or has the wrong
 * filename shape.
 */
export async function resolveBackupPath(deps: PersistDeps, requestedPath: string): Promise<string | undefined> {
  const fs = fsOf(deps);
  try {
    const realBackupsRoot = await fs.realpath(backupsDir(deps));
    const realTarget = await fs.realpath(requestedPath);
    if (!BACKUP_FILENAME_RE.test(path.basename(realTarget))) return undefined;
    if (path.dirname(realTarget) !== realBackupsRoot) return undefined;
    return realTarget;
  } catch {
    return undefined;
  }
}

// --- watcher (Task 5.3) -----------------------------------------------------------

const WATCH_DEBOUNCE_MS = 500;

export interface WatchDataFileDeps extends PersistDeps {
  /** Reads the CURRENT in-memory Data, fresh on every check — never cached across
   * events (the store may have dispatched more actions between watch callbacks). */
  getCurrentData: () => Data;
  /** Whether the Store has local changes not yet durably saved (Task 5.3 fix round 2,
   * item 1) — a debounced save scheduled, or one still in flight. Decides conflict
   * vs. plain adoption for a change that isn't our own write. */
  hasPendingSave: () => boolean;
  /** Shared with every `save()` call for this dir (see `WriteTracker`'s own doc) —
   * required here, unlike on plain `PersistDeps`, since the watcher cannot safely
   * tell its own writes apart from external ones without it. */
  writeTracker: WriteTracker;
}

export interface DataWatcher {
  stop: () => void;
}

/**
 * Watches `dir/data.json` for changes made OUTSIDE this process (another TimeBound
 * instance, a synced-folder tool, manual editing) and reconciles them against the
 * live in-memory `Data`, debounced 500 ms:
 *  - The file's bytes hash-match `writeTracker.lastWrittenHash` (the last thing WE
 *    wrote via `save()`, in this dir or a just-switched-to one): an echo of our own
 *    write — ignored outright, regardless of timing.
 *  - Otherwise, genuinely different content landed on disk. If `hasPendingSave()` is
 *    false (no unsaved local edits), this is an unambiguous external update —
 *    `onExternalChange` is called with the parsed `Data` so the caller can
 *    `store.replace(newData)`; its hash is then recorded as "known" too, so a
 *    duplicate fs event for the same write doesn't fire `onExternalChange` again.
 *  - If `hasPendingSave()` is true, the in-memory data has unsaved changes that a
 *    blind replace would silently discard — a conflict. The external file is
 *    preserved at `data.conflict-<ts>.json`; `data.json` itself is left alone here
 *    (never a direct `save()` from the watcher — the store's own already-scheduled
 *    or in-flight save will write the correct in-memory data on its own, and a
 *    watcher-issued save could otherwise race it and land AFTER it, clobbering newer
 *    data with older).
 * An unreadable/invalid file (e.g. a transient partial write by whatever external
 * tool is writing) is silently ignored — the next change event retries.
 *
 * Watches the DIRECTORY rather than the file path itself: `save()`'s own
 * temp-file-then-rename (and most "atomic" external writers, e.g. a synced-folder
 * client) replaces the file's inode, which stops a file-level `fs.watch` dead on some
 * platforms. Directory-level events are filtered down to the data file by name (a
 * `null` filename — some platforms never report one — is treated as "check anyway").
 * Stop with `.stop()` on quit and when switching data folders.
 */
export function watchDataFile(deps: WatchDataFileDeps, onExternalChange: (data: Data) => void): DataWatcher {
  const fs = fsOf(deps);
  const dp = dataPath(deps);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let handling = false;
  let pending = false;

  async function handleChange(): Promise<void> {
    if (handling) {
      pending = true;
      return;
    }
    handling = true;
    try {
      const text = await readFileRetrying(deps, dp);
      if (text === undefined) return; // missing: ignore, next event retries

      const hash = hashText(text);
      if (deps.writeTracker.lastWrittenHash === hash) return; // our own write, echoed back

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return; // invalid: ignore, next event retries
      }
      let incoming: Data;
      try {
        incoming = parseData(parsed);
      } catch {
        return; // invalid: ignore, next event retries
      }

      if (deps.hasPendingSave()) {
        // Conflict: local has unsaved changes. Preserve the external file; the
        // store's OWN pending/in-flight save writes the correct data.json on its
        // own — never save() directly here (see doc comment above).
        const conflictPath = path.join(deps.dir, `data.conflict-${deps.now()}.json`);
        await fs.copyFile(dp, conflictPath).catch(() => {});
        return;
      }

      // No local unsaved changes: unambiguously a genuine external update.
      deps.writeTracker.lastWrittenHash = hash;
      onExternalChange(incoming);
    } catch (err) {
      deps.log?.(`persist: watcher reconciliation failed (${errorCode(err) ?? 'error'})`);
    } finally {
      handling = false;
      if (!stopped && pending) {
        pending = false;
        void handleChange();
      }
    }
  }

  function scheduleCheck(): void {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void handleChange();
    }, WATCH_DEBOUNCE_MS);
  }

  const watcher = fsWatch(deps.dir, (_eventType, filename) => {
    if (stopped) return;
    if (filename === null || filename === DATA_FILE) scheduleCheck();
  });
  watcher.on('error', (err) => {
    deps.log?.(`persist: data dir watcher error (${errorCode(err) ?? 'error'})`);
  });

  return {
    stop: () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      watcher.close();
    }
  };
}
