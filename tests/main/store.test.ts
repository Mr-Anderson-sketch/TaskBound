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
