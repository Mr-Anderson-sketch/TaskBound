// main/preload — runs in the sandboxed, context-isolated preload context (CLAUDE.md:
// "sandbox: true, contextIsolation: true"). Exposes exactly `window.tb`, implementing
// `Bridge` (src/shared/ipc.ts), gated by a channel allowlist so a compromised renderer
// cannot invoke or listen on an arbitrary IPC channel.
import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { Bridge, EventMap, InvokeMap } from '../shared/ipc';
// LEGACY: removed in Task 1.8+1.9 — see the `electronAPI` block at the bottom of this file.
import type { AppState, WindowState } from '../shared/types';
import type { ElectronApi } from '../shared/ipc-legacy';

const ALLOWED_INVOKE = new Set<keyof InvokeMap>([
  'store:get',
  'store:dispatch',
  'store:undo',
  'store:redo',
  'strip:expand',
  'strip:reportSize',
  'strip:setEdge',
  'strip:dragStart',
  'strip:hover',
  'palette:show',
  'palette:hide',
  'planner:show',
  'planner:hide',
  'app:openExternal',
  'app:quit',
  'data:export',
  'data:import',
  'data:chooseDir',
  'hotkeys:test'
]);

const ALLOWED_EVENTS = new Set<keyof EventMap>(['store:changed', 'palette:mode', 'strip:state']);

const tb: Bridge = {
  invoke(channel, ...args) {
    if (!ALLOWED_INVOKE.has(channel)) {
      throw new Error(`tb.invoke: channel not allowed: ${String(channel)}`);
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  on(channel, cb) {
    if (!ALLOWED_EVENTS.has(channel)) {
      throw new Error(`tb.on: channel not allowed: ${String(channel)}`);
    }
    const listener = (_event: IpcRendererEvent, payload: unknown) => {
      cb(payload as never);
    };
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  }
};

contextBridge.exposeInMainWorld('tb', tb);

// LEGACY: removed in Task 1.8+1.9. The old renderer (src/renderer/App.tsx and
// src/renderer/store/state.ts) still reads `window.electronAPI` against the old,
// pre-Task-1.6 channel names (see src/main/main.ts's registerIpc / src/shared/ipc-legacy.ts).
// Kept only so `npm run e2e:smoke` keeps launching the current app unmodified.
const legacyApi: ElectronApi = {
  loadState: (): Promise<AppState> => ipcRenderer.invoke('state:load'),
  saveState: (state: AppState): Promise<AppState> => ipcRenderer.invoke('state:save', state),
  quitApp: (): Promise<void> => ipcRenderer.invoke('app:quit'),
  setAlwaysOnTop: (enabled: boolean): Promise<void> => ipcRenderer.invoke('window:setAlwaysOnTop', enabled),
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: (): Promise<void> => ipcRenderer.invoke('window:toggleMaximize'),
  closeWindow: (): Promise<void> => ipcRenderer.invoke('window:close'),
  getWindowState: (): Promise<WindowState> => ipcRenderer.invoke('window:getState'),
  onWindowStateChange: (callback: (state: WindowState) => void) => {
    const handler = (_event: unknown, state: WindowState) => {
      callback(state);
    };
    ipcRenderer.on('window:state', handler);
    return () => {
      ipcRenderer.removeListener('window:state', handler);
    };
  },
  onTimerTick: (callback: (timestamp: number) => void) => {
    const handler = (_event: unknown, timestamp: number) => {
      callback(timestamp);
    };
    ipcRenderer.on('timer:tick', handler);
    return () => {
      ipcRenderer.removeListener('timer:tick', handler);
    };
  },
  setWindowSize: (width: number, height: number): Promise<void> => ipcRenderer.invoke('window:setSize', width, height),
  moveWindowToTopRight: (): Promise<void> => ipcRenderer.invoke('window:moveToTopRight')
};

contextBridge.exposeInMainWorld('electronAPI', legacyApi);
