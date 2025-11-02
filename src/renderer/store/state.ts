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
  | { type: 'syncMeta'; payload: { lastSavedAt: string; appVersion: string } };

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
        score: state.score + 1,
        stats: updateStatsOnCompletion(state, now),
        tasks: aligned,
        meta: { ...state.meta, lastSavedAt: now }
      };
    }
    case 'addTime': {
      const { taskId, seconds, now } = action.payload;
      const tasks = state.tasks.map((task) => {
        if (task.id !== taskId) {
          return task;
        }
        const totalAssigned = (task.timeAssignedSeconds ?? 0) + seconds;
        const remaining = (task.remainingSeconds ?? task.timeAssignedSeconds ?? 0) + seconds;
        const status: Task['status'] =
          task.status === 'completed' || task.status === 'struck' ? task.status : 'in_progress';
        return {
          ...task,
          timeAssignedSeconds: totalAssigned,
          remainingSeconds: remaining,
          updatedAt: now,
          status,
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
        score: state.score - 1,
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
          if (diff > 0) {
            scoreDelta -= 1;
          }
        } else {
          nextRemaining = undefined;
        }
        const status: Task['status'] =
          task.status === 'completed' || task.status === 'struck'
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
          status
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
  dispatchTick: () => void;
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

  const dispatchTick = useCallback(() => {
    lastActionRef.current = 'tick';
    dispatch({ type: 'tick', now: new Date().toISOString() });
  }, []);

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

  return {
    state,
    hydrated,
    addTask,
    completeActiveTask,
    addTime,
    updateTask,
    deleteTask,
    dispatchTick
  };
};
