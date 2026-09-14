// shared/ipc-legacy — TEMPORARY. Verbatim copy of the pre-Task-1.6 `ElectronApi`
// contract, kept only so the old renderer (src/renderer/App.tsx and friends) still
// type-checks and runs against `window.electronAPI` until it is deleted in the next
// task. Do not add to this file; do not use it from new code — new code uses
// `window.tb` (see ./ipc.ts). Removed in Task 1.8+1.9.
import type { AppState, WindowState } from './types';

export interface ElectronApi {
  loadState(): Promise<AppState>;
  saveState(state: AppState): Promise<AppState>;
  quitApp(): Promise<void>;
  setAlwaysOnTop(enabled: boolean): Promise<void>;
  minimizeWindow?(): Promise<void>;
  toggleMaximizeWindow?(): Promise<void>;
  closeWindow?(): Promise<void>;
  getWindowState?(): Promise<WindowState>;
  onWindowStateChange?(callback: (state: WindowState) => void): () => void;
  onTimerTick?(callback: (timestamp: number) => void): () => void;
  setWindowSize?(width: number, height: number): Promise<void>;
  moveWindowToTopRight?(): Promise<void>;
}
