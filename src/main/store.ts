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
}

function normalizePlatform(platform: NodeJS.Platform): 'win32' | 'darwin' | 'linux' {
  if (platform === 'win32' || platform === 'darwin') return platform;
  return 'linux';
}

export class Store {
  private data: Data;
  private rev = 0;
  private undoStack = new UndoStack();
  private lastUndoLabel: string | undefined;
  private readonly subscribers = new Set<(s: Snapshot) => void>();
  private readonly capabilities: { appBar: boolean; fullscreenDetect: boolean };
  private readonly platform: 'win32' | 'darwin' | 'linux';
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
  }

  get(): Snapshot {
    return {
      rev: this.rev,
      data: this.data,
      today: todayView(this.data, this.deps.now()),
      canUndo: this.undoStack.canUndo,
      canRedo: this.undoStack.canRedo,
      lastUndoLabel: this.lastUndoLabel,
      platform: this.platform,
      systemDark: this.deps.systemDark(),
      capabilities: this.capabilities
    };
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
      if (label !== undefined) {
        this.undoStack.push(prev, label);
      }
      this.data = { ...next, meta: { ...next.meta, lastSavedAt: this.deps.now() } };
      this.rev++;
      this.scheduleSave();
      this.notify();
    }
    return this.rev;
  }

  undo(): string | undefined {
    const result = this.undoStack.undo(this.data);
    if (!result) return undefined;
    this.data = result.data;
    this.lastUndoLabel = result.label;
    this.rev++;
    this.scheduleSave();
    this.notify();
    return result.label;
  }

  redo(): string | undefined {
    const result = this.undoStack.redo(this.data);
    if (!result) return undefined;
    this.data = result.data;
    this.lastUndoLabel = result.label;
    this.rev++;
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
    this.lastUndoLabel = undefined;
    this.rev++;
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
    await this.deps.save(this.data);
  }
}
