import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import type { AppState, Task } from '../../shared/types';
import { createEmptyState, ensureAlignedTasks } from '../../shared/stateHelpers';
import type { ElectronApi } from '../../shared/ipc';

const initialState: AppState = createEmptyState('0.0.0');

type AppAction =
  | { type: 'hydrate'; payload: AppState }
  | { type: 'tick'; now: string }
  | { type: 'addTask'; payload: { title: string; seconds?: number; now: string } }
  | { type: 'manualComplete'; now: string }
  | { type: 'addTime'; payload: { taskId: string; seconds: number; now: string } }
  | { type: 'updateTask'; payload: { taskId: string; title: string; seconds?: number; now: string } }
  | { type: 'deleteTask'; payload: { taskId: string; now: string } }
  | { type: 'reorderTasks'; payload: { orderedTaskIds: string[]; now: string } }
  | { type: 'syncMeta'; payload: { lastSavedAt: string; appVersion: string } }
  | { type: 'setAlwaysOnTop'; payload: { value: boolean } }
  | { type: 'pauseTask'; payload: { taskId: string; now: string } }
  | { type: 'resumeTask'; payload: { taskId: string; now: string } };

type Reducer = (state: AppState, action: AppAction) => AppState;

const findActiveTaskIndex = (tasks: Task[]): number =>
  tasks.findIndex((task) => task.status !== 'completed' && task.status !== 'struck');

const updateStatsOnCompletion = (state: AppState, completionIso: string): AppState['stats'] => {
  const dateKey = completionIso.slice(0, 10);
  const lastDate = state.stats.lastCompletionDate;
  const todayCompleted = lastDate === dateKey ? state.stats.todayCompleted + 1 : 1;
  return {
    totalCompleted: state.stats.totalCompleted + 1,
    todayCompleted,
    lastCompletionDate: dateKey
  };
};

