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

export interface AppState {
  score: number;
  tasks: Task[];
  stats: StatsSnapshot;
  meta: MetaState;
}
