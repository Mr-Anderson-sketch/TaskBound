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