const reducer: Reducer = (state, action) => {
  switch (action.type) {
    case 'hydrate': {
      return {
        ...action.payload,
        tasks: ensureAlignedTasks(action.payload.tasks)
      };
    }
    case 'tick': {
      const activeIndex = findActiveTaskIndex(state.tasks);
      if (activeIndex === -1) {
        return state;
      }
      const tasks = state.tasks.map((task, index) => {
        if (index !== activeIndex) {
          return task;
        }
        if (typeof task.remainingSeconds !== 'number') {
          return task;
        }
        if (task.remainingSeconds <= 0) {
          return task;
        }
        // Don't decrement timer if task is paused
        if (task.isPaused) {
          return task;
        }
        const remainingSeconds = task.remainingSeconds - 1;
        if (remainingSeconds > 0) {
          return {
            ...task,
            remainingSeconds,
            updatedAt: action.now,
            status: 'in_progress' as const
          };
        }
        const completionIso = action.now;
        return {
          ...task,
          remainingSeconds: 0,
          status: 'struck' as const,
          completedAt: completionIso,
          updatedAt: completionIso,
          history: [
            ...task.history,
            {
              type: 'auto_complete' as const,
              amountSeconds: task.timeAssignedSeconds ?? 0,
              at: completionIso
            }
          ]
        };
      });
      const updatedState: AppState = {
        ...state,
        tasks: ensureAlignedTasks(tasks)
      };
      const activeTask = state.tasks[activeIndex];
      const becameStruck =
        typeof activeTask.remainingSeconds === 'number' &&
        activeTask.remainingSeconds > 0 &&
        (tasks[activeIndex].status === 'struck' || tasks[activeIndex].status === 'completed');
      if (becameStruck) {
        updatedState.stats = updateStatsOnCompletion(state, action.now);
        // Award +1 point for auto-completing when timer expires
        updatedState.score = state.score + 1;
      }
      return updatedState;
    }
    case 'addTask': {
      const { title, seconds, now } = action.payload;
      const newTask: Task = {
        id: uuid(),
        title,
        createdAt: now,
        updatedAt: now,
        timeAssignedSeconds: seconds,
        remainingSeconds: typeof seconds === 'number' ? seconds : undefined,
        status: 'pending' as const,
        history: []
      };
      const tasks = ensureAlignedTasks([...state.tasks, newTask]);
      return {
        ...state,
        tasks,
        meta: { ...state.meta, lastSavedAt: now }
      };
    }
    case 'manualComplete': {
      const activeIndex = findActiveTaskIndex(state.tasks);
      if (activeIndex === -1) {
        return state;
      }
      const now = action.now;
      const tasks = state.tasks.map((task, index) => {
        if (index !== activeIndex) {
          return task;
        }
        const remaining = task.remainingSeconds ?? 0;
        return {
          ...task,
          status: 'completed' as const,
          remainingSeconds: 0,
          completedAt: now,
          updatedAt: now,
          history: [
            ...task.history,
            {
              type: 'manual_complete' as const,
              amountSeconds: remaining,
              at: now
            }
          ]
        };
      });
      const aligned = ensureAlignedTasks(tasks);
      return {
        ...state,
        score: state.score + 2, // +1 base + +1 bonus for completing before timer
        stats: updateStatsOnCompletion(state, now),
        tasks: aligned,
        meta: { ...state.meta, lastSavedAt: now }
      };
    }
    case 'addTime': {
      const { taskId, seconds, now } = action.payload;
      let scoreDelta = 0;
      const tasks = state.tasks.map((task) => {
        if (task.id !== taskId) {
          return task;
        }
        const previousAssigned = task.timeAssignedSeconds ?? 0;
        const totalAssigned = previousAssigned + seconds;
        const remaining = (task.remainingSeconds ?? task.timeAssignedSeconds ?? 0) + seconds;
        const wasFinished = task.status === 'completed' || task.status === 'struck';
        const status: Task['status'] =
          wasFinished && remaining > 0 ? 'in_progress' : task.status === 'completed' || task.status === 'struck' ? task.status : 'in_progress';

        if (seconds > 0 && previousAssigned > 0) {
          scoreDelta -= 1;
        }

        return {
          ...task,
          timeAssignedSeconds: totalAssigned,
          remainingSeconds: remaining,
          updatedAt: now,
          status,
          completedAt: wasFinished && remaining > 0 ? undefined : task.completedAt,
          history: [
            ...task.history,
            {
              type: 'add_time' as const,
              amountSeconds: seconds,
              at: now
            }
          ]
        };
      });
      return {
        ...state,
        score: state.score + scoreDelta,
        tasks: ensureAlignedTasks(tasks),
        meta: { ...state.meta, lastSavedAt: now }
      };
    }
    case 'updateTask': {
      const { taskId, title, seconds, now } = action.payload;
      let scoreDelta = 0;
      const tasks = state.tasks.map((task) => {
        if (task.id !== taskId) {
          return task;
        }
        const previousAssigned = task.timeAssignedSeconds ?? 0;
        const previousRemaining = task.remainingSeconds ?? previousAssigned;
        const nextAssigned = seconds;
        const hasTime = typeof nextAssigned === 'number' && nextAssigned > 0;
        let nextRemaining: number | undefined;
        if (hasTime) {
          const diff = nextAssigned - previousAssigned;
          const candidate = previousRemaining + diff;
          nextRemaining = Math.max(0, candidate);
          if (diff > 0 && previousAssigned > 0) {
            scoreDelta -= 1;
          }
        } else {
          nextRemaining = undefined;
        }
        const wasFinished = task.status === 'completed' || task.status === 'struck';
        const status: Task['status'] =
          wasFinished && hasTime && nextRemaining && nextRemaining > 0
            ? 'in_progress'
            : task.status === 'completed' || task.status === 'struck'
            ? task.status
            : hasTime
            ? 'in_progress'
            : 'pending';
        return {
          ...task,
          title,
          timeAssignedSeconds: hasTime ? nextAssigned : undefined,
          remainingSeconds: hasTime ? nextRemaining : undefined,
          updatedAt: now,
          status,
          completedAt: wasFinished && hasTime && nextRemaining && nextRemaining > 0 ? undefined : task.completedAt
        };
      });
      const nextState: AppState = {
        ...state,
        score: state.score + scoreDelta,
        tasks: ensureAlignedTasks(tasks),
        meta: { ...state.meta, lastSavedAt: now }
      };
      return nextState;
    }
    case 'deleteTask': {
      const tasks = state.tasks.filter((task) => task.id !== action.payload.taskId);
      return {
        ...state,
        tasks: ensureAlignedTasks(tasks),
        meta: { ...state.meta, lastSavedAt: action.payload.now }
      };
    }
    case 'reorderTasks': {
      const { orderedTaskIds, now } = action.payload;
      if (orderedTaskIds.length === 0) {
        return state;
      }
      const idToTask = new Map(state.tasks.map((task) => [task.id, task]));
      const seen = new Set<string>();
      const reordered: Task[] = [];
      for (const id of orderedTaskIds) {
        const task = idToTask.get(id);
        if (!task || seen.has(id)) {
          continue;
        }
        reordered.push(task);
        seen.add(id);
      }
      const trailing = state.tasks.filter((task) => !seen.has(task.id));
      const nextTasks = ensureAlignedTasks([...reordered, ...trailing]);
      return {
        ...state,
        tasks: nextTasks,
        meta: { ...state.meta, lastSavedAt: now }
      };
    }
    case 'syncMeta': {
      return {
        ...state,
        meta: {
          ...state.meta,
          lastSavedAt: action.payload.lastSavedAt,
          appVersion: action.payload.appVersion
        }
      };
    }
    case 'setAlwaysOnTop': {
      return {
        ...state,
        preferences: {
          ...state.preferences,
          alwaysOnTop: action.payload.value
        }
      };
    }
    case 'pauseTask': {
      const { taskId, now } = action.payload;
      const tasks = state.tasks.map((task) => {
        if (task.id !== taskId) {
          return task;
        }
        return {
          ...task,
          isPaused: true,
          updatedAt: now
        };
      });
      return {
        ...state,
        tasks,
        meta: { ...state.meta, lastSavedAt: now }
      };
    }
    case 'resumeTask': {
      const { taskId, now } = action.payload;
      const tasks = state.tasks.map((task) => {
        if (task.id !== taskId) {
          return task;
        }
        return {
          ...task,
          isPaused: false,
          updatedAt: now
        };
      });
      return {
        ...state,
        tasks,
        meta: { ...state.meta, lastSavedAt: now }
      };
    }
    default:
      return state;
  }
};

