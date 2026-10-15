import type { AppState, PreferencesState, Task, TaskHistoryEntry } from './types';

const pad = (value: number): string => value.toString().padStart(2, '0');

// Day boundaries follow the user's local clock, not UTC.
export const toLocalDateKey = (value: Date): string =>
  `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;

export const isDone = (task: Task): boolean => task.status === 'completed' || task.status === 'struck';
export const isOpen = (task: Task): boolean => !isDone(task);

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

export const defaultPreferences = (): PreferencesState => ({
  alwaysOnTop: true,
  theme: 'dark',
  menuBarTimer: true
});

export const createEmptyState = (appVersion: string, now: Date = new Date()): AppState => ({
  score: 0,
  tasks: [],
  stats: {
    totalCompleted: 0,
    todayCompleted: 0
  },
  meta: {
    lastSavedAt: now.toISOString(),
    appVersion
  },
  preferences: defaultPreferences()
});

export const realignTaskStatuses = (tasks: Task[]): Task[] => {
  let hasActive = false;
  return tasks.map((task) => {
    if (isDone(task)) {
      return task;
    }

    if (hasActive) {
      return task.status === 'pending' ? task : { ...task, status: 'pending' };
    }

    const remaining = task.remainingSeconds ?? task.timeAssignedSeconds ?? 0;
    const status = remaining > 0 ? 'in_progress' : 'pending';
    hasActive = true;
    return task.status === status ? task : { ...task, status };
  });
};

export const ensureAlignedTasks = (tasks: Task[]): Task[] => realignTaskStatuses(tasks.map(ensureTaskDefaults));

export const normalizeState = (raw: Partial<AppState> | null | undefined, appVersion: string): AppState => {
  const base = createEmptyState(appVersion);
  if (!raw) {
    return base;
  }
  const prefs = (raw.preferences ?? {}) as Partial<PreferencesState>;
  return {
    score: typeof raw.score === 'number' ? raw.score : 0,
    tasks: ensureAlignedTasks(raw.tasks ?? []),
    stats: {
      totalCompleted: raw.stats?.totalCompleted ?? 0,
      todayCompleted: raw.stats?.todayCompleted ?? 0,
      lastCompletionDate: raw.stats?.lastCompletionDate || undefined
    },
    meta: {
      lastSavedAt: raw.meta?.lastSavedAt ?? base.meta.lastSavedAt,
      appVersion: raw.meta?.appVersion ?? appVersion
    },
    preferences: {
      alwaysOnTop: prefs.alwaysOnTop ?? true,
      theme: prefs.theme === 'light' ? 'light' : 'dark',
      menuBarTimer: prefs.menuBarTimer ?? true,
      focusPositions: prefs.focusPositions
    }
  };
};

// "Today" in the stored stats only resets on the next completion, so readers must check the date.
export const completedToday = (state: AppState, now: Date = new Date()): number =>
  state.stats.lastCompletionDate === toLocalDateKey(now) ? state.stats.todayCompleted : 0;

export interface DaySummary {
  done: number;
  plannedSeconds: number;
  spentSeconds: number;
  timeAdds: number;
  finishedEarly: number;
}

const addedSeconds = (task: Task): number =>
  task.history.filter((entry) => entry.type === 'add_time').reduce((sum, entry) => sum + (entry.amountSeconds ?? 0), 0);

export const summarizeDay = (tasks: Task[], now: Date = new Date()): DaySummary => {
  const today = toLocalDateKey(now);
  const summary: DaySummary = { done: 0, plannedSeconds: 0, spentSeconds: 0, timeAdds: 0, finishedEarly: 0 };
  for (const task of tasks) {
    if (!isDone(task) || !task.completedAt || toLocalDateKey(new Date(task.completedAt)) !== today) {
      continue;
    }
    const assigned = task.timeAssignedSeconds ?? 0;
    const remaining = Math.max(0, task.remainingSeconds ?? 0);
    const manualFinishes = task.history.filter((entry) => entry.type === 'manual_complete');
    const leftAtFinish = manualFinishes[manualFinishes.length - 1]?.amountSeconds ?? remaining;
    summary.done += 1;
    summary.plannedSeconds += Math.max(0, assigned - addedSeconds(task));
    summary.spentSeconds += Math.max(0, assigned - leftAtFinish);
    summary.timeAdds += task.history.filter((entry) => entry.type === 'add_time').length;
    if (task.status === 'completed' && leftAtFinish > 0) {
      summary.finishedEarly += 1;
    }
  }
  return summary;
};
