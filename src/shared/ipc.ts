// shared/ipc — the ONE typed IPC contract between main and renderers. Preload exposes
// exactly `window.tb` implementing `Bridge`; nothing else crosses the sandbox boundary.
// See docs/PLAN.md and CLAUDE.md: every payload is zod-validated in main (src/main/ipc.ts).
import type { Action, Data, Edge } from '../core/types';
import type { TodayView } from '../core/select';

export interface Snapshot {
  rev: number;
  data: Data;
  today: TodayView;
  canUndo: boolean;
  canRedo: boolean;
  /** Set by `Store.dispatch` whenever it pushes a new undo entry (`{ label, rev }`
   * where `rev` is the resulting `Snapshot.rev`); cleared by `undo()`/`redo()`. The
   * panel's "Completed X · Undo" row keys off `rev` changing, not `label`, so it
   * re-triggers even when two consecutive actions happen to produce the same label. */
  lastUndo?: { label: string; rev: number };
  /** Set by `Store.undo()`/`redo()` whenever one of them actually undoes/redoes an
   * entry (`rev` is the resulting `Snapshot.rev`); cleared by a data-changing
   * `dispatch()` and by `replace()`. Drives the planner's confirmation toast
   * ("Undid: …" / "Redid: …") regardless of which window (or the global hotkey)
   * triggered the undo/redo — unlike `lastUndo` above, which is per-dispatch and
   * used by the strip panel's own "just changed" row. */
  lastUndone?: { label: string; rev: number; kind: 'undo' | 'redo' };
  platform: 'win32' | 'darwin' | 'linux';
  systemDark: boolean;
  capabilities: { appBar: boolean; fullscreenDetect: boolean };
}

export type PaletteMode = 'capture' | 'plan' | 'close' | 'commands' | 'onboarding';

export type InvokeMap = {
  'store:get': () => Snapshot;
  'store:dispatch': (action: Action) => { rev: number };
  'store:undo': () => { rev: number; label?: string };
  'store:redo': () => { rev: number; label?: string };
  'strip:expand': (open: boolean) => void;
  'strip:reportSize': (size: { width: number; height: number }) => void;
  'strip:setEdge': (edge: Edge) => void;
  'strip:dragStart': () => void;
  'strip:dragEnd': () => void;
  'strip:hover': (inside: boolean) => void;
  'palette:show': (mode: PaletteMode) => void;
  'palette:hide': () => void;
  'palette:reportSize': (size: { height: number }) => void;
  'planner:show': () => void;
  'planner:hide': () => void;
  'app:openExternal': (url: string) => void;
  'app:quit': () => void;
  'data:export': (format: 'json' | 'md') => { path?: string };
  'data:import': () => { imported?: number; error?: string };
  'data:chooseDir': () => { dir?: string };
  'hotkeys:test': (accelerator: string) => { ok: boolean; reason?: string };
  /** Starts or pauses the current task's timer (main resolves "current"; applies the
   * pomodoro pre-step from task-3.2-addendum ruling 3 when applicable). Same effect
   * as the `toggleTimer` hotkey — used by the panel's timer button and the tray's
   * Start/Pause timer item. */
  'timer:toggle': () => void;
};

export type EventMap = {
  'store:changed': Snapshot;
  'palette:mode': PaletteMode;
  'strip:state': { expanded: boolean; hidden: boolean };
  /** Broadcast by main's Clock while a pomodoro break is active (`{ endsAt }`) and
   * when it ends or is cancelled (`null`) — see task-3.2-addendum ruling 7. */
  'timer:break': { endsAt: number } | null;
};

export interface Bridge {
  invoke<K extends keyof InvokeMap>(channel: K, ...args: Parameters<InvokeMap[K]>): Promise<ReturnType<InvokeMap[K]>>;
  on<K extends keyof EventMap>(channel: K, cb: (payload: EventMap[K]) => void): () => void;
}

declare global {
  interface Window {
    tb: Bridge;
  }
}
