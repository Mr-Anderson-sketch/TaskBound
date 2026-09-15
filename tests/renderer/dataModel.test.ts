// Task 5.3: pure helper behind the Settings "Data" section's backups list — parses a
// backup file's absolute path (`.../backups/data-YYYY-MM-DD.json`, see
// src/main/persist.ts's `backupPathFor`) into the epoch-ms local midnight it names, so
// the section can format it with `longDayLabel`. Plain 'node' env, same convention as
// tests/renderer/settingsModel.test.ts.
import { describe, it, expect } from 'vitest';
import { backupDateMs } from '../../src/renderer/settings/dataModel';

describe('backupDateMs', () => {
  it('parses a POSIX backup path', () => {
    const ms = backupDateMs('/home/me/.config/TimeBound/backups/data-2026-09-14.json');
    expect(ms).toBeDefined();
    const d = new Date(ms!);
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 8, 14]);
  });

  it('parses a Windows backup path', () => {
    const ms = backupDateMs('C:\\Users\\me\\AppData\\Roaming\\TimeBound\\backups\\data-2026-01-05.json');
    expect(ms).toBeDefined();
    const d = new Date(ms!);
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 0, 5]);
  });

  it('parses a bare filename with no directory', () => {
    const ms = backupDateMs('data-2025-12-31.json');
    expect(ms).toBeDefined();
    const d = new Date(ms!);
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2025, 11, 31]);
  });

  it('returns local midnight (not a UTC-shifted instant)', () => {
    const ms = backupDateMs('data-2026-09-14.json')!;
    expect(ms).toBe(new Date(2026, 8, 14).getTime());
  });

  it('returns undefined for a name that does not match the backup pattern', () => {
    expect(backupDateMs('/backups/state.json')).toBeUndefined();
    expect(backupDateMs('/backups/data-2026-09-14.md')).toBeUndefined();
    expect(backupDateMs('/backups/data-14-09-2026.json')).toBeUndefined();
    expect(backupDateMs('')).toBeUndefined();
  });
});
