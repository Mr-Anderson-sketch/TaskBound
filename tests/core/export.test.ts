import { describe, it, expect } from 'vitest';
import { toJson, fromJson, toMarkdown, fromMarkdown, importPlan, validateImportActions, validateImportCapacity, ImportTooLargeError } from '../../src/core/export';
import { DataInvalidError, MAX_TASKS } from '../../src/core/schema';
import { reduce } from '../../src/core/reducer';
import { createEmptyData } from '../../src/core/defaults';
import type { Action, Data, Task } from '../../src/core/types';

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
    expect(actions[completeIndex]).toMatchObject({ by: 'import' });

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

describe('fromMarkdown clamps fields that would otherwise fail persistence-time validation', () => {
  let nextId = 0;
  const idGen = () => `clamp-${nextId++}`;

  it('truncates an over-long title to 200 characters', () => {
    const longTitle = 'x'.repeat(500);
    const md = `# List\n- [ ] ${longTitle}\n`;

    const { tasks } = fromMarkdown(md, t0, idGen);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].title.length).toBe(200);
    expect(tasks[0].title).toBe('x'.repeat(200));
  });

  it('drops tags over 40 characters but keeps shorter ones, and keeps at most 20 tags', () => {
    const overLong = 'y'.repeat(41);
    const many = Array.from({ length: 25 }, (_, i) => `#tag${i}`).join(' ');
    const md = `# List\n- [ ] Task #${overLong} #short ${many}\n`;

    const { tasks } = fromMarkdown(md, t0, idGen);

    expect(tasks).toHaveLength(1);
    const tags = tasks[0].tags;
    expect(tags).not.toContain(overLong);
    expect(tags).toContain('short');
    expect(tags.length).toBeLessThanOrEqual(20);
    // Every kept tag individually satisfies the same bound schema.ts enforces.
    expect(tags.every((t) => t.length <= 40)).toBe(true);
  });

  it('a clamped import passes validateImportActions and importPlan cleanly (no downstream validation failure)', () => {
    const longTitle = 'z'.repeat(500);
    const many = Array.from({ length: 30 }, (_, i) => `#t${i}`).join(' ');
    const md = `# Clamped List\n- [ ] ${longTitle} ${many}\n`;
    const { tasks, lists } = fromMarkdown(md, t0, idGen);

    const current = createEmptyData(t0, APP_VERSION);
    const actions = importPlan(current, { tasks, lists }, t0, idGen);

    expect(validateImportActions(actions)).toBeUndefined();
  });
});

describe('validateImportActions', () => {
  it('returns undefined when every action is valid', () => {
    const actions: Action[] = [
      { type: 'list/add', id: 'l1', now: t0, name: 'A list' },
      { type: 'task/add', id: 't1', now: t0, title: 'Valid title', listId: 'l1', tags: ['ok'] },
      { type: 'task/complete', id: 't1', now: t0, by: 'user' }
    ];
    expect(validateImportActions(actions)).toBeUndefined();
  });

  it('returns a clear error message and stops at the first invalid action (title over 200 chars)', () => {
    const actions: Action[] = [
      { type: 'list/add', id: 'l1', now: t0, name: 'A list' },
      { type: 'task/add', id: 't1', now: t0, title: 'x'.repeat(201), listId: 'l1' }
    ];
    const error = validateImportActions(actions);
    expect(error).toBeDefined();
    expect(error).toContain('task/add');
  });

  it('catches an invalid list/add (empty name)', () => {
    const actions: Action[] = [{ type: 'list/add', id: 'l1', now: t0, name: '' }];
    const error = validateImportActions(actions);
    expect(error).toBeDefined();
    expect(error).toContain('list/add');
  });

  it('catches too many tags (> 20) even though each individual tag is short', () => {
    const actions: Action[] = [
      {
        type: 'task/add',
        id: 't1',
        now: t0,
        title: 'Valid title',
        tags: Array.from({ length: 21 }, (_, i) => `t${i}`)
      }
    ];
    expect(validateImportActions(actions)).toBeDefined();
  });
});

// Final-review fix 7: imported completions are not user completions.
describe('importPlan: imported done tasks do not count as completions', () => {
  it('leaves the score and the day completed count unchanged', () => {
    let current = createEmptyData(t0, APP_VERSION);
    current = reduce(current, { type: 'settings/patch', now: t0, patch: { score: { enabled: true } } });
    const md = '# Inbox\n- [x] Old done task\n- [x] Another\n- [ ] Open one\n';
    let n = 0;
    const { tasks, lists } = fromMarkdown(md, t0, () => `m${n++}`);
    let next = current;
    for (const action of importPlan(current, { tasks, lists }, t0, () => `i${n++}`)) next = reduce(next, action);
    expect(next.tasks.filter((t) => t.status === 'done')).toHaveLength(2);
    expect(next.settings.score.value).toBe(0);
    expect(next.days.reduce((sum, r) => sum + r.completed, 0)).toBe(0);
  });
});

// Final-review fix 2: an import that would push the task count past MAX_TASKS is
// rejected up front with a clear message, before anything is dispatched.
describe('validateImportCapacity', () => {
  function withTasks(n: number): Data {
    const d = createEmptyData(t0, APP_VERSION);
    const tasks: Task[] = Array.from({ length: n }, (_, i) => ({
      id: `t${i}`, title: 'T', listId: 'inbox', tags: [], order: i, today: false, status: 'open', createdAt: t0, updatedAt: t0
    }));
    return { ...d, tasks };
  }
  const adds = (k: number): Action[] => Array.from({ length: k }, (_, i) => ({ type: 'task/add', id: `n${i}`, now: t0, title: 'N' }));
  it('accepts an import that lands exactly on the cap', () => {
    expect(validateImportCapacity(withTasks(MAX_TASKS - 2), adds(2))).toBeUndefined();
  });
  it('rejects an import that would exceed the cap, naming the limit', () => {
    const msg = validateImportCapacity(withTasks(MAX_TASKS - 1), adds(2));
    expect(msg).toMatch(/100,000/);
    expect(msg).toMatch(/2 tasks/);
  });
});
