// main/store — the ONE source of truth for `Data`, living in the main process (see
// CLAUDE.md: "the store never ticks"). Renderers are views: they dispatch actions over
// IPC (src/main/ipc.ts) and receive `Snapshot`s back, synchronously on every change and
// on demand via `get()`. Saves are debounced; `flush()` is called on `before-quit`.
import type { Action, Data } from '../core/types';
import { reduce } from '../core/reducer';
import { todayView } from '../core/select';
import { UndoStack, isUndoable, labelFor } from '../core/undo';
import type { Snapshot } from '../shared/ipc';

const SAVE_DEBOUNCE_MS = 250;

export interface StoreDeps {
  save: (d: Data) => Promise<void>;
  now: () => number;
  appVersion: string;
  platform: NodeJS.Platform;
  systemDark: () => boolean;
  capabilities?: { appBar: boolean; fullscreenDetect: boolean };
  /** Task 5.3 fix round 2: set once at boot when a redirected data folder (from the
   * data-location pointer file) was missing or invalid and the app fell back to the
   * default folder instead — the absolute path of the folder that couldn't be used,
   * so the (future) settings UI can surface it. undefined in the normal case. */
  dataLocationUnavailable?: string;
}

function normalizePlatform(platform: NodeJS.Platform): 'win32' | 'darwin' | 'linux' {
  if (platform === 'win32' || platform === 'darwin') return platform;
  return 'linux';
}

export class Store {
  private data: Data;
  private rev = 0;
  // The highest rev fully persisted to disk (Task 5.3 fix round 2, item 1): lets
  // `hasPendingSave()` tell the data-file watcher whether there are unsaved local
  // changes it must not silently clobber. Starts equal to `rev` (0): the initial
  // `Data` handed to the constructor is assumed to already match what's on disk.
  private savedRev = 0;
  private undoStack = new UndoStack();
  private lastUndo: { label: string; rev: number } | undefined;
  private lastUndone: { label: string; rev: number; kind: 'undo' | 'redo' } | undefined;
  private readonly subscribers = new Set<(s: Snapshot) => void>();
  private readonly capabilities: { appBar: boolean; fullscreenDetect: boolean };
  private readonly platform: 'win32' | 'darwin' | 'linux';
  private readonly dataLocationUnavailable?: string;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingSave: Promise<void> | undefined;
  // Tail of the serialised save chain: each debounced save runs only after the
  // previous one settles, so `deps.save` is never called concurrently with itself.
  // A prior save's rejection is swallowed here (but still surfaced through
  // `pendingSave`/`flush()` for that call) so later saves keep running.
  private saveChain: Promise<void> = Promise.resolve();

  constructor(
    initial: Data,
    private readonly deps: StoreDeps
  ) {
    this.data = initial;
    this.capabilities = deps.capabilities ?? { appBar: false, fullscreenDetect: false };
    this.platform = normalizePlatform(deps.platform);
    this.dataLocationUnavailable = deps.dataLocationUnavailable;
  }

  get(): Snapshot {
    return {
      rev: this.rev,
      data: this.data,
      today: todayView(this.data, this.deps.now()),
      canUndo: this.undoStack.canUndo,
      canRedo: this.undoStack.canRedo,
      lastUndo: this.lastUndo,
      lastUndone: this.lastUndone,
      platform: this.platform,
      systemDark: this.deps.systemDark(),
      capabilities: this.capabilities,
      dataLocationUnavailable: this.dataLocationUnavailable
    };
  }

  /** Whether there are local changes not yet durably saved: a debounced save is
   * scheduled, or a save is in flight for a rev this hasn't caught up to. Used by
   * the data-file watcher (persist.ts) to decide whether an external change to
   * data.json is safe to adopt outright or must be treated as a conflict. */
  hasPendingSave(): boolean {
    return this.savedRev !== this.rev;
  }

  /** Validated by ipc.ts before this is called. Returns the (possibly unchanged) rev. */
  dispatch(action: Action): number {
    const prev = this.data;
    // Compute the undo label (if any) and reduce BEFORE touching the undo stack: an
    // undoable action type whose reducer is a no-op (e.g. `task/edit` on a missing id,
    // unimplemented until Task 4.3) must not push a dead entry that clears redo and
    // flips `canUndo` with no corresponding data change / notify.
    const label = isUndoable(action) ? labelFor(action, prev) : undefined;
    const next = reduce(prev, action);
    if (next !== prev) {
      // Final-review fix 4: undo is a replay — an undoable action opens an entry;
      // every other data-changing action is recorded against the newest entry so
      // undoing it replays them rather than silently rolling them back.
      if (label !== undefined) {
        this.undoStack.push(prev, action, label);
      } else {
        this.undoStack.recordNonUndoable(action);
        // Past the replay limit the history is cleared — drop the stale undo row too.
        if (!this.undoStack.canUndo) this.lastUndo = undefined;
      }
      this.data = { ...next, meta: { ...next.meta, lastSavedAt: this.deps.now() } };
      this.rev++;
      // C2 (fix round 1): set on every dispatch that pushes an undo entry — NOT on
      // undo()/redo() (see below) — so the panel's undo row can appear right after a
      // normal action, not only after the user has already undone something.
      if (label !== undefined) {
        this.lastUndo = { label, rev: this.rev };
      }
      // A data-changing dispatch clears `lastUndone` (addendum ruling 1): the
      // planner's confirmation toast must not reappear because of an unrelated
      // later action that happens to land on the same rev-tracking logic.
      this.lastUndone = undefined;
      this.scheduleSave();
      this.notify();
    }
    return this.rev;
  }

