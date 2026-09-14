import { describe, it, expect } from 'vitest';
import { migrateLegacy } from '../../src/core/migrate';
import { parseData } from '../../src/core/schema';
import { ymd } from '../../src/core/dates';
import legacyFixture from '../fixtures/legacy-state.json';

const NOW = 1_800_000_000_000;
const APP_VERSION = '2.0.0';

describe('migrateLegacy', () => {
  it('migrates the real fixture: 26 done tasks, none dropped, output parses', () => {
    const { data, dropped } = migrateLegacy(legacyFixture, NOW, APP_VERSION);
    expect(dropped).toBe(0);
    expect(data.tasks.length).toBe(27);
    expect(data.tasks.filter((t) => t.status === 'done').length).toBe(26);
    expect(() => parseData(JSON.parse(JSON.stringify(data)))).not.toThrow();
  });

  it('marks a struck task completedBy timer', () => {
    const { data } = migrateLegacy(legacyFixture, NOW, APP_VERSION);
    const struckSource = (legacyFixture as any).tasks.find((t: any) => t.status === 'struck');
    const migrated = data.tasks.find((t) => t.id === struckSource.id);
    expect(migrated?.status).toBe('done');
    expect(migrated?.completedBy).toBe('timer');
  });

  it('never replays elapsed time: spentSeconds is assigned minus remaining', () => {
    const raw = {
      tasks: [
        {
          id: 'synthetic-1',
          title: 'Synthetic timed task',
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T01:00:00.000Z',
          completedAt: '2025-01-01T01:00:00.000Z',
          timeAssignedSeconds: 1500,
          remainingSeconds: 600,
          status: 'completed',
          history: [{ type: 'manual_complete', amountSeconds: 999999, at: '2025-01-01T01:00:00.000Z' }]
        }
      ]
    };
    const { data, dropped } = migrateLegacy(raw, NOW, APP_VERSION);
    expect(dropped).toBe(0);
    expect(data.tasks[0].timer).toEqual({ plannedSeconds: 1500, spentSeconds: 900 });
  });

  it('maps a pending task to open', () => {
    const raw = {
      tasks: [
        {
          id: 'synthetic-2',
          title: 'Synthetic pending task',
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
          status: 'pending',
          history: []
        }
      ]
    };
    const { data, dropped } = migrateLegacy(raw, NOW, APP_VERSION);
    expect(dropped).toBe(0);
    expect(data.tasks[0].status).toBe('open');
    expect(data.tasks[0].completedBy).toBeUndefined();
    expect(data.tasks[0].completedAt).toBeUndefined();
  });

  it('derives days from the fixture completedAt values in local time, not hard-coded counts', () => {
    const { data } = migrateLegacy(legacyFixture, NOW, APP_VERSION);
    const expected = new Map<string, { completed: number; focusSeconds: number }>();
    for (const t of (legacyFixture as any).tasks) {
      if (t.status !== 'completed' && t.status !== 'struck') continue;
      const completedAtMs = t.completedAt ? Date.parse(t.completedAt) : Date.parse(t.updatedAt);
      const key = ymd(completedAtMs);
      const assigned = typeof t.timeAssignedSeconds === 'number' && t.timeAssignedSeconds > 0 ? t.timeAssignedSeconds : undefined;
      const remaining = typeof t.remainingSeconds === 'number' ? t.remainingSeconds : assigned;
      const spent = assigned !== undefined ? Math.max(0, assigned - (remaining ?? assigned)) : 0;
      const entry = expected.get(key) ?? { completed: 0, focusSeconds: 0 };
      entry.completed += 1;
      entry.focusSeconds += spent;
      expected.set(key, entry);
    }
    const expectedDays = Array.from(expected.entries())
      .map(([date, v]) => ({ date, completed: v.completed, focusSeconds: v.focusSeconds, rolledOver: 0 }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    expect(data.days).toEqual(expectedDays);
  });

  it('treats garbage input as empty data with dropped 0', () => {
    for (const garbage of [{}, null, 'x', { tasks: 'nope' }]) {
      const { data, dropped } = migrateLegacy(garbage, NOW, APP_VERSION);
      expect(dropped).toBe(0);
      expect(data.tasks).toEqual([]);
      expect(data.lists.length).toBe(1);
      expect(data.meta.legacyImportedAt).toBe(NOW);
      expect(() => parseData(JSON.parse(JSON.stringify(data)))).not.toThrow();
    }
  });

  it('drops a task missing a title and counts it', () => {
    const raw = {
      tasks: [
        { id: 'ok-1', title: 'Keep me', createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z', status: 'pending', history: [] },
        { id: 'no-title', createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z', status: 'pending', history: [] }
      ]
    };
    const { data, dropped } = migrateLegacy(raw, NOW, APP_VERSION);
    expect(dropped).toBe(1);
    expect(data.tasks.length).toBe(1);
    expect(data.tasks[0].id).toBe('ok-1');
  });
});
