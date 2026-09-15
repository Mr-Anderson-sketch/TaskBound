import { describe, it, expect } from 'vitest';
import { toJson, fromJson, toMarkdown, fromMarkdown, importPlan, ImportTooLargeError } from '../../src/core/export';
import { DataInvalidError } from '../../src/core/schema';
import { reduce } from '../../src/core/reducer';
import { createEmptyData } from '../../src/core/defaults';
import type { Data, Task } from '../../src/core/types';

const APP_VERSION = '2.0.0';
const t0 = 1_800_000_000_000;

function buildSampleData(): Data {
  let d = createEmptyData(t0, APP_VERSION);
  d = reduce(d, { type: 'list/add', id: 'work', now: t0, name: 'Work' });
  d = reduce(d, { type: 'list/add', id: 'home', now: t0, name: 'Home' });
  d = reduce(d, {
    type: 'task/add',
    id: 'p1',
    now: t0,
    title: 'Ship the report',
    listId: 'work',
    tags: ['urgent', 'q3'],
    due: { date: '2026-09-20', time: '15:00' }
  });
  d = reduce(d, { type: 'task/add', id: 'c1', now: t0, title: 'Draft outline', listId: 'work', parentId: 'p1' });
  d = reduce(d, { type: 'task/add', id: 'c2', now: t0, title: 'Get sign-off', listId: 'work', parentId: 'p1' });
  d = reduce(d, { type: 'task/complete', id: 'c1', now: t0 + 1000, by: 'user' });
  d = reduce(d, { type: 'task/add', id: 'p2', now: t0, title: 'Buy milk', listId: 'home', due: { date: '2026-09-21' } });
  return d;
}

describe('toJson / fromJson', () => {
  it('round-trips: fromJson(toJson(data)) deep-equals data', () => {
    const data = buildSampleData();
    const round = fromJson(toJson(data));
    expect(round).toEqual(data);
  });

  it('is pretty-printed with a stable key order regardless of the input object key order', () => {
    const data = buildSampleData();
    const reordered = {
      meta: data.meta,
      settings: data.settings,
      days: data.days,
      lists: data.lists,
      tasks: data.tasks,
      schemaVersion: data.schemaVersion
    } as Data;

    expect(toJson(data)).toBe(toJson(reordered));
    expect(toJson(data)).toContain('\n');
  });

  it('rejects malformed JSON text with DataInvalidError', () => {
    expect(() => fromJson('{ this is not json')).toThrow(DataInvalidError);
  });

  it('rejects valid JSON that fails schema validation with DataInvalidError', () => {
    expect(() => fromJson(JSON.stringify({ hello: 'world' }))).toThrow(DataInvalidError);
  });

  it('rejects an import over 20 MB before attempting to parse it', () => {
    const huge = '"' + 'a'.repeat(20 * 1024 * 1024 + 1) + '"';
    expect(() => fromJson(huge)).toThrow(ImportTooLargeError);
  });
});

describe('toMarkdown / fromMarkdown', () => {
  it('round-trips titles, done state, due, tags, and hierarchy', () => {
    const data = buildSampleData();
    const md = toMarkdown(data);

    expect(md).toContain('# Work');
    expect(md).toContain('# Home');
    expect(md).toContain('(due 2026-09-20 15:00)');
    expect(md).toContain('#urgent');
    expect(md).toContain('- [x] Draft outline');
    expect(md).toContain('  - [ ] Get sign-off');

    let nextId = 0;
    const idGen = () => `gen-${nextId++}`;
    const { tasks, lists } = fromMarkdown(md, t0, idGen);

    expect(lists.map((l) => l.name)).toEqual(['Inbox', 'Work', 'Home']);

    const byTitle = (title: string) => tasks.find((t) => t.title === title)!;
    const parent = byTitle('Ship the report');
    const done = byTitle('Draft outline');
    const open = byTitle('Get sign-off');
    const homeTask = byTitle('Buy milk');

    expect(parent.due).toEqual({ date: '2026-09-20', time: '15:00' });
    expect(parent.tags.sort()).toEqual(['q3', 'urgent']);
    expect(parent.parentId).toBeUndefined();

    expect(done.status).toBe('done');
    expect(done.parentId).toBe(parent.id);
    expect(open.status).toBe('open');
    expect(open.parentId).toBe(parent.id);

    expect(homeTask.due).toEqual({ date: '2026-09-21' });
    const homeList = lists.find((l) => l.name === 'Home')!;
    expect(homeTask.listId).toBe(homeList.id);
  });

  it('rejects an import over 20 MB before scanning it', () => {
    const huge = '# List\n' + 'x'.repeat(20 * 1024 * 1024 + 1);
    expect(() => fromMarkdown(huge, t0, () => 'x')).toThrow(ImportTooLargeError);
  });
});

