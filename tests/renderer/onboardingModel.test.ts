import { describe, it, expect } from 'vitest';
import { importedTaskCount, hasLegacyImport } from '../../src/renderer/palette/onboardingModel';
import { createEmptyData } from '../../src/core/defaults';
import type { Data, Task } from '../../src/core/types';

const now = new Date(2026, 8, 14, 10, 0).getTime();

function makeTask(id: string, createdAt: number): Task {
  return {
    id,
    title: `task ${id}`,
    listId: 'inbox',
    tags: [],
    order: 1000,
    today: false,
    status: 'open',
    createdAt,
    updatedAt: createdAt
  };
}

describe('onboardingModel: hasLegacyImport', () => {
  it('is false for fresh data with no meta.legacyImportedAt', () => {
    const data = createEmptyData(now, '1.0.0');
    expect(hasLegacyImport(data)).toBe(false);
  });

  it('is true once meta.legacyImportedAt is set', () => {
    const data: Data = { ...createEmptyData(now, '1.0.0'), meta: { ...createEmptyData(now, '1.0.0').meta, legacyImportedAt: now } };
    expect(hasLegacyImport(data)).toBe(true);
  });
});

describe('onboardingModel: importedTaskCount', () => {
  it('is 0 when there was no legacy import', () => {
    const data = createEmptyData(now, '1.0.0');
    data.tasks = [makeTask('a', now - 1000)];
    expect(importedTaskCount(data)).toBe(0);
  });

  it('counts every task created at or before the import instant', () => {
    const data = createEmptyData(now, '1.0.0');
    data.meta.legacyImportedAt = now;
    data.tasks = [makeTask('a', now - 10_000), makeTask('b', now - 1), makeTask('c', now)];
    expect(importedTaskCount(data)).toBe(3);
  });

  it('excludes a task created after the import instant (added post-migration, pre-onboarding)', () => {
    const data = createEmptyData(now, '1.0.0');
    data.meta.legacyImportedAt = now;
    data.tasks = [makeTask('a', now - 10_000), makeTask('b', now + 1)];
    expect(importedTaskCount(data)).toBe(1);
  });

  it('matches the 27-task legacy fixture (tests/fixtures/legacy-state.json, migrated)', () => {
    // Mirrors what migrate.ts produces: every migrated task's createdAt precedes
    // `legacyImportedAt` (= the migration's `now`), so all 27 survive the filter.
    const importedAt = now;
    const data = createEmptyData(now, '1.0.0');
    data.meta.legacyImportedAt = importedAt;
    data.tasks = Array.from({ length: 27 }, (_, i) => makeTask(`t${i}`, importedAt - (i + 1) * 1000));
    expect(importedTaskCount(data)).toBe(27);
  });
});
