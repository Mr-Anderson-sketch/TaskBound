// core/types — see docs/PLAN.md. Pure data types shared across main, renderer, and core.
export type Id = string;
export type Ymd = string; // 'YYYY-MM-DD' local
export type Hm = string; // 'HH:mm' local

export interface Due {
  date: Ymd;
  time?: Hm;
}

export type Rule =
  | { kind: 'daily' }
  | { kind: 'weekdays' }
  | { kind: 'weekly'; days: number[] } // 0=Sun … 6=Sat, non-empty, sorted
  | { kind: 'monthly'; dayOfMonth: number } // 1..31, clamped to month length
  | { kind: 'everyN'; n: number; unit: 'day' | 'week'; anchor: Ymd };

export interface TaskTimer {
  plannedSeconds?: number;
  spentSeconds: number;
  runningSince?: number /* epoch ms */;
  pausedAtSuspend?: number;
}

export interface Task {
  id: Id;
  title: string;
  notes?: string;
  listId: Id;
  parentId?: Id;
  tags: string[];
  order: number;
  today: boolean;
  due?: Due;
  snoozedUntil?: number;
  recurrence?: Rule;
  timer?: TaskTimer;
  status: 'open' | 'done';
  completedBy?: 'user' | 'timer';
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface List {
  id: Id;
  name: string;
  order: number;
  createdAt: number;
}

export interface DayRecord {
  date: Ymd;
  completed: number;
  focusSeconds: number;
  rolledOver: number;
  note?: string;
  closedAt?: number;
  /** Set by the `day/rollover` reducer once rollover has been applied for this date
   * (Task 2.3 addendum ruling 1); makes rollover idempotent for a given date. */
  rolloverAppliedAt?: number;
}

export type Edge = 'top' | 'bottom';
export interface StripPosition {
  x: number;
  y: number;
}

export interface Settings {
  theme: { name: 'ledger' | 'kraft' | 'phosphor' | 'slate'; mode: 'light' | 'dark' | 'system' };
  textSize: 'S' | 'M' | 'L';
  strip: {
    enabled: boolean;
    edge: Edge;
    width: number;
    collapsed: boolean;
    autoHide: boolean;
    clickThrough: boolean;
    opacity: number /* 0.4..1 */;
    reserveSpace: boolean;
    hideOverFullscreen: boolean;
    hideFromCapture: boolean;
    menuBarMode: boolean;
    positions: Record<string, StripPosition>;
  };
  hotkeys: { capture: string; toggleStrip: string; completeAdvance: string; toggleTimer: string; undo: string };
  timer: {
    pomodoro: boolean;
    workMinutes: number;
    breakMinutes: number;
    idlePauseMinutes: number;
    awayThresholdMinutes: number;
    defaultPlannedMinutes: number;
  };
  score: { enabled: boolean; value: number };
  startOnLogin: boolean;
  notifications: boolean;
  reducedMotion: 'system' | 'on' | 'off';
  dataDir?: string;
  onboardingDone: boolean;
}

export interface Data {
  schemaVersion: 2;
  tasks: Task[];
  lists: List[];
  days: DayRecord[];
  settings: Settings;
  meta: { createdAt: number; lastSavedAt: number; appVersion: string; legacyImportedAt?: number };
}

export type Action =
  | { type: 'task/add'; id: Id; now: number; title: string; listId?: Id; parentId?: Id; tags?: string[]; due?: Due; recurrence?: Rule; plannedSeconds?: number; today?: boolean; makeCurrent?: boolean }
  | { type: 'task/edit'; id: Id; now: number; patch: Partial<Pick<Task, 'title' | 'notes' | 'listId' | 'tags' | 'due' | 'recurrence' | 'today'>> & { plannedSeconds?: number | null } }
  | { type: 'task/complete'; id: Id; now: number; by: 'user' | 'timer'; spawnId?: Id }
  | { type: 'task/uncomplete'; id: Id; now: number }
  | { type: 'task/delete'; id: Id; now: number }
  | { type: 'task/move'; id: Id; now: number; listId?: Id; parentId?: Id | null; afterId?: Id | null }
  | { type: 'task/makeCurrent'; id: Id; now: number }
  | { type: 'task/skip'; id: Id; now: number }
  | { type: 'task/snooze'; id: Id; now: number; until: number }
  | { type: 'task/setToday'; ids: Id[]; now: number; today: boolean }
  | { type: 'timer/start'; id: Id; now: number }
  // Task 3.2 fix round 1: a pomodoro work session. Unlike `timer/start`, this always
  // gives the task a FULL `seconds`-long session regardless of any prior
  // `plannedSeconds`/`spentSeconds` (so a second pomodoro session on the same task
  // doesn't expire instantly) — see reducer.ts. Deliberately not undoable (ruling:
  // "NOT in UNDOABLE, no score change").
  | { type: 'timer/startSession'; id: Id; now: number; seconds: number }
  | { type: 'timer/pause'; id: Id; now: number; at?: number }
  | { type: 'timer/stop'; id: Id; now: number }
  | { type: 'timer/addTime'; id: Id; now: number; seconds: number }
  | { type: 'list/add'; id: Id; now: number; name: string }
  | { type: 'list/rename'; id: Id; now: number; name: string }
  | { type: 'list/delete'; id: Id; now: number; moveTasksTo: Id }
  | { type: 'day/rollover'; now: number; date: Ymd }
  | { type: 'day/close'; now: number; date: Ymd; note?: string }
  | { type: 'settings/patch'; now: number; patch: DeepPartial<Settings> }
  | { type: 'data/replace'; now: number; data: Data };

// A type has an index signature (Record<string, V>-shaped) iff `string` itself
// is assignable to its key type — a plain interface's keyof is a finite union
// of literal keys, never `string` itself.
type IsIndexSignature<T> = string extends keyof T ? true : false;

// Deep-partial an object type, but treat index-signature members (Record<string, V>,
// e.g. Settings['strip']['positions']) as opaque leaves: a partial map entry (half a
// StripPosition) is meaningless, and this keeps DeepPartial in lockstep with zod's
// `.deepPartial()`, which likewise does not partial-ify ZodRecord value schemas.
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? (IsIndexSignature<T[K]> extends true ? T[K] : DeepPartial<T[K]>) : T[K];
};
