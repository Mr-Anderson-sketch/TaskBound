import { contextBridge, ipcRenderer } from 'electron';
import type { AppState, WindowState } from '../shared/types';
import type { ElectronApi } from '../shared/ipc';

const api: ElectronApi = {
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

contextBridge.exposeInMainWorld('electronAPI', api);
