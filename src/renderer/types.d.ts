import type { ElectronApi } from '../shared/ipc-legacy';

declare global {
  interface Window {
    electronAPI?: ElectronApi;
  }
}

export {};
