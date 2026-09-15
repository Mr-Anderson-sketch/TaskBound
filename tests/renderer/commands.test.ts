// tests/renderer/commands — pure command-palette model tests (Task 4.2 addendum ruling
// 4/7): `allCommands` (the full list for a context) and `filterCommands` (fuzzy
// subsequence filter/rank). No DOM — see keys.test.ts's header comment for why.
import { describe, it, expect } from 'vitest';
import { allCommands, filterCommands } from '../../src/renderer/planner/commandsModel';
import type { List, Task } from '../../src/core/types';

const lists: List[] = [{ id: 'inbox', name: 'Inbox', order: 1000, createdAt: 0 }];

function task(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'A task',
    listId: 'inbox',
    tags: [],
    order: 1000,
    today: true,
    status: 'open',
    createdAt: 0,
    updatedAt: 0,
    ...over
  };
}

describe('allCommands', () => {
  it('always includes the four "Go to" view commands, in order', () => {
    const commands = allCommands({ lists: [], tags: [], platform: 'win32' });
    expect(commands.slice(0, 4).map((c) => c.label)).toEqual(['Go to Today', 'Go to Upcoming', 'Go to Inbox', 'Go to Logbook']);
  });

  it('adds one "Go to list: <name>" per list and "Go to tag: #<tag>" per tag', () => {
    const commands = allCommands({ lists: [{ id: 'work', name: 'Work', order: 1000, createdAt: 0 }], tags: ['errand'], platform: 'win32' });
    expect(commands.map((c) => c.label)).toContain('Go to list: Work');
    expect(commands.map((c) => c.label)).toContain('Go to tag: #errand');
  });

  it('omits the per-task commands when nothing is selected', () => {
    const commands = allCommands({ lists, tags: [], platform: 'win32' });
    expect(commands.some((c) => c.action.kind === 'complete')).toBe(false);
    expect(commands.some((c) => c.action.kind === 'delete')).toBe(false);
  });

  it('includes Complete, Toggle today, Snooze…, Set due date…, Move to list…, Delete when a task is selected', () => {
    const commands = allCommands({ lists, tags: [], selectedTask: task(), platform: 'win32' });
    const labels = commands.map((c) => c.label);
    expect(labels).toEqual(expect.arrayContaining(['Complete', 'Toggle today', 'Snooze…', 'Set due date…', 'Move to list…', 'Delete']));
  });

  it('always includes "Add a task" and all four theme + three appearance commands', () => {
    const commands = allCommands({ lists: [], tags: [], platform: 'win32' });
    expect(commands.map((c) => c.label)).toEqual(
      expect.arrayContaining([
        'Add a task',
        'Theme: Ledger',
        'Theme: Kraft',
        'Theme: Phosphor',
        'Theme: Slate',
        'Appearance: Light',
        'Appearance: Dark',
        'Appearance: System'
      ])
    );
  });

  it('every command has a unique id', () => {
    const commands = allCommands({ lists: [{ id: 'work', name: 'Work', order: 1000, createdAt: 0 }], tags: ['x'], selectedTask: task(), platform: 'win32' });
    const ids = commands.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('filterCommands', () => {
  const commands = allCommands({ lists, tags: [], platform: 'win32' });

  it('an empty query returns the first 8 commands, unranked', () => {
    const result = filterCommands(commands, '');
    expect(result).toEqual(commands.slice(0, 8));
  });

  it('a whitespace-only query behaves like empty', () => {
    expect(filterCommands(commands, '   ')).toEqual(commands.slice(0, 8));
  });

  it('matches a case-insensitive subsequence, not just a substring', () => {
    const result = filterCommands(commands, 'gti'); // "Go To Inbox" — g-t-i in order
    expect(result[0].label).toBe('Go to Inbox');
  });

  it('ranks an earlier match position above a later one', () => {
    // "today" matches "Go to Today" starting near its front, AND "Toggle today" earlier
    // still (starts at index 0) — Toggle today should rank first once a task is selected.
    const withTask = allCommands({ lists, tags: [], selectedTask: task(), platform: 'win32' });
    const result = filterCommands(withTask, 'today');
    expect(result[0].label).toBe('Toggle today');
  });

  it('caps results at 8', () => {
    const many = allCommands({
      lists: Array.from({ length: 20 }, (_, i) => ({ id: `l${i}`, name: `List ${i}`, order: i, createdAt: 0 })),
      tags: [],
      platform: 'win32'
    });
    const result = filterCommands(many, 'go to list');
    expect(result.length).toBeLessThanOrEqual(8);
  });

  it('a query that matches nothing returns an empty array', () => {
    expect(filterCommands(commands, 'zzzzzqqqqq')).toEqual([]);
  });

  it('a query is trimmed before matching', () => {
    const result = filterCommands(commands, '  today  ');
    expect(result.length).toBeGreaterThan(0);
  });
});
