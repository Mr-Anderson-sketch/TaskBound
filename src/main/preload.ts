import { contextBridge, ipcRenderer } from 'electron';
import type { AppState } from '../shared/types';
import type { ElectronApi } from '../shared/ipc';

const api: ElectronApi = {
  loadState: (): Promise<AppState> => ipcRenderer.invoke('state:load'),
  saveState: (state: AppState): Promise<AppState> => ipcRenderer.invoke('state:save', state),
  quitApp: (): Promise<void> => ipcRenderer.invoke('app:quit')
};

contextBridge.exposeInMainWorld('electronAPI', api);
