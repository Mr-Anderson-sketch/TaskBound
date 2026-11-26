import { describe, expect, it } from 'vitest';
import { DEFAULT_SITES, defaultBlocking, describeWindow, normalizeBlocking, normalizeSite } from '../src/shared/blocking';
import { normalizeState } from '../src/shared/stateHelpers';
import { reducer } from '../src/renderer/store/reducer';
import type { AppState } from '../src/shared/types';

describe('normalizeSite', () => {
  it.each([
    ['youtube.com', 'youtube.com'],
    ['  YouTube.com  ', 'youtube.com'],
    ['https://www.youtube.com/', 'youtube.com'],
    ['http://m.facebook.com/home.php?x=1#top', 'm.facebook.com/home.php'],
    ['www.youtube.com/shorts/', 'youtube.com/shorts'],
    ['youtube.com:443/watch', 'youtube.com/watch'],
    ['x.com', 'x.com']
  ])('%s -> %s', (input, expected) => {
    expect(normalizeSite(input)).toBe(expected);
  });

  it.each(['', '   ', 'youtube', 'not a site', '-bad.com', 'bad-.com', 'a..com', 'https://'])('rejects %j', (input) => {
    expect(normalizeSite(input)).toBeNull();
  });
});

describe('normalizeBlocking', () => {
  it('gives the default list to a state with no blocking settings', () => {
    expect(normalizeBlocking(undefined)).toEqual(defaultBlocking());
    expect(defaultBlocking().sites).toEqual([...DEFAULT_SITES]);
    expect(defaultBlocking().duringTasks).toBe(true);
  });

  it('keeps an emptied list empty instead of restoring defaults', () => {
    expect(normalizeBlocking({ duringTasks: false, sites: [], apps: [], windows: [] }).sites).toEqual([]);
  });

  it('cleans, de-duplicates and drops bad entries', () => {
    const out = normalizeBlocking({
      duringTasks: true,
      sites: ['https://www.YouTube.com', 'youtube.com', 42, 'nope'],
      apps: [{ bundleId: 'com.tinyspeck.slackmacgap', name: 'Slack' }, { name: 'no id' }],
      windows: [
        { id: 'w1', days: [5, 1, 1, 9], start: '09:00', end: '12:00' },
        { id: 'w2', days: [1], start: '9:00', end: '12:00', enabled: true }
      ]
    });
    expect(out.sites).toEqual(['youtube.com']);
    expect(out.apps).toEqual([{ bundleId: 'com.tinyspeck.slackmacgap', name: 'Slack' }]);
    expect(out.windows).toEqual([{ id: 'w1', days: [1, 5], start: '09:00', end: '12:00', enabled: true }]);
  });

  it('survives a load and a settings change', () => {
    const blocking = { duringTasks: false, sites: ['reddit.com'], apps: [], windows: [] };
    const loaded = normalizeState({ preferences: { blocking } } as unknown as AppState, 't');
    expect(loaded.preferences.blocking).toEqual(blocking);
    const changed = reducer(loaded, { type: 'setBlocking', payload: { blocking: { ...blocking, duringTasks: true } } });
    expect(changed.preferences.blocking.duringTasks).toBe(true);
  });
});

describe('describeWindow', () => {
  it('names common day sets and overnight windows', () => {
    expect(describeWindow({ id: 'a', days: [1, 2, 3, 4, 5], start: '09:00', end: '12:00', enabled: true })).toBe('Weekdays · 9:00 AM – 12:00 PM');
    expect(describeWindow({ id: 'b', days: [0, 6], start: '22:00', end: '01:30', enabled: true })).toBe('Weekends · 10:00 PM – 1:30 AM (next day)');
    expect(describeWindow({ id: 'c', days: [0, 1, 3], start: '00:00', end: '23:59', enabled: true })).toBe('Mon, Wed, Sun · 12:00 AM – 11:59 PM');
  });
});
