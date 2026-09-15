// main/preload — runs in the sandboxed, context-isolated preload context (CLAUDE.md:
// "sandbox: true, contextIsolation: true"). Exposes exactly `window.tb`, implementing
// `Bridge` (src/shared/ipc.ts), gated by a channel allowlist so a compromised renderer
// cannot invoke or listen on an arbitrary IPC channel.
import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { Bridge, EventMap, InvokeMap } from '../shared/ipc';

const ALLOWED_INVOKE = new Set<keyof InvokeMap>([
  'store:get',
  'store:dispatch',
  'store:undo',
  'store:redo',
  'strip:expand',
  'strip:reportSize',
  'strip:setEdge',
  'strip:dragStart',
  'strip:dragEnd',
  'strip:hover',
  'palette:show',
  'palette:hide',
  'palette:reportSize',
  'planner:show',
  'planner:hide',
  'planner:minimize',
  'app:openExternal',
  'app:quit',
  'data:export',
  'data:import',
  'data:chooseDir',
  'data:listBackups',
  'data:restoreBackup',
  'hotkeys:test',
  'timer:toggle'
]);

const ALLOWED_EVENTS = new Set<keyof EventMap>(['store:changed', 'palette:mode', 'strip:state', 'timer:break']);

const tb: Bridge = {
  invoke(channel, ...args) {
    if (!ALLOWED_INVOKE.has(channel)) {
      return Promise.reject(new Error(`tb.invoke: channel not allowed: ${String(channel)}`));
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
