// tests/renderer/planner — pure planner logic (Task 4.1 fix round 1, item 4):
// TaskList's resolveView() and TaskRow's dueInfo()/shortDateLabel(). No DOM, no React
// rendering — plain data in, plain data out (see tests/renderer/captureModel.test.ts's
// header comment for why: the 'node' Vitest environment has no jsdom/@testing-library).
import { describe, it, expect } from 'vitest';
import { reduce } from '../../src/core/reducer';
import { createEmptyData, INBOX_ID } from '../../src/core/defaults';
import { resolveView, activeDescendantFor } from '../../src/renderer/planner/TaskList';
import { dueInfo, shortDateLabel, rowDomId } from '../../src/renderer/planner/TaskRow';
import { ymd, addDays } from '../../src/core/dates';
import type { Data } from '../../src/core/types';

// Tue 15 Sep 2026 10:00 local — built from local Date components (not a fixed epoch
// literal), so this is the same calendar date under both time zones `npm test` runs
// under (see tests/core/select.test.ts / captureModel.test.ts for the same convention).
const now = new Date(2026, 8, 15, 10, 0).getTime();
const today = ymd(now);
const tomorrow = addDays(today, 1);

function add(d: Data, id: string, title: string, extra: Record<string, unknown> = {}): Data {
  return reduce(d, { type: 'task/add', id, now, title, ...extra });
}

describe('shortDateLabel', () => {
  it('formats as weekday-short day month-short, no year, no comma', () => {
    expect(shortDateLabel('2026-09-16')).toBe('Wed 16 Sep');
  });

  it('a single-digit day has no leading zero', () => {
    expect(shortDateLabel('2026-09-05')).toBe('Sat 5 Sep');
  });
});

describe('dueInfo', () => {
  it('a same-day due with a time: "due HH:mm", not overdue', () => {
    expect(dueInfo({ date: today, time: '09:00' }, now)).toEqual({ text: 'due 09:00', overdue: false });
  });

  it('a same-day due with NO time: the date label, not overdue', () => {
    expect(dueInfo({ date: today }, now)).toEqual({ text: shortDateLabel(today), overdue: false });
  });

  it('tomorrow (date only): the date label, not overdue', () => {
    expect(dueInfo({ date: tomorrow }, now)).toEqual({ text: 'Wed 16 Sep', overdue: false });
  });

  it('a date next week with a time: the date label (date wins over time when not today), not overdue', () => {
    const nextWeek = addDays(today, 7);
    expect(dueInfo({ date: nextWeek, time: '15:00' }, now)).toEqual({ text: shortDateLabel(nextWeek), overdue: false });
  });

  it('a date before today: overdue: true', () => {
    const yesterday = addDays(today, -1);
    expect(dueInfo({ date: yesterday, time: '09:00' }, now)).toEqual({ text: shortDateLabel(yesterday), overdue: true });
  });
});

describe('resolveView: today', () => {
  it('sections in order Current, Up next, Done; empty groups omitted', () => {
    let d = createEmptyData(now, '2.0.0');
    d = add(d, 'a', 'A', { today: true });
    d = add(d, 'b', 'B', { today: true });
    d = add(d, 'c', 'C', { today: true });
    d = reduce(d, { type: 'task/complete', id: 'c', now, by: 'user' });

    const resolved = resolveView('today', d, now);
    expect(resolved.title).toBe('Today');
    expect(resolved.isEmpty).toBe(false);
    expect(resolved.sections.map((s) => s.key)).toEqual(['current', 'upnext', 'done']);
    expect(resolved.sections[0]).toMatchObject({ label: 'Current', ariaLabel: 'Current', currentId: 'a' });
    expect(resolved.sections[0].tasks.map((t) => t.id)).toEqual(['a']);
    expect(resolved.sections[1]).toMatchObject({ label: 'Up next', ariaLabel: 'Up next' });
    expect(resolved.sections[1].tasks.map((t) => t.id)).toEqual(['b']);
    expect(resolved.sections[2]).toMatchObject({ label: 'Done', ariaLabel: 'Done' });
    expect(resolved.sections[2].tasks.map((t) => t.id)).toEqual(['c']);
  });

  it('meta line: "Tuesday 15 September · X of Y done · Zm focused" (day-first, no comma, no year)', () => {
    let d = createEmptyData(now, '2.0.0');
    d = add(d, 'a', 'A', { today: true });
    d = add(d, 'b', 'B', { today: true });
    d = reduce(d, { type: 'task/complete', id: 'a', now, by: 'user' });

    const resolved = resolveView('today', d, now);
    expect(resolved.meta).toBe('Tuesday 15 September · 1 of 2 done · 0m focused');
  });

  it('only a Done section when every Today task is completed and none is open (no Current/Up next)', () => {
    let d = createEmptyData(now, '2.0.0');
    d = add(d, 'a', 'A', { today: true });
    d = reduce(d, { type: 'task/complete', id: 'a', now, by: 'user' });

    const resolved = resolveView('today', d, now);
    expect(resolved.sections.map((s) => s.key)).toEqual(['done']);
    expect(resolved.isEmpty).toBe(false);
  });

  it('isEmpty: true with no sections when there is nothing at all', () => {
    const resolved = resolveView('today', createEmptyData(now, '2.0.0'), now);
    expect(resolved.sections).toEqual([]);
    expect(resolved.isEmpty).toBe(true);
  });
});

