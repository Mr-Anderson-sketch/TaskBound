// Final-review fix 4: undo is a REPLAY, not a snapshot restore. Undoing the newest
// undoable action U rebuilds `before(U)` plus every non-undoable data-changing action
// dispatched after U (timers, settings, rollover) — so undoing a completion never rolls
// back timer time or a settings change made afterwards.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Store } from '../../src/main/store';
import { createEmptyData } from '../../src/core/defaults';
import { ymd } from '../../src/core/dates';
import { UNDO_AFTER_LIMIT } from '../../src/core/undo';
import type { Data } from '../../src/core/types';

const APP_VERSION = '2.0.0';
const T = new Date(2026, 8, 14, 10, 0, 0).getTime();

function makeStore(): Store {
  return new Store(createEmptyData(T, APP_VERSION), {
    save: vi.fn(async (_d: Data) => {}),
    now: () => T,
    appVersion: APP_VERSION,
    platform: 'win32',
    systemDark: () => false
  });
}

function task(store: Store, id: string) {
  return store.get().data.tasks.find((t) => t.id === id)!;
}

describe('Store undo replay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function seeded(): Store {
    const store = makeStore();
    store.dispatch({ type: 'task/add', id: 'a', now: T, title: 'A', today: true });
    store.dispatch({ type: 'task/add', id: 'b', now: T, title: 'B', today: true });
    return store;
  }

  it('undoing a completion keeps a later timer session on another task, and the day focus seconds', () => {
    const store = seeded();
    store.dispatch({ type: 'task/complete', id: 'a', now: T + 1_000, by: 'user' });
    store.dispatch({ type: 'timer/start', id: 'b', now: T + 2_000 });
    store.dispatch({ type: 'timer/pause', id: 'b', now: T + 2_000 + 600_000 });
    expect(task(store, 'b').timer?.spentSeconds).toBe(600);

    expect(store.undo()).toBe('Completed "A"');

    expect(task(store, 'a').status).toBe('open');
    expect(task(store, 'b').timer?.spentSeconds).toBe(600);
    expect(store.get().data.days.find((d) => d.date === ymd(T))?.focusSeconds).toBe(600);
    expect(store.get().data.days.find((d) => d.date === ymd(T))?.completed).toBe(0);
  });

  it('a settings change made after an undoable action survives its undo', () => {
    const store = seeded();
    store.dispatch({ type: 'task/complete', id: 'a', now: T + 1_000, by: 'user' });
    store.dispatch({ type: 'settings/patch', now: T + 2_000, patch: { textSize: 'L' } });

    store.undo();

    expect(task(store, 'a').status).toBe('open');
    expect(store.get().data.settings.textSize).toBe('L');
  });

  it('redo re-applies the completion on top of the current data', () => {
    const store = seeded();
    store.dispatch({ type: 'task/complete', id: 'a', now: T + 1_000, by: 'user' });
    store.dispatch({ type: 'timer/start', id: 'b', now: T + 2_000 });
    store.dispatch({ type: 'timer/pause', id: 'b', now: T + 62_000 });
    store.undo();

    expect(store.redo()).toBe('Completed "A"');

    expect(task(store, 'a').status).toBe('done');
    expect(task(store, 'b').timer?.spentSeconds).toBe(60);
    expect(store.get().canUndo).toBe(true);
    expect(store.get().canRedo).toBe(false);
  });

  it('non-undoable actions after an undone entry carry back to the previous one', () => {
    const store = makeStore();
    store.dispatch({ type: 'task/add', id: 'a', now: T, title: 'A' });
    store.dispatch({ type: 'task/add', id: 'b', now: T, title: 'B' });
    store.dispatch({ type: 'settings/patch', now: T, patch: { textSize: 'S' } });

    store.undo(); // removes B, keeps textSize S
    store.undo(); // removes A, still keeps textSize S

    expect(store.get().data.tasks).toHaveLength(0);
    expect(store.get().data.settings.textSize).toBe('S');
  });

  it('a new undoable dispatch after an undo clears redo', () => {
    const store = seeded();
    store.dispatch({ type: 'task/complete', id: 'a', now: T + 1_000, by: 'user' });
    store.undo();
    store.dispatch({ type: 'task/complete', id: 'b', now: T + 2_000, by: 'user' });
    expect(store.get().canRedo).toBe(false);
  });

  it('clears the whole undo/redo history rather than grow past the non-undoable replay limit', () => {
    const store = seeded();
    store.dispatch({ type: 'task/complete', id: 'a', now: T + 1_000, by: 'user' });
    store.dispatch({ type: 'task/complete', id: 'b', now: T + 1_000, by: 'user' });
    store.undo();
    expect(store.get().canUndo).toBe(true);
    expect(store.get().canRedo).toBe(true);

    for (let i = 0; i < UNDO_AFTER_LIMIT; i++) {
      store.dispatch({ type: 'settings/patch', now: T, patch: { textSize: i % 2 === 0 ? 'L' : 'S' } });
    }
    expect(store.get().canUndo).toBe(true);

    store.dispatch({ type: 'settings/patch', now: T, patch: { textSize: 'M' } });
    expect(store.get().canUndo).toBe(false);
    expect(store.get().canRedo).toBe(false);
    expect(store.undo()).toBeUndefined();
    expect(store.get().data.settings.textSize).toBe('M');
  });
});
