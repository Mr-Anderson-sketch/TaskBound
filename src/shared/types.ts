export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'struck';
export type TaskHistoryType = 'manual_complete' | 'auto_complete' | 'add_time';

export interface TaskHistoryEntry {
  type: TaskHistoryType;
  amountSeconds?: number;
  at: string;
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

export interface PreferencesState {
  alwaysOnTop: boolean;
  theme: ThemeName;
  menuBarTimer: boolean;
  focusPositions?: Partial<Record<ThemeName, Point>>;
}

export interface AppState {
  score: number;
  tasks: Task[];
  stats: StatsSnapshot;
  meta: MetaState;
  preferences: PreferencesState;
}
