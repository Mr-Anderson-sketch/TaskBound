// tests/renderer/keys — pure keyboard-model tests for src/renderer/planner/keys.ts
// (Task 4.2 addendum ruling 2/7). No DOM: `isEditableTarget`'s HTMLElement branch is
// exercised via jsdom-free plain objects that simply aren't `instanceof HTMLElement`
// (see its own test below), matching the rest of this suite's 'node' environment.
import { describe, it, expect } from 'vitest';
import { commandForKey, isEditableTarget, nextSelection, reorderTarget, snoozeOptions } from '../../src/renderer/planner/keys';
import type { KeyLike } from '../../src/renderer/planner/keys';

const key = (k: Partial<KeyLike> & { key: string }): KeyLike => ({
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...k
});

describe('commandForKey: plain single-key commands (no chord, no modifiers)', () => {
  it.each([
    ['j', { type: 'nav', dir: 'down' }],
    ['ArrowDown', { type: 'nav', dir: 'down' }],
    ['k', { type: 'nav', dir: 'up' }],
    ['ArrowUp', { type: 'nav', dir: 'up' }],
    [' ', { type: 'toggleDone' }],
    ['Enter', { type: 'openDetail' }],
    ['e', { type: 'editTitle' }],
    ['t', { type: 'toggleToday' }],
    ['x', { type: 'delete' }],
    ['Delete', { type: 'delete' }],
    ['s', { type: 'snooze' }],
    ['d', { type: 'due' }],
    ['m', { type: 'move' }],
    ['g', { type: 'chordStart' }]
  ] as const)('%s -> %j', (k, expected) => {
    expect(commandForKey(key({ key: k }), 'win32', undefined)).toEqual(expected);
  });

  it('an unmapped key returns undefined', () => {
    expect(commandForKey(key({ key: 'z' }), 'win32', undefined)).toBeUndefined();
    expect(commandForKey(key({ key: 'F1' }), 'win32', undefined)).toBeUndefined();
  });

  it('is case-insensitive for letter keys', () => {
    expect(commandForKey(key({ key: 'E' }), 'win32', undefined)).toEqual({ type: 'editTitle' });
    expect(commandForKey(key({ key: 'X' }), 'win32', undefined)).toEqual({ type: 'delete' });
  });
});

describe('commandForKey: Shift+Arrow reorders', () => {
  it('Shift+ArrowUp / Shift+ArrowDown -> reorder up/down', () => {
    expect(commandForKey(key({ key: 'ArrowUp', shiftKey: true }), 'win32', undefined)).toEqual({ type: 'reorder', dir: 'up' });
    expect(commandForKey(key({ key: 'ArrowDown', shiftKey: true }), 'win32', undefined)).toEqual({ type: 'reorder', dir: 'down' });
  });

  it('Shift + an unrelated key is not a command', () => {
    expect(commandForKey(key({ key: 'j', shiftKey: true }), 'win32', undefined)).toBeUndefined();
  });
});

describe('commandForKey: platform modifiers', () => {
  it('Ctrl+K opens the command palette on win32/linux; Meta+K on darwin', () => {
    expect(commandForKey(key({ key: 'k', ctrlKey: true }), 'win32', undefined)).toEqual({ type: 'commandPalette' });
    expect(commandForKey(key({ key: 'k', ctrlKey: true }), 'linux', undefined)).toEqual({ type: 'commandPalette' });
    expect(commandForKey(key({ key: 'k', metaKey: true }), 'darwin', undefined)).toEqual({ type: 'commandPalette' });
  });

  it('the WRONG modifier for the platform does not open the palette', () => {
    expect(commandForKey(key({ key: 'k', metaKey: true }), 'win32', undefined)).toBeUndefined();
    expect(commandForKey(key({ key: 'k', ctrlKey: true }), 'darwin', undefined)).toBeUndefined();
  });

  it('Ctrl/Cmd+K wins even while a chord is pending', () => {
    expect(commandForKey(key({ key: 'k', ctrlKey: true }), 'win32', 'g')).toEqual({ type: 'commandPalette' });
  });

  it('any other modifier combination is not a planner shortcut', () => {
    expect(commandForKey(key({ key: 'j', ctrlKey: true }), 'win32', undefined)).toBeUndefined();
    expect(commandForKey(key({ key: 'e', altKey: true }), 'win32', undefined)).toBeUndefined();
    expect(commandForKey(key({ key: 's', metaKey: true }), 'darwin', undefined)).toBeUndefined();
  });
});

describe('commandForKey: g-chords and their timeout', () => {
  it('g then t/u/i/l navigates to Today/Upcoming/Inbox/Logbook while the chord is open', () => {
    expect(commandForKey(key({ key: 't' }), 'win32', 'g')).toEqual({ type: 'goto', view: 'today' });
    expect(commandForKey(key({ key: 'u' }), 'win32', 'g')).toEqual({ type: 'goto', view: 'upcoming' });
    expect(commandForKey(key({ key: 'i' }), 'win32', 'g')).toEqual({ type: 'goto', view: 'inbox' });
    expect(commandForKey(key({ key: 'l' }), 'win32', 'g')).toEqual({ type: 'goto', view: 'logbook' });
  });

  it('is case-insensitive for the chord continuation too', () => {
    expect(commandForKey(key({ key: 'T' }), 'win32', 'g')).toEqual({ type: 'goto', view: 'today' });
  });

  it('an unrelated key while the chord is open breaks it silently (no command)', () => {
    expect(commandForKey(key({ key: 'j' }), 'win32', 'g')).toBeUndefined();
  });

  it('a modified key while the chord is open breaks it too', () => {
    expect(commandForKey(key({ key: 't', shiftKey: true }), 'win32', 'g')).toBeUndefined();
  });

  it('once the caller\'s timeout has cleared chordState, the SAME key falls back to its ordinary mapping', () => {
    // "t" while a chord is open goes to Today; the same "t" with no chord pending
    // (the caller's 1 s window already expired) is the ordinary toggleToday shortcut —
    // this is how CHORD_WINDOW_MS's expiry is exercised at the pure-function level.
    expect(commandForKey(key({ key: 't' }), 'win32', 'g')).toEqual({ type: 'goto', view: 'today' });
    expect(commandForKey(key({ key: 't' }), 'win32', undefined)).toEqual({ type: 'toggleToday' });
  });
});

