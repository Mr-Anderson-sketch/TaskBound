import { AppState, Task, TaskHistoryEntry } from './types';

const ISO_DATE_LENGTH = 10;

export const toISODateKey = (value: Date): string => value.toISOString().slice(0, ISO_DATE_LENGTH);

const cloneTask = (task: Task): Task => ({
  ...task,
  history: [...(task.history ?? [])]
});

export const ensureTaskDefaults = (task: Task): Task => {
  const next = cloneTask(task);
  next.status = next.status ?? 'pending';
  if (next.timeAssignedSeconds !== undefined && typeof next.remainingSeconds !== 'number') {
    next.remainingSeconds = next.timeAssignedSeconds;
  }
  next.history = next.history.map((entry: TaskHistoryEntry) => ({ ...entry }));
  return next;
};

export const createEmptyState = (appVersion: string, now: Date = new Date()): AppState => ({
  score: 0,
  tasks: [],
  stats: {
    totalCompleted: 0,
    todayCompleted: 0,
    lastCompletionDate: undefined
  },
  meta: {
    lastSavedAt: now.toISOString(),
    appVersion
  },
  preferences: {
    alwaysOnTop: true
  }
});

const findNextActiveIndex = (tasks: Task[]): number => {
  return tasks.findIndex((task) => task.status !== 'completed' && task.status !== 'struck');
};

export const realignTaskStatuses = (tasks: Task[]): Task[] => {
  let hasActive = false;
  return tasks.map((task) => {
    if (task.status === 'completed' || task.status === 'struck') {
      return task;
    }

    if (hasActive) {
      return { ...task, status: 'pending' };
    }

    const remaining = task.remainingSeconds ?? task.timeAssignedSeconds ?? 0;
    const status = remaining > 0 ? 'in_progress' : 'pending';
    hasActive = true;
    return { ...task, status };
  });
};

interface AutoAdvanceResult {
  tasks: Task[];
  stats: AppState['stats'];
}

const autoAdvance = (state: AppState, elapsedSeconds: number, now: Date): AutoAdvanceResult => {
  const tasks = state.tasks.map(ensureTaskDefaults);
  const stats = { ...state.stats };
  let secondsRemaining = elapsedSeconds;

  while (secondsRemaining > 0) {
    const activeIndex = findNextActiveIndex(tasks);
    if (activeIndex === -1) {
      break;
    }

    const task = { ...tasks[activeIndex] };
    const remaining = task.remainingSeconds ?? task.timeAssignedSeconds ?? 0;

    if (remaining <= 0) {
      // No timer for this task; stop auto-advancing.
      tasks[activeIndex] = task;
      break;
    }

    if (secondsRemaining >= remaining) {
      secondsRemaining -= remaining;
      const completionIso = now.toISOString();
      task.remainingSeconds = 0;
      task.status = 'struck';
      task.completedAt = completionIso;
      task.updatedAt = completionIso;
      task.history = [
        ...task.history,
        {
          type: 'auto_complete',
          amountSeconds: remaining,
          at: completionIso
        }
      ];
      const todayKey = toISODateKey(new Date(completionIso));
      if (stats.lastCompletionDate === todayKey) {
        stats.todayCompleted += 1;
      } else {
        stats.todayCompleted = 1;
        stats.lastCompletionDate = todayKey;
      }
      stats.totalCompleted += 1;
  tasks[activeIndex] = task;
      continue;
    }

    const updatedRemaining = remaining - secondsRemaining;
    task.remainingSeconds = updatedRemaining;
    task.updatedAt = now.toISOString();
    task.status = 'in_progress';
    tasks[activeIndex] = task;
    secondsRemaining = 0;
  }

  return { tasks: realignTaskStatuses(tasks), stats };
};

export const rehydrateState = (
  rawState: AppState,
  appVersion: string,
  now: Date = new Date()
): AppState => {
  const baseState: AppState = {
    score: rawState.score ?? 0,
    tasks: rawState.tasks ? rawState.tasks.map(ensureTaskDefaults) : [],
    stats: {
      totalCompleted: rawState.stats?.totalCompleted ?? 0,
      todayCompleted: rawState.stats?.todayCompleted ?? 0,
      lastCompletionDate: rawState.stats?.lastCompletionDate
    },
    meta: {
      lastSavedAt: rawState.meta?.lastSavedAt ?? now.toISOString(),
      appVersion
    },
    preferences: {
      alwaysOnTop: rawState.preferences?.alwaysOnTop ?? true
    }
  };

  const lastSaved = baseState.meta.lastSavedAt ? new Date(baseState.meta.lastSavedAt) : now;
  const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - lastSaved.getTime()) / 1000));

  let nextState = baseState;
  if (elapsedSeconds > 0) {
    const auto = autoAdvance(baseState, elapsedSeconds, now);
    nextState = {
      ...baseState,
      tasks: auto.tasks,
      stats: auto.stats
    };
  }

  return {
    ...nextState,
    tasks: realignTaskStatuses(nextState.tasks),
    meta: {
      lastSavedAt: now.toISOString(),
      appVersion
    },
    preferences: {
      alwaysOnTop: nextState.preferences?.alwaysOnTop ?? true
    }
  };
};

export const ensureAlignedTasks = (tasks: Task[]): Task[] => {
  return realignTaskStatuses(tasks.map(ensureTaskDefaults));
};