export interface AppStore {
  state: AppState;
  hydrated: boolean;
  addTask: (title: string, seconds?: number) => void;
  completeActiveTask: () => void;
  addTime: (taskId: string, seconds: number) => void;
  updateTask: (taskId: string, title: string, seconds?: number) => void;
  deleteTask: (taskId: string) => void;
  deleteTasks: (taskIds: string[]) => void;
  reorderTasks: (orderedTaskIds: string[]) => void;
  dispatchTick: (timestamp?: number) => void;
  setAlwaysOnTop: (value: boolean) => Promise<void>;
  pauseTask: (taskId: string) => void;
  resumeTask: (taskId: string) => void;
}

const shouldPersist = (type: AppAction['type']): boolean => {
  return type !== 'tick' && type !== 'hydrate' && type !== 'syncMeta';
};

export const useAppStore = (): AppStore => {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [hydrated, setHydrated] = useState(false);
  const apiRef = useRef<ElectronApi | null>(null);
  const stateRef = useRef(state);
  const pendingPersistRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActionRef = useRef<AppAction['type']>('hydrate');
  const prevTotalsRef = useRef({
    totalCompleted: state.stats.totalCompleted,
    todayCompleted: state.stats.todayCompleted
  });
  const lastTickTimestampRef = useRef<number | null>(null);
  const tickCarryoverRef = useRef(0);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const queuePersist = useCallback(() => {
    pendingPersistRef.current = true;
  }, []);

  useEffect(() => {
    const api = (window as Window & { electronAPI?: ElectronApi }).electronAPI;
    apiRef.current = api ?? null;
    if (!api) {
      setHydrated(true);
      return;
    }
    let mounted = true;
    api
      .loadState()
      .then((loaded) => {
        if (!mounted) {
          return;
        }
        dispatch({ type: 'hydrate', payload: loaded });
        setHydrated(true);
      })
      .catch((error) => {
        console.error('Failed to load state', error);
        setHydrated(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    if (!pendingPersistRef.current) {
      return;
    }
    const api = apiRef.current;
    if (!api) {
      return;
    }
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      const snapshot = stateRef.current;
      pendingPersistRef.current = false;
      api
        .saveState(snapshot)
        .then((saved: AppState) => {
          dispatch({
            type: 'syncMeta',
            payload: {
              lastSavedAt: saved.meta.lastSavedAt,
              appVersion: saved.meta.appVersion
            }
          });
        })
        .catch((error: unknown) => {
          console.error('Failed to save state', error);
        });
    }, 200);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [state, hydrated, queuePersist]);

  useEffect(() => {
    const prevTotals = prevTotalsRef.current;
    if (
      lastActionRef.current === 'tick' &&
      (state.stats.totalCompleted !== prevTotals.totalCompleted ||
        state.stats.todayCompleted !== prevTotals.todayCompleted)
    ) {
      queuePersist();
    }
    prevTotalsRef.current = {
      totalCompleted: state.stats.totalCompleted,
      todayCompleted: state.stats.todayCompleted
    };
  }, [state.stats.totalCompleted, state.stats.todayCompleted, queuePersist]);

  const dispatchWithPersist = useCallback(
    (action: AppAction) => {
      lastActionRef.current = action.type;
      dispatch(action);
      if (shouldPersist(action.type)) {
        queuePersist();
      }
    },
    [queuePersist]
  );

  const dispatchTick = useCallback(
    (timestamp?: number) => {
      const nowMs = typeof timestamp === 'number' ? timestamp : Date.now();
      const previous = lastTickTimestampRef.current;
      if (previous === null) {
        lastTickTimestampRef.current = nowMs;
        tickCarryoverRef.current = 0;
        return;
      }
      const deltaMs = nowMs - previous + tickCarryoverRef.current;
      const elapsedSeconds = Math.floor(deltaMs / 1000);
      tickCarryoverRef.current = deltaMs - elapsedSeconds * 1000;
      lastTickTimestampRef.current = nowMs;
      if (elapsedSeconds <= 0) {
        return;
      }
      for (let i = 1; i <= elapsedSeconds; i += 1) {
        const tickTime = previous + i * 1000;
        lastActionRef.current = 'tick';
        dispatch({ type: 'tick', now: new Date(tickTime).toISOString() });
      }
    },
    [dispatch]
  );

  const setAlwaysOnTopPreference = useCallback(
    async (value: boolean) => {
      const api = apiRef.current;
      if (api?.setAlwaysOnTop) {
        await api.setAlwaysOnTop(value);
      }
      dispatchWithPersist({ type: 'setAlwaysOnTop', payload: { value } });
    },
    [dispatchWithPersist]
  );

  const addTask = useCallback(
    (title: string, seconds?: number) => {
      dispatchWithPersist({
        type: 'addTask',
        payload: { title, seconds, now: new Date().toISOString() }
      });
    },
    [dispatchWithPersist]
  );

  const completeActiveTask = useCallback(() => {
    dispatchWithPersist({ type: 'manualComplete', now: new Date().toISOString() });
  }, [dispatchWithPersist]);

  const addTime = useCallback(
    (taskId: string, seconds: number) => {
      dispatchWithPersist({
        type: 'addTime',
        payload: { taskId, seconds, now: new Date().toISOString() }
      });
    },
    [dispatchWithPersist]
  );

  const updateTask = useCallback(
    (taskId: string, title: string, seconds?: number) => {
      dispatchWithPersist({
        type: 'updateTask',
        payload: { taskId, title, seconds, now: new Date().toISOString() }
      });
    },
    [dispatchWithPersist]
  );

  const deleteTask = useCallback(
    (taskId: string) => {
      dispatchWithPersist({
        type: 'deleteTask',
        payload: { taskId, now: new Date().toISOString() }
      });
    },
    [dispatchWithPersist]
  );

  const deleteTasks = useCallback(
    (taskIds: string[]) => {
      const now = new Date().toISOString();
      taskIds.forEach(taskId => {
        dispatchWithPersist({
          type: 'deleteTask',
          payload: { taskId, now }
        });
      });
    },
    [dispatchWithPersist]
  );

  const reorderTasks = useCallback(
    (orderedTaskIds: string[]) => {
      dispatchWithPersist({
        type: 'reorderTasks',
        payload: { orderedTaskIds, now: new Date().toISOString() }
      });
    },
    [dispatchWithPersist]
  );

  const pauseTask = useCallback(
    (taskId: string) => {
      dispatchWithPersist({
        type: 'pauseTask',
        payload: { taskId, now: new Date().toISOString() }
      });
    },
    [dispatchWithPersist]
  );

  const resumeTask = useCallback(
    (taskId: string) => {
      dispatchWithPersist({
        type: 'resumeTask',
        payload: { taskId, now: new Date().toISOString() }
      });
    },
    [dispatchWithPersist]
  );

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    const api = apiRef.current;
    if (!api?.onTimerTick) {
      return;
    }
    const unsubscribeTick = api.onTimerTick((timestamp: number) => {
      dispatchTick(timestamp);
    });

    return () => {
      unsubscribeTick?.();
    };
  }, [hydrated, dispatchTick]);

  useEffect(() => {
    if (hydrated && lastTickTimestampRef.current === null) {
      lastTickTimestampRef.current = Date.now();
      tickCarryoverRef.current = 0;
    }
  }, [hydrated]);

  return {
    state,
    hydrated,
    addTask,
    completeActiveTask,
    addTime,
    updateTask,
    deleteTask,
    deleteTasks,
    reorderTasks,
    dispatchTick,
    setAlwaysOnTop: setAlwaysOnTopPreference,
    pauseTask,
    resumeTask
  };
};
