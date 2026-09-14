import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { resolveDataDir } from '../../src/main/paths';

describe('resolveDataDir', () => {
  it('prefers a non-empty env override over everything else', () => {
    const result = resolveDataDir({ userData: '/user-data', env: '/env-dir', settingsDataDir: '/settings-dir' });
    expect(result).toBe(path.resolve('/env-dir'));
  });

  it('falls back to settingsDataDir when env is absent or empty', () => {
    const absent = resolveDataDir({ userData: '/user-data', settingsDataDir: '/settings-dir' });
    expect(absent).toBe(path.resolve('/settings-dir'));

    const empty = resolveDataDir({ userData: '/user-data', env: '', settingsDataDir: '/settings-dir' });
    expect(empty).toBe(path.resolve('/settings-dir'));
  });

  it('falls back to userData when neither env nor settingsDataDir is set', () => {
    const neither = resolveDataDir({ userData: '/user-data' });
    expect(neither).toBe(path.resolve('/user-data'));

    const bothEmpty = resolveDataDir({ userData: '/user-data', env: '', settingsDataDir: '' });
    expect(bothEmpty).toBe(path.resolve('/user-data'));
  });
});
