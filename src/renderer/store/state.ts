import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import type { Point, ThemeName } from '../../shared/types';
import type { AppState } from '../../shared/types';
import { createEmptyState, isDone, normalizeState } from '../../shared/stateHelpers';
import { native } from '../native';
import { reducer, tickDelta, type AppAction } from './reducer';

export { reducer, tickDelta, MAX_TICK_GAP_MS } from './reducer';
export type { AppAction } from './reducer';

const APP_VERSION = '1.2.0';
export interface AppStore {
  state: AppState;
  hydrated: boolean;
  loadFailed: boolean;
  addTask: (title: string, seconds?: number) => void;
  completeActiveTask: () => void;
  addTime: (taskId: string, seconds: number) => void;
  reopenWithTime: (taskId: string, seconds: number) => void;
  updateTask: (taskId: string, title: string, seconds?: number) => void;
  deleteTasks: (taskIds: string[]) => void;
  clearFinished: () => void;
  reorderTasks: (orderedTaskIds: string[]) => void;
  dispatchTick: (timestamp?: number) => void;
  setAlwaysOnTop: (value: boolean) => Promise<void>;
  setTheme: (theme: ThemeName) => void;
  setMenuBarTimer: (value: boolean) => void;
  setFocusPosition: (theme: ThemeName, position: Point | null) => void;
  pauseTask: (taskId: string) => void;
  resumeTask: (taskId: string) => void;
}

const NOT_PERSISTED: ReadonlySet<AppAction['type']> = new Set(['tick', 'hydrate', 'syncMeta']);

export const useAppStore = (): AppStore => {
  const [state, dispatch] = useReducer(reducer, undefined, () => createEmptyState(APP_VERSION));
  const [hydrated, setHydrated] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const stateRef = useRef(state);
  const pendingPersistRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTickRef = useRef<number | null>(null);
  const carryRef = useRef(0);

  stateRef.current = state;

  useEffect(() => {
    let mounted = true;
    native
      .loadState()
      .then((loaded) => {
        if (!mounted) {
          return;
        }
        dispatch({ type: 'hydrate', payload: normalizeState(loaded, APP_VERSION) });
        lastTickRef.current = Date.now();
        setHydrated(true);
      })
      .catch((error) => {
        // Never save over the user's file if we could not read it.
        console.error('Failed to load state', error);
        setLoadFailed(true);
        setHydrated(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated || loadFailed || !pendingPersistRef.current) {
      return;
    }
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      pendingPersistRef.current = false;
      native
        .saveState(stateRef.current)
        .then((saved) => {
          dispatch({ type: 'syncMeta', payload: { lastSavedAt: saved.meta.lastSavedAt, appVersion: saved.meta.appVersion } });
        })
        .catch((error: unknown) => console.error('Failed to save state', error));
    }, 200);
  }, [state, hydrated, loadFailed]);

  const run = useCallback((action: AppAction) => {
    dispatch(action);
    if (!NOT_PERSISTED.has(action.type)) {
      pendingPersistRef.current = true;
    }
  }, []);

  const dispatchTick = useCallback((timestamp?: number) => {
    const nowMs = typeof timestamp === 'number' ? timestamp : Date.now();
    const previous = lastTickRef.current;
    lastTickRef.current = nowMs;
    if (previous === null) {
      carryRef.current = 0;
      return;
    }
    const { elapsed, carry } = tickDelta(previous, nowMs, carryRef.current);
    carryRef.current = carry;
    if (elapsed <= 0) {
      return;
    }
    const before = stateRef.current;
    for (let i = 1; i <= elapsed; i += 1) {
      dispatch({ type: 'tick', now: new Date(previous + i * 1000).toISOString() });
    }
    // Completions caused by the timer must reach disk even though ticks themselves are not saved.
    const activeBefore = before.tasks.find((task) => !isDone(task));
    if (activeBefore && typeof activeBefore.remainingSeconds === 'number' && activeBefore.remainingSeconds <= elapsed && !activeBefore.isPaused) {
      pendingPersistRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | null = null;
    native.onTimerTick((timestamp) => dispatchTick(timestamp)).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlisten = fn;
      }
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [hydrated, dispatchTick]);

  const nowIso = () => new Date().toISOString();

  return {
    state,
    hydrated,
    loadFailed,
    dispatchTick,
    addTask: useCallback((title, seconds) => run({ type: 'addTask', payload: { id: uuid(), title, seconds, now: nowIso() } }), [run]),
    completeActiveTask: useCallback(() => run({ type: 'manualComplete', now: nowIso() }), [run]),
    addTime: useCallback((taskId, seconds) => run({ type: 'addTime', payload: { taskId, seconds, now: nowIso() } }), [run]),
    reopenWithTime: useCallback(
      (taskId, seconds) => run({ type: 'reopenWithTime', payload: { taskId, seconds, now: nowIso() } }),
      [run]
    ),
    updateTask: useCallback(
      (taskId, title, seconds) => run({ type: 'updateTask', payload: { taskId, title, seconds, now: nowIso() } }),
      [run]
    ),
    deleteTasks: useCallback((taskIds) => run({ type: 'deleteTasks', payload: { taskIds, now: nowIso() } }), [run]),
    clearFinished: useCallback(() => run({ type: 'clearFinished', now: nowIso() }), [run]),
    reorderTasks: useCallback(
      (orderedTaskIds) => run({ type: 'reorderTasks', payload: { orderedTaskIds, now: nowIso() } }),
      [run]
    ),
    setAlwaysOnTop: useCallback(
      async (value: boolean) => {
        try {
          await native.setAlwaysOnTop(value);
        } catch (error) {
          console.error('Failed to set always on top', error);
        }
        run({ type: 'setAlwaysOnTop', payload: { value } });
      },
      [run]
    ),
    setTheme: useCallback((theme) => run({ type: 'setTheme', payload: { theme } }), [run]),
    setMenuBarTimer: useCallback((value) => run({ type: 'setMenuBarTimer', payload: { value } }), [run]),
    setFocusPosition: useCallback(
      (theme, position) => run({ type: 'setFocusPosition', payload: { theme, position } }),
      [run]
    ),
    pauseTask: useCallback((taskId) => run({ type: 'pauseTask', payload: { taskId, now: nowIso() } }), [run]),
    resumeTask: useCallback((taskId) => run({ type: 'resumeTask', payload: { taskId, now: nowIso() } }), [run])
  };
};
