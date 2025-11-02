import type { AppState } from './types';

export interface ElectronApi {
  loadState(): Promise<AppState>;
  saveState(state: AppState): Promise<AppState>;
  quitApp(): Promise<void>;
}
