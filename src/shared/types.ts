export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'struck';
export type TaskHistoryType = 'manual_complete' | 'auto_complete' | 'add_time' | 'scheduled_start' | 'allow_site';

export interface TaskHistoryEntry {
  type: TaskHistoryType;
  amountSeconds?: number;
  at: string;
  /** For 'allow_site': the block-list entry the user let through for this task. */
  site?: string;
}

export interface Task {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  timeAssignedSeconds?: number;
  remainingSeconds?: number;
  status: TaskStatus;
  isPaused?: boolean;
  history: TaskHistoryEntry[];
  /** Planned start (ISO). While set the task waits in "Scheduled"; at that time it moves
   * to the front of the queue and starts, and the field is cleared. */
  scheduledAt?: string;
  /** Block-list entries the user paid a point to allow while this task runs. */
  allowedSites?: string[];
}

export interface StatsSnapshot {
  totalCompleted: number;
  todayCompleted: number;
  lastCompletionDate?: string;
}

export interface MetaState {
  lastSavedAt: string;
  appVersion: string;
}

export type ThemeName = 'dark' | 'light';

export interface Point {
  x: number;
  y: number;
}

/** A recurring stretch of time when blocking is on regardless of tasks. Times are local
 * "HH:MM"; an `end` at or before `start` runs past midnight into the next day. */
export interface BlockWindow {
  id: string;
  /** Local weekdays the window starts on, 0 = Sunday … 6 = Saturday. */
  days: number[];
  start: string;
  end: string;
  enabled: boolean;
}

export interface BlockedApp {
  bundleId: string;
  name: string;
}

export interface BlockingPrefs {
  /** Block while a task's timer is running. */
  duringTasks: boolean;
  /** Normalized entries: a domain ("youtube.com") or a domain plus path ("youtube.com/shorts"). */
  sites: string[];
  apps: BlockedApp[];
  windows: BlockWindow[];
}

export interface PreferencesState {
  alwaysOnTop: boolean;
  theme: ThemeName;
  menuBarTimer: boolean;
  focusPositions?: Partial<Record<ThemeName, Point>>;
  blocking: BlockingPrefs;
}

export interface AppState {
  score: number;
  tasks: Task[];
  stats: StatsSnapshot;
  meta: MetaState;
  preferences: PreferencesState;
}
