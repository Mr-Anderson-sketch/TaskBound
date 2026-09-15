// core/export — pure JSON/Markdown export+import for a whole Data snapshot, plus the
// merge planner that turns an imported { tasks, lists } shape into Actions the reducer
// can apply. No Electron, no Node APIs, no Date.now(): every caller passes `now`, and
// every new id comes from an injected `idGen`. See CLAUDE.md and
// .superpowers/sdd/PLAN/task-5.3-brief.md.
import type { Action, Data, Due, Id, List, Task } from './types';
import { DataInvalidError, parseData } from './schema';
import { z } from 'zod';

// --- size guard -------------------------------------------------------------------

// 20 MB, checked against the UTF-8 byte length of the raw text — BEFORE any parsing
// is attempted — so a huge/malicious file can't force a large JSON.parse or run the
// line-by-line Markdown scan. `TextEncoder` is a universal JS global (not a `node:`
// import), so this stays legal inside core/.
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

export class ImportTooLargeError extends Error {
  bytes: number;
  constructor(bytes: number) {
    super(`Import is too large (${bytes.toLocaleString()} bytes; the limit is ${MAX_IMPORT_BYTES.toLocaleString()} bytes / 20 MB).`);
    this.name = 'ImportTooLargeError';
    this.bytes = bytes;
  }
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function assertImportSize(text: string): void {
  const bytes = byteLength(text);
  if (bytes > MAX_IMPORT_BYTES) throw new ImportTooLargeError(bytes);
}

function invalidJson(message: string): never {
  throw new DataInvalidError([{ code: z.ZodIssueCode.custom, path: [], message } as z.ZodIssue]);
}

// --- JSON --------------------------------------------------------------------------

/** Deep-clones `value`, sorting every plain object's keys alphabetically (arrays keep
 * their order). Gives `toJson` a stable, deterministic key order regardless of the
 * insertion order of the `Data` object handed in. */
function sortedClone(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedClone);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortedClone((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Pretty JSON (2-space indent), with every object's keys in stable alphabetical order. */
export function toJson(data: Data): string {
  return JSON.stringify(sortedClone(data), null, 2);
}

/** Parses and validates a JSON export. Throws `ImportTooLargeError` for input over
 * 20 MB (checked before parsing) and `DataInvalidError` for anything that isn't valid
 * JSON or doesn't pass `parseData`. */
export function fromJson(text: string): Data {
  assertImportSize(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    invalidJson('not valid JSON');
  }
  return parseData(parsed);
}

// --- Markdown ------------------------------------------------------------------------

function formatDue(due: Due): string {
  return due.time ? `(due ${due.date} ${due.time})` : `(due ${due.date})`;
}

function taskLine(task: Task, indent: 0 | 1): string {
  const checkbox = task.status === 'done' ? '[x]' : '[ ]';
  const prefix = indent === 0 ? '- ' : '  - ';
  let line = `${prefix}${checkbox} ${task.title}`;
  if (task.due) line += ` ${formatDue(task.due)}`;
  if (task.tags.length > 0) line += ' ' + task.tags.map((t) => `#${t}`).join(' ');
  return line;
}

/** '# List' headings (in list order) followed by '- [ ] title (due …) #tag' lines
 * ('- [x]' when done), with a task's children ('only top-level tasks may be parents' —
 * see reducer.ts, so exactly one level of nesting exists) indented '  - [ ] sub'
 * directly beneath it, in order. */
export function toMarkdown(data: Data): string {
  const lists = [...data.lists].sort((a, b) => a.order - b.order);
  const lines: string[] = [];

  for (const list of lists) {
    lines.push(`# ${list.name}`);
    const topTasks = data.tasks
      .filter((t) => t.listId === list.id && t.parentId === undefined)
      .sort((a, b) => a.order - b.order);
    for (const task of topTasks) {
      lines.push(taskLine(task, 0));
      const children = data.tasks
        .filter((t) => t.parentId === task.id)
        .sort((a, b) => a.order - b.order);
      for (const child of children) lines.push(taskLine(child, 1));
    }
    lines.push('');
  }

  return lines.join('\n').replace(/\n+$/, '\n');
}

const HEADING_RE = /^#\s+(.+?)\s*$/;
const TOP_TASK_RE = /^-\s\[([ xX])\]\s*(.*)$/;
const CHILD_TASK_RE = /^\s+-\s\[([ xX])\]\s*(.*)$/;
const DUE_RE = /\(due (\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?\)/;
const TAG_RE = /#(\S+)/g;

function parseTaskBody(body: string): { title: string; due?: Due; tags: string[] } {
  let work = body;
  let due: Due | undefined;
  const dueMatch = DUE_RE.exec(work);
  if (dueMatch) {
    due = dueMatch[2] ? { date: dueMatch[1], time: dueMatch[2] } : { date: dueMatch[1] };
    work = work.slice(0, dueMatch.index) + work.slice(dueMatch.index + dueMatch[0].length);
  }
  const tags: string[] = [];
  work = work.replace(TAG_RE, (_m, tag: string) => {
    tags.push(tag);
    return '';
  });
  return { title: work.replace(/\s+/g, ' ').trim(), due, tags };
}

/** Inverse of `toMarkdown`: round-trips titles, done state, due, tags, and hierarchy.
 * Every list/task gets a fresh id from `idGen`; a child task's `parentId` is the id
 * generated for the nearest preceding top-level task under the same heading. Any line
 * that isn't a recognised heading/task (blank lines, stray prose) is ignored. Throws
 * `ImportTooLargeError` for input over 20 MB (checked before scanning). */
export function fromMarkdown(text: string, now: number, idGen: () => Id): { tasks: Task[]; lists: List[] } {
  assertImportSize(text);

  const lists: List[] = [];
  const tasks: Task[] = [];

  let currentList: List | undefined;
  let currentTop: Task | undefined;
  let listOrder = 1000;
  let topOrder = 1000;
  let childOrder = 1000;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    if (line.trim() === '') continue;

    const heading = HEADING_RE.exec(line);
    if (heading) {
      currentList = { id: idGen(), name: heading[1].trim(), order: listOrder, createdAt: now };
      listOrder += 1000;
      lists.push(currentList);
      currentTop = undefined;
      topOrder = 1000;
      continue;
    }

    if (!currentList) continue; // task line before any heading: no list to attach to

    const childMatch = CHILD_TASK_RE.exec(line);
    if (childMatch && currentTop) {
      const { title, due, tags } = parseTaskBody(childMatch[2]);
      if (title === '') continue;
      tasks.push({
        id: idGen(),
        title,
        listId: currentList.id,
        parentId: currentTop.id,
        tags,
        order: childOrder,
        today: false,
        due,
        status: /x/i.test(childMatch[1]) ? 'done' : 'open',
        createdAt: now,
        updatedAt: now
      });
      childOrder += 1000;
      continue;
    }

    const topMatch = TOP_TASK_RE.exec(line);
    if (topMatch) {
      const { title, due, tags } = parseTaskBody(topMatch[2]);
      if (title === '') continue;
      const task: Task = {
        id: idGen(),
        title,
        listId: currentList.id,
        parentId: undefined,
        tags,
        order: topOrder,
        today: false,
        due,
        status: /x/i.test(topMatch[1]) ? 'done' : 'open',
        createdAt: now,
        updatedAt: now
      };
      topOrder += 1000;
      childOrder = 1000;
      currentTop = task;
      tasks.push(task);
    }
  }

  return { tasks, lists };
}

// --- merge import -------------------------------------------------------------------

/**
 * Merges an imported `{ tasks, lists }` (from `fromMarkdown`, or `fromJson(text)` —
 * whose `Data.tasks`/`Data.lists` are already this exact shape) into `current` as a
 * sequence of Actions the reducer can apply, one at a time, in order:
 *  1. Each imported list is matched against `current.lists` by case-insensitive name;
 *     a match reuses that list's real id, otherwise a `list/add` with a fresh id is
 *     emitted.
 *  2. Every imported task becomes a `task/add` with a fresh id — top-level tasks
 *     first, then children (so a child's `parentId` can always be resolved to its
 *     parent's freshly-assigned real id; `task/add` never accepts `status`, so every
 *     added task starts open regardless of the source).
 *  3. Every task whose imported `status` was 'done' gets a trailing `task/complete`
 *     (`by: 'user'`), after every `task/add` above.
 */
export function importPlan(current: Data, imported: { tasks: Task[]; lists: List[] }, now: number, idGen: () => Id): Action[] {
  const actions: Action[] = [];

  const listIdMap = new Map<Id, Id>();
  for (const list of imported.lists) {
    const name = list.name.trim().toLowerCase();
    const existing = current.lists.find((l) => l.name.trim().toLowerCase() === name);
    if (existing) {
      listIdMap.set(list.id, existing.id);
    } else {
      const newId = idGen();
      listIdMap.set(list.id, newId);
      actions.push({ type: 'list/add', id: newId, now, name: list.name });
    }
  }

  const fallbackListId = current.lists[0]?.id;
  const taskIdMap = new Map<Id, Id>();
  const doneOldIds: Id[] = [];

  const addTask = (task: Task, parentId: Id | undefined): void => {
    const newId = idGen();
    taskIdMap.set(task.id, newId);
    actions.push({
      type: 'task/add',
      id: newId,
      now,
      title: task.title,
      listId: listIdMap.get(task.listId) ?? fallbackListId,
      parentId,
      tags: task.tags,
      due: task.due
    });
    if (task.status === 'done') doneOldIds.push(task.id);
  };

  for (const task of imported.tasks) {
    if (task.parentId === undefined) addTask(task, undefined);
  }
  for (const task of imported.tasks) {
    if (task.parentId !== undefined) addTask(task, taskIdMap.get(task.parentId));
  }

  for (const oldId of doneOldIds) {
    actions.push({ type: 'task/complete', id: taskIdMap.get(oldId)!, now, by: 'user' });
  }

  return actions;
}
