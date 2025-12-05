import path from 'node:path';
import fs from 'fs-extra';
import { app } from 'electron';
import { AppState } from '../shared/types';
import { createEmptyState, rehydrateState } from '../shared/stateHelpers';

const APP_DIR_NAME = 'TimeBound';

const resolveStatePaths = () => {
  const baseDir = path.join(app.getPath('appData'), APP_DIR_NAME);
  return {
    baseDir,
    statePath: path.join(baseDir, 'state.json'),
    tempPath: path.join(baseDir, 'state.tmp.json'),
    backupPath: path.join(baseDir, 'state.json.bak')
  };
};

let cachedState: AppState | null = null;

const ensureDirectories = async () => {
  const { baseDir } = resolveStatePaths();
  await fs.ensureDir(baseDir);
};

const readStateFile = async (): Promise<AppState | null> => {
  const { statePath, backupPath } = resolveStatePaths();
  try {
    const data = await fs.readFile(statePath, 'utf8');
    return JSON.parse(data) as AppState;
  } catch (error) {
    try {
      const fallback = await fs.readFile(backupPath, 'utf8');
      return JSON.parse(fallback) as AppState;
    } catch {
      return null;
    }
  }
};

const writeAtomic = async (state: AppState) => {
  const { tempPath, statePath, backupPath } = resolveStatePaths();
  const payload = JSON.stringify(state, null, 2);
  await fs.writeFile(tempPath, payload, 'utf8');
  await fs.move(tempPath, statePath, { overwrite: true });
  await fs.copy(statePath, backupPath, { overwrite: true });
};

export const loadState = async (): Promise<AppState> => {
  await ensureDirectories();
  const appVersion = app.getVersion();
  const now = new Date();
  const rawState = (await readStateFile()) ?? createEmptyState(appVersion, now);
  const hydrated = rehydrateState(rawState, appVersion, now);
  cachedState = hydrated;
  await writeAtomic(hydrated);
  return hydrated;
};

export const saveState = async (state: AppState): Promise<AppState> => {
  await ensureDirectories();
  const nextState: AppState = {
    ...state,
    meta: {
      ...state.meta,
      appVersion: app.getVersion(),
      lastSavedAt: new Date().toISOString()
    }
  };
  cachedState = nextState;
  await writeAtomic(nextState);
  return nextState;
};

export const getCachedState = (): AppState | null => cachedState;
