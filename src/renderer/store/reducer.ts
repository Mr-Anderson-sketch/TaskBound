import type { AppState, Point, Task, ThemeName } from '../../shared/types';
import { ensureAlignedTasks, isDone, toLocalDateKey } from '../../shared/stateHelpers';

// A gap longer than this between ticks means the machine slept or the app was suspended;
// that time is not charged to the running task.
export const MAX_TICK_GAP_MS = 90_000;

export type AppAction =
  | { type: 'hydrate'; payload: AppState }
  | { type: 'tick'; now: string }
  | { type: 'addTask'; payload: { id: string; title: string; seconds?: number; now: string } }
  | { type: 'manualComplete'; now: string }
  | { type: 'addTime'; payload: { taskId: string; seconds: number; now: string } }
  | { type: 'reopenWithTime'; payload: { taskId: string; seconds: number; now: string } }
  | { type: 'updateTask'; payload: { taskId: string; title: string; seconds?: number; now: string } }
  | { type: 'deleteTasks'; payload: { taskIds: string[]; now: string } }
  | { type: 'clearFinished'; now: string }
  | { type: 'reorderTasks'; payload: { orderedTaskIds: string[]; now: string } }
  | { type: 'syncMeta'; payload: { lastSavedAt: string; appVersion: string } }
  | { type: 'setAlwaysOnTop'; payload: { value: boolean } }
  | { type: 'setTheme'; payload: { theme: ThemeName } }
  | { type: 'setMenuBarTimer'; payload: { value: boolean } }
  | { type: 'setFocusPosition'; payload: { theme: ThemeName; position: Point | null } }
  | { type: 'pauseTask'; payload: { taskId: string; now: string } }
  | { type: 'resumeTask'; payload: { taskId: string; now: string } };

const findActiveTaskIndex = (tasks: Task[]): number => tasks.findIndex((task) => !isDone(task));

const updateStatsOnCompletion = (state: AppState, completionIso: string): AppState['stats'] => {
  const dateKey = toLocalDateKey(new Date(completionIso));
  const todayCompleted = state.stats.lastCompletionDate === dateKey ? state.stats.todayCompleted + 1 : 1;
  return {
    totalCompleted: state.stats.totalCompleted + 1,
    todayCompleted,
    lastCompletionDate: dateKey
  };
};

const withSavedAt = (state: AppState, now: string): AppState['meta'] => ({ ...state.meta, lastSavedAt: now });