describe('resolveView: upcoming', () => {
  it('groups by date, "Tomorrow" label for tomorrow, short date label otherwise', () => {
    let d = createEmptyData(now, '2.0.0');
    d = add(d, 'a', 'A', { today: false, due: { date: tomorrow } });
    const in3 = addDays(today, 3);
    d = add(d, 'b', 'B', { today: false, due: { date: in3 } });

    const resolved = resolveView('upcoming', d, now);
    expect(resolved.title).toBe('Upcoming');
    expect(resolved.meta).toBe('2 open');
    expect(resolved.isEmpty).toBe(false);
    expect(resolved.sections.map((s) => s.label)).toEqual(['Tomorrow', shortDateLabel(in3)]);
    expect(resolved.sections[0].tasks.map((t) => t.id)).toEqual(['a']);
  });

  it('isEmpty: true and no sections when nothing is due in the window', () => {
    const resolved = resolveView('upcoming', createEmptyData(now, '2.0.0'), now);
    expect(resolved.sections).toEqual([]);
    expect(resolved.isEmpty).toBe(true);
    expect(resolved.meta).toBe('0 open');
  });
});

describe('resolveView: inbox', () => {
  it('title Inbox, one unlabelled section of Inbox tasks', () => {
    let d = createEmptyData(now, '2.0.0');
    d = add(d, 'a', 'A', { today: false });
    const resolved = resolveView('inbox', d, now);
    expect(resolved.title).toBe('Inbox');
    expect(resolved.meta).toBe('1 open');
    expect(resolved.sections).toEqual([
      { key: 'inbox', ariaLabel: 'Inbox', showChildren: true, draggable: true, tasks: expect.arrayContaining([expect.objectContaining({ id: 'a' })]) }
    ]);
    expect(resolved.isEmpty).toBe(false);
  });

  it('isEmpty: true when Inbox has no open tasks', () => {
    const resolved = resolveView('inbox', createEmptyData(now, '2.0.0'), now);
    expect(resolved.isEmpty).toBe(true);
    expect(resolved.sections[0].tasks).toEqual([]);
  });
});

describe('resolveView: list:<id>', () => {
  it("title is the list's name, section scoped to that list", () => {
    let d = createEmptyData(now, '2.0.0');
    d = reduce(d, { type: 'list/add', id: 'work', now, name: 'Work' });
    d = add(d, 'a', 'A', { today: false, listId: 'work' });
    d = add(d, 'b', 'B', { today: false }); // stays in Inbox — must not leak into the Work view

    const resolved = resolveView('list:work', d, now);
    expect(resolved.title).toBe('Work');
    expect(resolved.meta).toBe('1 open');
    expect(resolved.sections).toHaveLength(1);
    expect(resolved.sections[0].tasks.map((t) => t.id)).toEqual(['a']);
  });

  it('falls back to "List" as the title for an id with no matching list', () => {
    const resolved = resolveView('list:no-such-list', createEmptyData(now, '2.0.0'), now);
    expect(resolved.title).toBe('List');
    expect(resolved.isEmpty).toBe(true);
  });
});

describe('resolveView: tag:<name>', () => {
  it('title is "#<tag>", section scoped to open top-level tasks carrying it', () => {
    let d = createEmptyData(now, '2.0.0');
    d = add(d, 'a', 'A', { today: false, tags: ['work'] });
    d = add(d, 'b', 'B', { today: false, tags: ['home'] });

    const resolved = resolveView('tag:work', d, now);
    expect(resolved.title).toBe('#work');
    expect(resolved.meta).toBe('1 open');
    expect(resolved.sections[0].tasks.map((t) => t.id)).toEqual(['a']);
  });

  it('isEmpty: true for an unused tag', () => {
    const resolved = resolveView('tag:nope', createEmptyData(now, '2.0.0'), now);
    expect(resolved.isEmpty).toBe(true);
  });
});

describe('activeDescendantFor (Task 4.2 fix round 1, finding 2)', () => {
  it('returns rowDomId(selectedId) when selectedId is in mountedIds', () => {
    expect(activeDescendantFor('a', new Set(['a', 'b']))).toBe(rowDomId('a'));
  });

  it('returns undefined when selectedId is NOT mounted (e.g. scrolled out of a virtualised range)', () => {
    expect(activeDescendantFor('a', new Set(['b', 'c']))).toBeUndefined();
  });

  it('returns undefined when nothing is selected', () => {
    expect(activeDescendantFor(undefined, new Set(['a', 'b']))).toBeUndefined();
  });

  it('returns undefined when mountedIds is empty', () => {
    expect(activeDescendantFor('a', new Set())).toBeUndefined();
  });
});

describe('resolveView: logbook', () => {
  it('title Logbook, forceVirtual on its section, done tasks newest first', () => {
    let d = createEmptyData(now, '2.0.0');
    d = add(d, 'a', 'A', { today: false });
    d = add(d, 'b', 'B', { today: false });
    d = reduce(d, { type: 'task/complete', id: 'a', now, by: 'user' });
    d = reduce(d, { type: 'task/complete', id: 'b', now: now + 1000, by: 'user' });

    const resolved = resolveView('logbook', d, now);
    expect(resolved.title).toBe('Logbook');
    expect(resolved.meta).toBe('2 completed');
    expect(resolved.sections).toEqual([{ key: 'logbook', ariaLabel: 'Logbook', forceVirtual: true, tasks: expect.any(Array) }]);
    expect(resolved.sections[0].tasks.map((t) => t.id)).toEqual(['b', 'a']);
    expect(resolved.isEmpty).toBe(false);
  });

  it('isEmpty: true, forceVirtual still set, when nothing is completed yet', () => {
    const resolved = resolveView('logbook', createEmptyData(now, '2.0.0'), now);
    expect(resolved.isEmpty).toBe(true);
    expect(resolved.sections[0].forceVirtual).toBe(true);
  });
});