describe('importPlan', () => {
  it('merges lists by case-insensitive name and adds new tasks (children after parents), completing done ones', () => {
    const current = buildSampleData(); // has lists 'Work' (id 'work'), 'Home' (id 'home')

    const importedLists = [
      { id: 'src-work', name: 'work', order: 1000, createdAt: t0 }, // matches existing "Work" case-insensitively
      { id: 'src-personal', name: 'Personal', order: 2000, createdAt: t0 } // new
    ];
    const importedTasks: Task[] = [
      {
        id: 'src-t1',
        title: 'Imported top task',
        listId: 'src-personal',
        parentId: undefined,
        tags: ['fresh'],
        order: 1000,
        today: false,
        status: 'done',
        createdAt: t0,
        updatedAt: t0
      },
      {
        id: 'src-t2',
        title: 'Imported child task',
        listId: 'src-personal',
        parentId: 'src-t1',
        tags: [],
        order: 1000,
        today: false,
        status: 'open',
        createdAt: t0,
        updatedAt: t0
      },
      {
        id: 'src-t3',
        title: 'Into existing Work list',
        listId: 'src-work',
        parentId: undefined,
        tags: [],
        order: 2000,
        today: false,
        status: 'open',
        createdAt: t0,
        updatedAt: t0
      }
    ];

    let nextId = 0;
    const idGen = () => `new-${nextId++}`;
    const actions = importPlan(current, { tasks: importedTasks, lists: importedLists }, t0 + 5000, idGen);

    // Exactly one new list (Personal); Work matched by case-insensitive name.
    expect(actions.filter((a) => a.type === 'list/add')).toHaveLength(1);
    expect(actions.filter((a) => a.type === 'list/add')[0]).toMatchObject({ name: 'Personal' });

    // Three task/add actions, top-level(s) before the child.
    const adds = actions.filter((a) => a.type === 'task/add');
    expect(adds).toHaveLength(3);
    const childAddIndex = adds.findIndex((a) => a.type === 'task/add' && a.title === 'Imported child task');
    const parentAddIndex = adds.findIndex((a) => a.type === 'task/add' && a.title === 'Imported top task');
    expect(parentAddIndex).toBeLessThan(childAddIndex);

    // One task/complete, after every task/add, for the done task.
    const completeIndex = actions.findIndex((a) => a.type === 'task/complete');
    const lastAddIndex = actions.map((a) => a.type).lastIndexOf('task/add');
    expect(completeIndex).toBeGreaterThan(lastAddIndex);
    expect(actions[completeIndex]).toMatchObject({ by: 'user' });

    let next = current;
    for (const action of actions) next = reduce(next, action);

    expect(next.lists.length).toBe(current.lists.length + 1);
    const workList = next.lists.find((l) => l.name === 'Work')!;
    expect(workList.id).toBe('work'); // reused, not duplicated

    const importedTop = next.tasks.find((t) => t.title === 'Imported top task')!;
    const importedChild = next.tasks.find((t) => t.title === 'Imported child task')!;
    const importedIntoWork = next.tasks.find((t) => t.title === 'Into existing Work list')!;

    expect(importedTop.status).toBe('done');
    expect(importedChild.parentId).toBe(importedTop.id);
    expect(importedIntoWork.listId).toBe('work');

    // Existing data untouched.
    expect(next.tasks.some((t) => t.title === 'Ship the report')).toBe(true);
  });
});