export const reducer = (state: AppState, action: AppAction): AppState => {
  switch (action.type) {
    case 'hydrate':
      return action.payload;

    case 'tick': {
      const activeIndex = findActiveTaskIndex(state.tasks);
      if (activeIndex === -1) {
        return state;
      }
      const task = state.tasks[activeIndex];
      if (typeof task.remainingSeconds !== 'number' || task.remainingSeconds <= 0 || task.isPaused) {
        return state;
      }
      const remainingSeconds = task.remainingSeconds - 1;
      if (remainingSeconds > 0) {
        const tasks = [...state.tasks];
        tasks[activeIndex] = { ...task, remainingSeconds, status: 'in_progress', updatedAt: action.now };
        return { ...state, tasks };
      }
      const tasks = [...state.tasks];
      tasks[activeIndex] = {
        ...task,
        remainingSeconds: 0,
        status: 'struck',
        completedAt: action.now,
        updatedAt: action.now,
        history: [...task.history, { type: 'auto_complete', amountSeconds: task.timeAssignedSeconds ?? 0, at: action.now }]
      };
      return {
        ...state,
        tasks: ensureAlignedTasks(tasks),
        stats: updateStatsOnCompletion(state, action.now),
        score: state.score + 1,
        meta: withSavedAt(state, action.now)
      };
    }

    case 'addTask': {
      const { id, title, seconds, now } = action.payload;
      const newTask: Task = {
        id,
        title,
        createdAt: now,
        updatedAt: now,
        timeAssignedSeconds: seconds,
        remainingSeconds: typeof seconds === 'number' ? seconds : undefined,
        status: 'pending',
        history: []
      };
      return { ...state, tasks: ensureAlignedTasks([...state.tasks, newTask]), meta: withSavedAt(state, now) };
    }

    case 'manualComplete': {
      const activeIndex = findActiveTaskIndex(state.tasks);
      if (activeIndex === -1) {
        return state;
      }
      const now = action.now;
      const task = state.tasks[activeIndex];
      const tasks = [...state.tasks];
      tasks[activeIndex] = {
        ...task,
        status: 'completed',
        remainingSeconds: 0,
        isPaused: false,
        completedAt: now,
        updatedAt: now,
        history: [...task.history, { type: 'manual_complete', amountSeconds: task.remainingSeconds ?? 0, at: now }]
      };
      return {
        ...state,
        score: state.score + 2,
        stats: updateStatsOnCompletion(state, now),
        tasks: ensureAlignedTasks(tasks),
        meta: withSavedAt(state, now)
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
        const remaining = (task.remainingSeconds ?? task.timeAssignedSeconds ?? 0) + seconds;
        const wasFinished = isDone(task);
        if (seconds > 0 && previousAssigned > 0) {
          scoreDelta -= 1;
        }
        return {
          ...task,
          timeAssignedSeconds: previousAssigned + seconds,
          remainingSeconds: remaining,
          updatedAt: now,
          status: wasFinished ? ('pending' as const) : task.status,
          completedAt: wasFinished ? undefined : task.completedAt,
          history: [...task.history, { type: 'add_time' as const, amountSeconds: seconds, at: now }]
        };
      });
      return { ...state, score: state.score + scoreDelta, tasks: ensureAlignedTasks(tasks), meta: withSavedAt(state, now) };
    }

    case 'reopenWithTime': {
      // "Time's up → +5 min": undo the automatic completion, then add the time and make it current again.
      const { taskId, seconds, now } = action.payload;
      const index = state.tasks.findIndex((task) => task.id === taskId);
      const task = state.tasks[index];
      if (!task || task.status !== 'struck') {
        return state;
      }
      const lastEntry = task.history[task.history.length - 1];
      const wasAuto = lastEntry?.type === 'auto_complete';
      const completionDate = task.completedAt ? toLocalDateKey(new Date(task.completedAt)) : undefined;
      const reopened: Task = {
        ...task,
        status: 'pending',
        isPaused: false,
        completedAt: undefined,
        updatedAt: now,
        timeAssignedSeconds: (task.timeAssignedSeconds ?? 0) + seconds,
        remainingSeconds: seconds,
        history: [...task.history, { type: 'add_time', amountSeconds: seconds, at: now }]
      };
      const others = state.tasks.filter((candidate) => candidate.id !== taskId);
      const firstOpen = others.findIndex((candidate) => !isDone(candidate));
      const insertAt = firstOpen === -1 ? others.length : firstOpen;
      const tasks = [...others.slice(0, insertAt), reopened, ...others.slice(insertAt)];
      const stats = wasAuto
        ? {
            ...state.stats,
            totalCompleted: Math.max(0, state.stats.totalCompleted - 1),
            todayCompleted:
              completionDate && completionDate === state.stats.lastCompletionDate
                ? Math.max(0, state.stats.todayCompleted - 1)
                : state.stats.todayCompleted
          }
        : state.stats;
      return {
        ...state,
        score: state.score - (wasAuto ? 1 : 0) - 1,
        stats,
        tasks: ensureAlignedTasks(tasks),
        meta: withSavedAt(state, now)
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
        const hasTime = typeof seconds === 'number' && seconds > 0;
        let nextRemaining: number | undefined;
        if (hasTime) {
          const diff = seconds - previousAssigned;
          nextRemaining = Math.max(0, previousRemaining + diff);
          if (diff > 0 && previousAssigned > 0) {
            scoreDelta -= 1;
          }
        }
        const reopen = isDone(task) && hasTime && (nextRemaining ?? 0) > 0;
        return {
          ...task,
          title,
          timeAssignedSeconds: hasTime ? seconds : undefined,
          remainingSeconds: hasTime ? nextRemaining : undefined,
          updatedAt: now,
          status: reopen ? ('pending' as const) : task.status,
          completedAt: reopen ? undefined : task.completedAt
        };
      });
      return { ...state, score: state.score + scoreDelta, tasks: ensureAlignedTasks(tasks), meta: withSavedAt(state, now) };
    }

    case 'deleteTasks': {
      const remove = new Set(action.payload.taskIds);
      return {
        ...state,
        tasks: ensureAlignedTasks(state.tasks.filter((task) => !remove.has(task.id))),
        meta: withSavedAt(state, action.payload.now)
      };
    }

    case 'clearFinished':
      return { ...state, tasks: state.tasks.filter((task) => !isDone(task)), meta: withSavedAt(state, action.now) };

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
        if (task && !seen.has(id)) {
          reordered.push(task);
          seen.add(id);
        }
      }
      const trailing = state.tasks.filter((task) => !seen.has(task.id));
      return { ...state, tasks: ensureAlignedTasks([...reordered, ...trailing]), meta: withSavedAt(state, now) };
    }

    case 'syncMeta':
      return {
        ...state,
        meta: { ...state.meta, lastSavedAt: action.payload.lastSavedAt, appVersion: action.payload.appVersion }
      };

    case 'setAlwaysOnTop':
      return { ...state, preferences: { ...state.preferences, alwaysOnTop: action.payload.value } };

    case 'setTheme':
      return { ...state, preferences: { ...state.preferences, theme: action.payload.theme } };

    case 'setMenuBarTimer':
      return { ...state, preferences: { ...state.preferences, menuBarTimer: action.payload.value } };

    case 'setFocusPosition': {
      const positions = { ...state.preferences.focusPositions };
      if (action.payload.position) {
        positions[action.payload.theme] = action.payload.position;
      } else {
        delete positions[action.payload.theme];
      }
      return { ...state, preferences: { ...state.preferences, focusPositions: positions } };
    }

    case 'pauseTask':
    case 'resumeTask': {
      const { taskId, now } = action.payload;
      const isPaused = action.type === 'pauseTask';
      return {
        ...state,
        tasks: state.tasks.map((task) => (task.id === taskId ? { ...task, isPaused, updatedAt: now } : task)),
        meta: withSavedAt(state, now)
      };
    }

    default:
      return state;
  }
};

export interface TickDelta {
  elapsed: number;
  carry: number;
}

// Whole seconds to charge between two tick timestamps. Gaps beyond MAX_TICK_GAP_MS (sleep,
// suspended app) and clock jumps backwards charge nothing.
export const tickDelta = (previousMs: number, nowMs: number, carryMs: number): TickDelta => {
  const gap = nowMs - previousMs;
  if (gap <= 0 || gap > MAX_TICK_GAP_MS) {
    return { elapsed: 0, carry: 0 };
  }
  const total = gap + carryMs;
  const elapsed = Math.floor(total / 1000);
  return { elapsed, carry: total - elapsed * 1000 };
};
