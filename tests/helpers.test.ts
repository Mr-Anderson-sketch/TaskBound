import { describe, expect, it } from 'vitest';
import { completedToday, normalizeState, summarizeDay, toLocalDateKey } from '../src/shared/stateHelpers';
import type { AppState, Task } from '../src/shared/types';
import { formatDuration, formatSeconds } from '../src/renderer/utils/time';

describe('normalizeState', () => {
  it('fills preferences for a 1.x state file', () => {
    const legacy = {
      score: 68,
      tasks: [],
      stats: { totalCompleted: 82, todayCompleted: 5, lastCompletionDate: '' },
      meta: { lastSavedAt: '2026-10-16T10:00:00Z', appVersion: '1.0.0' },
      preferences: { alwaysOnTop: false }
    } as unknown as AppState;
    const state = normalizeState(legacy, '1.2.0');
    expect(state.preferences).toEqual({ alwaysOnTop: false, theme: 'dark', menuBarTimer: true, focusPositions: undefined });
    expect(state.stats.lastCompletionDate).toBeUndefined();
    expect(state.score).toBe(68);
  });

  it('returns a fresh state for nothing', () => {
    expect(normalizeState(null, '1.2.0').tasks).toEqual([]);
  });
});

describe('completedToday', () => {
  it('shows zero when the last completion was on an earlier day', () => {
    const state = normalizeState({ stats: { totalCompleted: 5, todayCompleted: 5, lastCompletionDate: '2026-10-15' } }, '1');
    expect(completedToday(state, new Date('2026-10-16T09:00:00+05:30'))).toBe(0);
    expect(completedToday(state, new Date('2026-10-15T23:00:00+05:30'))).toBe(5);
  });
});

describe('summarizeDay', () => {
  const now = new Date('2026-10-16T18:00:00+05:30');
  const base = { createdAt: '', updatedAt: '', history: [] as Task['history'] };
  const tasks: Task[] = [
    {
      ...base,
      id: 'early',
      title: 'early',
      status: 'completed',
      timeAssignedSeconds: 1500,
      remainingSeconds: 0,
      completedAt: '2026-10-16T10:00:00+05:30',
      history: [{ type: 'manual_complete', amountSeconds: 300, at: '' }]
    },
    {
      ...base,
      id: 'late',
      title: 'late',
      status: 'struck',
      timeAssignedSeconds: 1200,
      remainingSeconds: 0,
      completedAt: '2026-10-16T11:00:00+05:30',
      history: [
        { type: 'add_time', amountSeconds: 300, at: '' },
        { type: 'auto_complete', amountSeconds: 1200, at: '' }
      ]
    },
    { ...base, id: 'yesterday', title: 'y', status: 'completed', timeAssignedSeconds: 600, completedAt: '2026-10-15T10:00:00+05:30' },
    { ...base, id: 'open', title: 'o', status: 'pending', timeAssignedSeconds: 600 }
  ];

  it('counts only today’s finished tasks and compares plan with reality', () => {
    expect(summarizeDay(tasks, now)).toEqual({
      done: 2,
      plannedSeconds: 1500 + 900,
      spentSeconds: 1200 + 1200,
      timeAdds: 1,
      finishedEarly: 1
    });
  });
});

describe('formatting', () => {
  it('formats clocks and durations', () => {
    expect(formatSeconds(undefined)).toBe('--:--');
    expect(formatSeconds(65)).toBe('01:05');
    expect(formatSeconds(3725)).toBe('1:02:05');
    expect(formatDuration(3900)).toBe('1h 05m');
    expect(formatDuration(1500)).toBe('25m');
  });

  it('builds local date keys', () => {
    expect(toLocalDateKey(new Date('2026-10-16T20:00:00Z'))).toBe('2026-10-17');
  });
});