describe('isEditableTarget', () => {
  it('is false for a non-HTMLElement (e.g. jsdom-free null/plain object)', () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget({} as EventTarget)).toBe(false);
  });
});

describe('reorderTarget', () => {
  it('up: swaps with the previous neighbour — afterId is the item two back', () => {
    expect(reorderTarget(['a', 'b', 'c', 'd'], 'c', 'up')).toEqual({ afterId: 'a' });
  });

  it('up: moving the second item to the front uses afterId: null', () => {
    expect(reorderTarget(['a', 'b', 'c'], 'b', 'up')).toEqual({ afterId: null });
  });

  it('up: the first item is already at the front — no-op', () => {
    expect(reorderTarget(['a', 'b', 'c'], 'a', 'up')).toBeUndefined();
  });

  it('down: swaps with the next neighbour — afterId is that neighbour itself', () => {
    expect(reorderTarget(['a', 'b', 'c', 'd'], 'b', 'down')).toEqual({ afterId: 'c' });
  });

  it('down: the last item is already at the end — no-op', () => {
    expect(reorderTarget(['a', 'b', 'c'], 'c', 'down')).toBeUndefined();
  });

  it('an id not in the list at all is a no-op', () => {
    expect(reorderTarget(['a', 'b'], 'ghost', 'up')).toBeUndefined();
    expect(reorderTarget(['a', 'b'], 'ghost', 'down')).toBeUndefined();
  });
});

describe('snoozeOptions', () => {
  it('before 17:00: includes This evening at 18:00 local today', () => {
    const now = new Date(2026, 8, 15, 10, 0).getTime(); // Tue 15 Sep 2026, 10:00
    const options = snoozeOptions(now);
    const evening = options.find((o) => o.id === 'evening');
    expect(evening?.until).toBe(new Date(2026, 8, 15, 18, 0).getTime());
  });

  it('at/after 17:00: This evening is omitted', () => {
    const now = new Date(2026, 8, 15, 17, 0).getTime();
    const options = snoozeOptions(now);
    expect(options.some((o) => o.id === 'evening')).toBe(false);
  });

  it('1 hour is exactly now + 60 minutes', () => {
    const now = new Date(2026, 8, 15, 10, 0).getTime();
    expect(snoozeOptions(now).find((o) => o.id === 'hour')?.until).toBe(now + 60 * 60 * 1000);
  });

  it('Tomorrow is 09:00 local the next calendar day', () => {
    const now = new Date(2026, 8, 15, 22, 0).getTime();
    expect(snoozeOptions(now).find((o) => o.id === 'tomorrow')?.until).toBe(new Date(2026, 8, 16, 9, 0).getTime());
  });

  it('Next week is next Monday 09:00, even when today already is Monday', () => {
    const monday = new Date(2026, 8, 14, 10, 0).getTime(); // Mon 14 Sep 2026
    expect(new Date(monday).getDay()).toBe(1);
    const nextWeek = snoozeOptions(monday).find((o) => o.id === 'nextWeek')!.until!;
    expect(new Date(nextWeek).getDay()).toBe(1);
    expect(nextWeek).toBe(new Date(2026, 8, 21, 9, 0).getTime()); // the FOLLOWING Monday
  });

  it('Next week from a Saturday is the very next day (Monday)', () => {
    const saturday = new Date(2026, 8, 19, 10, 0).getTime(); // Sat 19 Sep 2026
    expect(new Date(saturday).getDay()).toBe(6);
    const nextWeek = snoozeOptions(saturday).find((o) => o.id === 'nextWeek')!.until!;
    expect(nextWeek).toBe(new Date(2026, 8, 21, 9, 0).getTime());
  });

  it('always ends with a Pick… option carrying no `until`', () => {
    const options = snoozeOptions(Date.now());
    expect(options[options.length - 1]).toEqual({ id: 'pick', label: 'Pick…' });
  });
});

describe('nextSelection', () => {
  it('keeps selection when the removed id is still visible (e.g. Today keeps a just-completed task in Done)', () => {
    expect(nextSelection(['a', 'b', 'c'], ['a', 'b', 'c'], 'b')).toBe('b');
  });

  it('moves to the next id that still exists', () => {
    expect(nextSelection(['a', 'b', 'c'], ['a', 'c'], 'b')).toBe('c');
  });

  it('falls back to the previous id when the removed row was last', () => {
    expect(nextSelection(['a', 'b', 'c'], ['a', 'b'], 'c')).toBe('b');
  });

  it('returns undefined when the view is now empty', () => {
    expect(nextSelection(['a'], [], 'a')).toBeUndefined();
  });

  it('returns the first new id when the removed id was not even in oldIds', () => {
    expect(nextSelection(['a', 'b'], ['c', 'd'], 'ghost')).toBe('c');
  });

  it('skips over several removed neighbours to find the next surviving id', () => {
    expect(nextSelection(['a', 'b', 'c', 'd'], ['a', 'd'], 'b')).toBe('d');
  });
});
