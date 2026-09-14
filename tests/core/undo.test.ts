import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { UndoStack, UNDOABLE, labelFor } from '../../src/core/undo';
import { reduce } from '../../src/core/reducer';
import { createEmptyData } from '../../src/core/defaults';
import type { Action, Data } from '../../src/core/types';

const t0 = 1_700_000_000_000;

describe('UndoStack', () => {
  it('undo/redo round-trip a single push', () => {
    const stack = new UndoStack();
    let d = createEmptyData(t0, '2.0.0');
    const before = d;
    stack.push(before, 'Added "A"');
    d = reduce(d, { type: 'task/add', id: 'a', now: t0, title: 'A' });

    expect(stack.canUndo).toBe(true);
    expect(stack.canRedo).toBe(false);

    const undone = stack.undo(d);
    expect(undone).toEqual({ data: before, label: 'Added "A"' });
    expect(stack.canUndo).toBe(false);
    expect(stack.canRedo).toBe(true);

    const redone = stack.redo(before);
    expect(redone).toEqual({ data: d, label: 'Added "A"' });
    expect(stack.canUndo).toBe(true);
    expect(stack.canRedo).toBe(false);
  });

  it('undo/redo return undefined when there is nothing to do', () => {
    const stack = new UndoStack();
    const d = createEmptyData(t0, '2.0.0');
    expect(stack.undo(d)).toBeUndefined();
    expect(stack.redo(d)).toBeUndefined();
  });

  it('push clears the redo stack', () => {
    const stack = new UndoStack();
    let d = createEmptyData(t0, '2.0.0');
    stack.push(d, 'Added "A"');
    d = reduce(d, { type: 'task/add', id: 'a', now: t0, title: 'A' });
    stack.undo(d);
    expect(stack.canRedo).toBe(true);

    stack.push(d, 'Added "B"');
    expect(stack.canRedo).toBe(false);
  });

  it('drops the oldest entry once the ring exceeds its limit', () => {
    const stack = new UndoStack();
    let d = createEmptyData(t0, '2.0.0');
    for (let i = 0; i < 60; i++) {
      stack.push(d, `entry ${i}`);
      d = reduce(d, { type: 'task/add', id: `t${i}`, now: t0 + i, title: `T${i}` });
    }
    let undone = 0;
    while (stack.canUndo) {
      const result = stack.undo(d);
      d = result!.data;
      undone++;
    }
    expect(undone).toBe(50);
    expect(stack.canUndo).toBe(false);
  });
});

describe('labelFor', () => {
  it('task/add uses the action title, not a lookup', () => {
    const d = createEmptyData(t0, '2.0.0');
    expect(labelFor({ type: 'task/add', id: 'a', now: t0, title: 'Email update' }, d)).toBe('Added "Email update"');
  });

  it('task/complete looks the title up in data.tasks', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = reduce(d, { type: 'task/add', id: 'a', now: t0, title: 'Email update' });
    expect(labelFor({ type: 'task/complete', id: 'a', now: t0, by: 'user' }, d)).toBe('Completed "Email update"');
  });

  it('task/delete looks the title up in data.tasks', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = reduce(d, { type: 'task/add', id: 'a', now: t0, title: 'Old task' });
    expect(labelFor({ type: 'task/delete', id: 'a', now: t0 }, d)).toBe('Deleted "Old task"');
  });

  it('task/uncomplete looks the title up in data.tasks', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = reduce(d, { type: 'task/add', id: 'a', now: t0, title: 'Chore' });
    expect(labelFor({ type: 'task/uncomplete', id: 'a', now: t0 }, d)).toBe('Reopened "Chore"');
  });

  it('task/makeCurrent looks the title up in data.tasks', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = reduce(d, { type: 'task/add', id: 'a', now: t0, title: 'Focus item' });
    expect(labelFor({ type: 'task/makeCurrent', id: 'a', now: t0 }, d)).toBe('Made "Focus item" current');
  });

  it('falls back to a title-less noun when the task is missing', () => {
    const d = createEmptyData(t0, '2.0.0');
    expect(labelFor({ type: 'task/delete', id: 'missing', now: t0 }, d)).toBe('Deleted task');
    expect(labelFor({ type: 'task/complete', id: 'missing', now: t0, by: 'user' }, d)).toBe('Completed task');
  });

  it('setToday, list, and day actions use fixed copy', () => {
    const d = createEmptyData(t0, '2.0.0');
    expect(labelFor({ type: 'task/setToday', ids: ['a'], now: t0, today: true }, d)).toBe('Updated today list');
    expect(labelFor({ type: 'list/add', id: 'l1', now: t0, name: 'Work' }, d)).toBe('Added list "Work"');
    expect(labelFor({ type: 'list/rename', id: 'l1', now: t0, name: 'Renamed' }, d)).toBe('Renamed list');
    expect(labelFor({ type: 'list/delete', id: 'l1', now: t0, moveTasksTo: 'inbox' }, d)).toBe('Deleted list');
    expect(labelFor({ type: 'day/close', now: t0, date: '2026-09-14' }, d)).toBe('Closed the day');
  });

  it('truncates titles longer than 40 characters with an ellipsis', () => {
    const longTitle = 'x'.repeat(50);
    const d = createEmptyData(t0, '2.0.0');
    const label = labelFor({ type: 'task/add', id: 'a', now: t0, title: longTitle }, d);
    expect(label).toBe(`Added "${'x'.repeat(40)}…"`);
  });

  it('leaves an exactly-40-character title untouched, and truncates a 41-character one', () => {
    const d = createEmptyData(t0, '2.0.0');
    const title40 = 'x'.repeat(40);
    const title41 = 'x'.repeat(41);
    expect(labelFor({ type: 'task/add', id: 'a', now: t0, title: title40 }, d)).toBe(`Added "${title40}"`);
    expect(labelFor({ type: 'task/add', id: 'a', now: t0, title: title41 }, d)).toBe(`Added "${'x'.repeat(40)}…"`);
  });

  it('renders an empty-string title as "" rather than falling back to the title-less noun', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = reduce(d, { type: 'task/add', id: 'a', now: t0, title: '' });
    expect(labelFor({ type: 'task/complete', id: 'a', now: t0, by: 'user' }, d)).toBe('Completed ""');
  });
});

