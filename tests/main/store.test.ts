import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Store } from '../../src/main/store';
import { createEmptyData } from '../../src/core/defaults';
import type { Data } from '../../src/core/types';

const APP_VERSION = '2.0.0';

function makeStore(now: () => number = () => 1000) {
  const save = vi.fn(async (_d: Data) => {});
  const data = createEmptyData(now(), APP_VERSION);
  const store = new Store(data, {
    save,
    now,
    appVersion: APP_VERSION,
    platform: 'win32',
    systemDark: () => false
  });
  return { store, save };
}

describe('Store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces three rapid dispatches into a single save', async () => {
    const { store, save } = makeStore();

    store.dispatch({ type: 'task/add', id: 'a', now: 1000, title: 'One' });
    store.dispatch({ type: 'task/add', id: 'b', now: 1000, title: 'Two' });
    store.dispatch({ type: 'task/add', id: 'c', now: 1000, title: 'Three' });

    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(250);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].tasks).toHaveLength(3);
  });

  it('bumps rev only when the dispatched action actually changes the data', () => {
    const { store } = makeStore();
    const rev0 = store.get().rev;

    const rev1 = store.dispatch({ type: 'task/add', id: 'a', now: 1000, title: 'One' });
    expect(rev1).toBe(rev0 + 1);

    // task/edit is not implemented yet (Task 4.3) — the reducer is a documented no-op
    // for it, so the Data reference is unchanged and rev must not move.
    const rev2 = store.dispatch({ type: 'task/edit', id: 'a', now: 1000, patch: { title: 'Uno' } });
    expect(rev2).toBe(rev1);
  });

  it('undo restores the previous data and returns the action label', () => {
    const { store } = makeStore();
    store.dispatch({ type: 'task/add', id: 'a', now: 1000, title: 'One' });
    expect(store.get().data.tasks).toHaveLength(1);

    const label = store.undo();

    expect(label).toBe('Added "One"');
    expect(store.get().data.tasks).toHaveLength(0);
    expect(store.get().canUndo).toBe(false);
    expect(store.get().canRedo).toBe(true);
  });

  it('redo re-applies an undone action', () => {
    const { store } = makeStore();
    store.dispatch({ type: 'task/add', id: 'a', now: 1000, title: 'One' });
    store.undo();

    const label = store.redo();

    expect(label).toBe('Added "One"');
    expect(store.get().data.tasks).toHaveLength(1);
    expect(store.get().canRedo).toBe(false);
  });

  it('undo/redo on an empty stack returns undefined and does not throw', () => {
    const { store } = makeStore();
    expect(store.undo()).toBeUndefined();
    expect(store.redo()).toBeUndefined();
  });

  it('a no-op dispatch of an undoable action type does not clear redo or bump rev', () => {
    const { store } = makeStore();
    store.dispatch({ type: 'task/add', id: 'a', now: 1000, title: 'One' });
    store.undo();
    expect(store.get().canRedo).toBe(true);
    const revBefore = store.get().rev;

    // task/edit is undoable (UNDOABLE.has('task/edit')) but its reducer is a no-op
    // (unimplemented until Task 4.3): no task 'zzz' exists, and the patch is empty.
    // Before the fix, dispatch() pushed to the undo stack BEFORE reducing, so this
    // call would clear the redo stack and leave a dead undo entry despite nothing
    // changing.
    const rev = store.dispatch({ type: 'task/edit', id: 'zzz', now: 1000, patch: {} });

    expect(rev).toBe(revBefore);
    expect(store.get().rev).toBe(revBefore);
    expect(store.get().canRedo).toBe(true);
  });

  it('notifies subscribers synchronously with the fresh snapshot, until unsubscribed', () => {
    const { store } = makeStore();
    const cb = vi.fn();
    const unsubscribe = store.subscribe(cb);

    store.dispatch({ type: 'task/add', id: 'a', now: 1000, title: 'One' });

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].rev).toBe(1);
    expect(cb.mock.calls[0][0].data.tasks).toHaveLength(1);

    unsubscribe();
    store.dispatch({ type: 'task/add', id: 'b', now: 1000, title: 'Two' });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('flush() awaits a debounced save that has not fired yet', async () => {
    const { store, save } = makeStore();
    store.dispatch({ type: 'task/add', id: 'a', now: 1000, title: 'One' });

    expect(save).not.toHaveBeenCalled();
    await store.flush();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('flush() awaits a save already in flight', async () => {
    const { store, save } = makeStore();
    store.dispatch({ type: 'task/add', id: 'a', now: 1000, title: 'One' });

    await vi.advanceTimersByTimeAsync(250);
    expect(save).toHaveBeenCalledTimes(1);

    await store.flush();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('serialises debounced saves — a later save waits for an earlier in-flight one, and flush() awaits the whole chain', async () => {
    const events: string[] = [];
    const resolvers: Array<() => void> = [];
    const save = vi.fn(() => {
      const index = resolvers.length;
      events.push(`start:${index}`);
      return new Promise<void>((resolve) => {
        resolvers.push(() => {
          events.push(`end:${index}`);
          resolve();
        });
      });
    });
    const data = createEmptyData(1000, APP_VERSION);
    const store = new Store(data, {
      save,
      now: () => 1000,
      appVersion: APP_VERSION,
      platform: 'win32',
      systemDark: () => false
    });

    // First debounce window: save 0 starts and does not resolve.
    store.dispatch({ type: 'task/add', id: 'a', now: 1000, title: 'One' });
    await vi.advanceTimersByTimeAsync(250);
    expect(save).toHaveBeenCalledTimes(1);

    // Second debounce window elapses while save 0 is still in flight. The second
    // save must NOT start yet (no concurrent `deps.save` calls).
    store.dispatch({ type: 'task/add', id: 'b', now: 1000, title: 'Two' });
    await vi.advanceTimersByTimeAsync(250);
    expect(save).toHaveBeenCalledTimes(1);

    let flushed = false;
    const flushPromise = store.flush().then(() => {
      flushed = true;
    });

    // Give the chain a few microtask ticks: still nothing to do until save 0 resolves.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(flushed).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);

    // Resolve save 0: save 1 should start (serially), but flush() still must not
    // resolve until save 1 also finishes.
    resolvers[0]();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(2);
    expect(flushed).toBe(false);

    resolvers[1]();
    await flushPromise;

    expect(flushed).toBe(true);
    expect(events).toEqual(['start:0', 'end:0', 'start:1', 'end:1']);
  });

  it('replace() cancels a pending debounced save timer so it cannot fire afterwards', async () => {
    const { store, save } = makeStore();
    store.dispatch({ type: 'task/add', id: 'a', now: 1000, title: 'One' });

    store.replace(createEmptyData(2000, APP_VERSION));

    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();
  });

  it('replace() resets the undo stack, bumps rev, notifies, and does not save', () => {
    const { store, save } = makeStore();
    store.dispatch({ type: 'task/add', id: 'a', now: 1000, title: 'One' });
    const revBefore = store.get().rev;
    expect(store.get().canUndo).toBe(true);

    const cb = vi.fn();
    store.subscribe(cb);

    const fresh = createEmptyData(2000, APP_VERSION);
    store.replace(fresh);

    expect(store.get().data).toBe(fresh);
    expect(store.get().rev).toBe(revBefore + 1);
    expect(store.get().canUndo).toBe(false);
    expect(store.get().canRedo).toBe(false);
    expect(cb).toHaveBeenCalledTimes(1);
    // replace() must not itself trigger a save.
    expect(save).not.toHaveBeenCalled();
  });

  it('get() reflects the systemDark and platform deps and default capabilities', () => {
    const save = vi.fn(async () => {});
    const data = createEmptyData(1000, APP_VERSION);
    const store = new Store(data, {
      save,
      now: () => 1000,
      appVersion: APP_VERSION,
      platform: 'darwin',
      systemDark: () => true
    });

    const snap = store.get();
    expect(snap.platform).toBe('darwin');
    expect(snap.systemDark).toBe(true);
    expect(snap.capabilities).toEqual({ appBar: false, fullscreenDetect: false });
  });
});
