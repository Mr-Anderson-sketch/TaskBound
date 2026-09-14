// main/paths — resolves the data directory the persistence layer reads/writes.
// Pure Node (no Electron import): main.ts passes app.getPath('userData') in as `userData`.
import path from 'node:path';

export interface ResolveDataDirOpts {
  userData: string;
  env?: string;
  settingsDataDir?: string;
}

/**
 * Precedence: a non-empty `env` (TIMEBOUND_DATA_DIR) wins, then a non-empty
 * `settingsDataDir` (Settings.dataDir), else `userData`. The winning path is
 * returned resolved (path.resolve) but otherwise unchanged.
 */
export function resolveDataDir(opts: ResolveDataDirOpts): string {
  const { userData, env, settingsDataDir } = opts;
  if (env && env.length > 0) return path.resolve(env);
  if (settingsDataDir && settingsDataDir.length > 0) return path.resolve(settingsDataDir);
  return path.resolve(userData);
}
