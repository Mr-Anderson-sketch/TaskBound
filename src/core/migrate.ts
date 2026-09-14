// core/migrate — imports the previous app's state.json into the current schema (E18).
// Reads raw legacy data and reconstructs totals only; it never replays elapsed time
// (no runningSince is ever produced here).
import type { Data, Task, TaskTimer, DayRecord } from './types';
import { createEmptyData, defaultSettings, INBOX_ID } from './defaults';
import { parseData } from './schema';
import { ymd } from './dates';

// The previous app's on-disk shape. Defined locally (not imported from
// src/shared/types.ts, which will be deleted once migration ships) and kept loose
// (unknown-ish fields) because this is untrusted, possibly-drifted persisted JSON.
export interface LegacyHistoryEntry {
  type?: 'manual_complete' | 'auto_complete' | 'add_time';
  amountSeconds?: number;
  at?: string;
}

export interface LegacyTask {
  id?: unknown;
  title?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  completedAt?: unknown;
  timeAssignedSeconds?: unknown;
  remainingSeconds?: unknown;
  status?: unknown;
  isPaused?: unknown;
  history?: unknown;
}

export interface LegacyState {
  score?: number;
  tasks?: LegacyTask[];
  stats?: { totalCompleted?: number; todayCompleted?: number; lastCompletionDate?: string };
  meta?: { lastSavedAt?: string; appVersion?: string };
  preferences?: { alwaysOnTop?: boolean };
}

const TITLE_MAX = 200;

function parseIsoMs(value: unknown, fallback: number): number {
  if (typeof value === 'string') {
    const t = Date.parse(value);
    if (!Number.isNaN(t)) return t;
  }
  return fallback;
}

function emptyResult(now: number, appVersion: string): { data: Data; dropped: number } {
  const data = createEmptyData(now, appVersion);
  data.meta.legacyImportedAt = now;
  return { data, dropped: 0 };
}

/**
 * Migrates a previous-app `state.json` payload into the current `Data` schema.
 * Never throws on shape drift: any input that isn't a usable legacy state (not an
 * object, missing `tasks`) yields fresh empty data; any individual task that can't
 * be trusted (not an object, missing/invalid `id` or `title`, empty title after
 * trim) is dropped and counted in the returned `dropped` total rather than failing
 * the whole import.
 */
export function migrateLegacy(raw: unknown, now: number, appVersion: string): { data: Data; dropped: number } {
  if (typeof raw !== 'object' || raw === null) {
    return emptyResult(now, appVersion);
  }
  const legacy = raw as LegacyState;
  if (!Array.isArray(legacy.tasks)) {
    return emptyResult(now, appVersion);
  }

  let dropped = 0;
  const tasks: Task[] = [];
  let earliestCreatedAt: number | undefined;

  legacy.tasks.forEach((rawTask, index) => {
    if (typeof rawTask !== 'object' || rawTask === null) {
      dropped++;
      return;
    }
    const t = rawTask as LegacyTask;
    if (typeof t.id !== 'string' || t.id.length === 0 || typeof t.title !== 'string') {
      dropped++;
      return;
    }
    const title = t.title.trim().slice(0, TITLE_MAX);
    if (title.length === 0) {
      dropped++;
      return;
    }

    const createdAt = parseIsoMs(t.createdAt, now);
    const updatedAt = parseIsoMs(t.updatedAt, now);
    const legacyStatus = typeof t.status === 'string' ? t.status : 'pending';
    const isDone = legacyStatus === 'completed' || legacyStatus === 'struck';
    const status: Task['status'] = isDone ? 'done' : 'open';

    let completedBy: Task['completedBy'];
    let completedAt: number | undefined;
    if (isDone) {
      const history = Array.isArray(t.history) ? (t.history as LegacyHistoryEntry[]) : [];
      const last = history.length > 0 ? history[history.length - 1] : undefined;
      const lastIsAuto = !!last && last.type === 'auto_complete';
      completedBy = legacyStatus === 'struck' || lastIsAuto ? 'timer' : 'user';
      completedAt = parseIsoMs(t.completedAt, updatedAt);
    }

    let timer: TaskTimer | undefined;
    const assigned = t.timeAssignedSeconds;
    if (typeof assigned === 'number' && Number.isFinite(assigned) && assigned > 0) {
      const remaining = typeof t.remainingSeconds === 'number' && Number.isFinite(t.remainingSeconds) ? t.remainingSeconds : assigned;
      const spentSeconds = Math.max(0, assigned - remaining);
      timer = { plannedSeconds: assigned, spentSeconds };
    }

    const task: Task = {
      id: t.id,
      title,
      listId: INBOX_ID,
      tags: [],
      order: (index + 1) * 1000,
      today: false,
      status,
      createdAt,
      updatedAt,
      ...(isDone ? { completedAt, completedBy } : {}),
      ...(timer ? { timer } : {})
    };

    earliestCreatedAt = earliestCreatedAt === undefined ? createdAt : Math.min(earliestCreatedAt, createdAt);
    tasks.push(task);
  });

  const dayMap = new Map<string, { completed: number; focusSeconds: number }>();
  for (const task of tasks) {
    if (task.status === 'done' && task.completedAt !== undefined) {
      const key = ymd(task.completedAt);
      const entry = dayMap.get(key) ?? { completed: 0, focusSeconds: 0 };
      entry.completed += 1;
      entry.focusSeconds += task.timer?.spentSeconds ?? 0;
      dayMap.set(key, entry);
    }
  }
  const days: DayRecord[] = Array.from(dayMap.entries())
    .map(([date, v]) => ({ date, completed: v.completed, focusSeconds: v.focusSeconds, rolledOver: 0 }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const settings = defaultSettings();
  settings.score = { enabled: typeof legacy.score === 'number' && legacy.score !== 0, value: legacy.score ?? 0 };
  settings.strip.enabled = true;

  const base = createEmptyData(now, appVersion);
  const data: Data = {
    schemaVersion: 2,
    tasks,
    lists: base.lists,
    days,
    settings,
    meta: { createdAt: earliestCreatedAt ?? now, lastSavedAt: now, appVersion, legacyImportedAt: now }
  };

  // Final guard: the migrated shape must satisfy the real schema. If this throws,
  // that's a bug in the mapping above, not a legitimate "drop and continue" case.
  parseData(data);

  return { data, dropped };
}