  undo(): string | undefined {
    const result = this.undoStack.undo();
    if (!result) return undefined;
    this.data = result.data;
    this.lastUndo = undefined;
    this.rev++;
    this.lastUndone = { label: result.label, rev: this.rev, kind: 'undo' };
    this.scheduleSave();
    this.notify();
    return result.label;
  }

  redo(): string | undefined {
    const result = this.undoStack.redo(this.data);
    if (!result) return undefined;
    this.data = result.data;
    this.lastUndo = undefined;
    this.rev++;
    this.lastUndone = { label: result.label, rev: this.rev, kind: 'redo' };
    this.scheduleSave();
    this.notify();
    return result.label;
  }

  /** From the file watcher or an import: replaces the data wholesale, resets undo,
   * bumps rev, notifies — does NOT save (the caller already wrote the file, or the
   * next dispatch will). Cancels any pending debounced save timer: a stale save
   * scheduled before the replace must not fire afterwards and overwrite the
   * replaced data with the pre-replace `Data`. */
  replace(data: Data): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    this.data = data;
    this.undoStack = new UndoStack();
    this.lastUndo = undefined;
    this.lastUndone = undefined;
    this.rev++;
    // The replacing data is, by construction, already what's on disk (the watcher's
    // external-change path) or about to be explicitly persisted via `saveNow()`
    // right after (backup restore) — either way there is nothing new for a
    // debounced save to catch up on the moment `replace()` itself returns.
    this.savedRev = this.rev;
    this.notify();
  }

  subscribe(cb: (s: Snapshot) => void): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  /** Awaits the full save chain: any not-yet-fired debounced save is run immediately,
   * and — since saves are serialised (see `saveChain`) — this also waits out any save
   * still in flight from an earlier debounce cycle. Called by main on `before-quit`;
   * must not resolve until every enqueued write has actually completed, or the app
   * could exit mid-write. */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
      this.enqueueSave();
    }
    await this.pendingSave;
  }

  /** Fix round 3, item 2: enqueues an IMMEDIATE save of the current in-memory data
   * through the exact same serialised chain every debounced save uses (never a
   * direct, out-of-band `save()` call), and returns a promise that resolves once
   * THAT save has completed. Cancels any pending debounce timer first, so its
   * (now redundant) save doesn't also fire later. Unlike `flush()` — which only
   * acts if a save is already scheduled — this ALWAYS enqueues a fresh save, even
   * with nothing pending (e.g. right after `replace()`, which marks the data as
   * already "caught up" with no debounce of its own to flush).
   *
   * Used by callers that must durably persist a change right now without risking
   * an EARLIER, already-in-flight save landing afterwards and overwriting it with
   * stale data (e.g. a backup restore: `store.replace(data)` then `saveNow()` —
   * never a direct `save()` call, which could complete before, and then be
   * clobbered by, a save already in flight from an edit made just before the
   * restore). Because every save (debounced or explicit) shares the one chain,
   * this one is always guaranteed to run, and land, last. */
  async saveNow(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    this.enqueueSave();
    await this.pendingSave;
  }

  private notify(): void {
    const snapshot = this.get();
    for (const cb of this.subscribers) {
      cb(snapshot);
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.enqueueSave();
    }, SAVE_DEBOUNCE_MS);
  }

  /** Chains a save of the CURRENT `this.data` (read at call time, i.e. when its turn in
   * the chain actually runs) onto `saveChain`, so it starts only once every earlier
   * enqueued save has settled — `deps.save` is thus never invoked concurrently with
   * itself. `pendingSave` always points at the chain's current tail, which is what
   * `flush()` awaits. */
  private enqueueSave(): void {
    const run = this.saveChain.catch(() => {}).then(() => this.doSave());
    this.saveChain = run;
    this.pendingSave = run;
  }

  private async doSave(): Promise<void> {
    // Captured synchronously, before the await: `this.data`/`this.rev` may advance
    // further while this save is in flight, so `savedRev` must record exactly the
    // rev this particular call is persisting, not whatever is current once it
    // resolves.
    const revBeingSaved = this.rev;
    const dataBeingSaved = this.data;
    await this.deps.save(dataBeingSaved);
    this.savedRev = revBeingSaved;
  }
}
