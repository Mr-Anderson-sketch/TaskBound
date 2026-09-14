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
    if (isUndoable(action)) {
      this.undoStack.push(prev, labelFor(action, prev));
    }
    const next = reduce(prev, action);
    if (next !== prev) {
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
   * next dispatch will). */
  replace(data: Data): void {
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

  /** Awaits any pending or in-flight debounced save. Called by main on `before-quit`. */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
      this.pendingSave = this.doSave();
    }
    if (this.pendingSave) {
      await this.pendingSave;
    }
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
      this.pendingSave = this.doSave();
    }, SAVE_DEBOUNCE_MS);
  }

  private async doSave(): Promise<void> {
    const data = this.data;
    try {
      await this.deps.save(data);
    } finally {
      this.pendingSave = undefined;
    }
  }
}
