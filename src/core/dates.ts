// core/dates — local-calendar date helpers. Never use UTC/ISO conversions for calendar math:
// the strip and rollover logic operate on the user's local wall clock.
import type { Ymd } from './types';

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Local calendar date (YYYY-MM-DD) for an epoch-ms instant. */
export function ymd(ms: number): Ymd {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Local midnight Date for a 'YYYY-MM-DD' string. */
export function parseYmd(s: Ymd): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Add n calendar days (n may be negative) to a local Ymd, respecting DST. */
export function addDays(s: Ymd, n: number): Ymd {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d.getTime());
}

/** Epoch ms of local midnight on the day containing ms. */
export function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Whether two instants fall on the same local calendar day. */
export function isSameLocalDay(a: number, b: number): boolean {
  return startOfLocalDay(a) === startOfLocalDay(b);
}

/**
 * The "day key" an instant belongs to for rollover purposes: a day starts at
 * `cutoffHour` local (default 4 AM, per D17), not at local midnight.
 */
export function dayKeyForRollover(ms: number, cutoffHour = 4): Ymd {
  return ymd(ms - cutoffHour * 60 * 60 * 1000);
}
