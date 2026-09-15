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
  lastUndoLabel?: string;
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
  'planner:show': () => void;
  'planner:hide': () => void;
  'app:openExternal': (url: string) => void;
  'app:quit': () => void;
  'data:export': (format: 'json' | 'md') => { path?: string };
  'data:import': () => { imported?: number; error?: string };
  'data:chooseDir': () => { dir?: string };
  'hotkeys:test': (accelerator: string) => { ok: boolean; reason?: string };
};

export type EventMap = {
  'store:changed': Snapshot;
  'palette:mode': PaletteMode;
  'strip:state': { expanded: boolean; hidden: boolean };
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