// --- Property test -------------------------------------------------------
// Simulates what the store does around every undoable action: push(state,
// label) BEFORE reducing, then state = reduce(state, action). Duplicate ids
// in task/add are allowed through: the reducer just adds another task with
// that id (it has no uniqueness constraint), so the simulation doesn't need
// to filter them for the round-trip property to hold.

interface AddAction {
  kind: 'add';
  id: string;
  title: string;
}
interface CompleteAction {
  kind: 'complete';
}
interface DeleteAction {
  kind: 'delete';
}

type Step = (AddAction | CompleteAction | DeleteAction) & { id: string };

const idArb = fc.constantFrom('a', 'b', 'c', 'd');
const titleArb = fc.string({ minLength: 1, maxLength: 20 });

const stepArb: fc.Arbitrary<{ id: string; kind: 'add' | 'complete' | 'delete'; title?: string }> = fc.oneof(
  fc.record({ kind: fc.constant('add' as const), id: idArb, title: titleArb }),
  fc.record({ kind: fc.constant('complete' as const), id: idArb }),
  fc.record({ kind: fc.constant('delete' as const), id: idArb })
);

function toAction(step: { id: string; kind: 'add' | 'complete' | 'delete'; title?: string }, now: number): Action {
  switch (step.kind) {
    case 'add':
      return { type: 'task/add', id: step.id, now, title: step.title ?? '' };
    case 'complete':
      return { type: 'task/complete', id: step.id, now, by: 'user' };
    case 'delete':
      return { type: 'task/delete', id: step.id, now };
  }
}

describe('UndoStack property: undo/redo round-trip', () => {
  it('undoing all the way back reaches the start, redoing all the way forward reaches the end', () => {
    fc.assert(
      fc.property(fc.array(stepArb, { maxLength: 20 }), (steps) => {
        const start = createEmptyData(t0, '2.0.0');
        const stack = new UndoStack();
        let state: Data = start;
        let now = t0;

        for (const step of steps) {
          now += 1;
          const action = toAction(step, now);
          expect(UNDOABLE.has(action.type)).toBe(true);
          stack.push(state, labelFor(action, state));
          state = reduce(state, action);
        }

        const end = state;

        // Undo all the way back to the start.
        let cur = state;
        while (stack.canUndo) {
          const result = stack.undo(cur)!;
          cur = result.data;
        }
        expect(cur).toEqual(start);
        expect(stack.canUndo).toBe(false);

        // Redo all the way forward to the end.
        while (stack.canRedo) {
          const result = stack.redo(cur)!;
          cur = result.data;
        }
        expect(cur).toEqual(end);
        expect(stack.canRedo).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('the ring never exceeds 50 entries: after 60 pushes exactly 50 undos are available', () => {
    fc.assert(
      fc.property(fc.array(stepArb, { minLength: 60, maxLength: 60 }), (steps) => {
        const stack = new UndoStack();
        let state: Data = createEmptyData(t0, '2.0.0');
        let now = t0;

        for (const step of steps) {
          now += 1;
          const action = toAction(step, now);
          stack.push(state, labelFor(action, state));
          state = reduce(state, action);
        }

        let undone = 0;
        let cur = state;
        while (stack.canUndo) {
          const result = stack.undo(cur)!;
          cur = result.data;
          undone++;
        }
        expect(undone).toBe(50);
      }),
      { numRuns: 100 }
    );
  });
});
