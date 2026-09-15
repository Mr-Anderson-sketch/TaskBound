// core/timer — pure timer math shared by the store and every renderer. No Electron,
// no Node, no Date.now(): every function takes the instants it needs as arguments.
import type { TaskTimer } from './types';

/** Total seconds spent on `t` as of `now`: `spentSeconds` plus the live segment
 * since `runningSince`, if running. A clock that moved backwards (`now < runningSince`)
 * clamps the live segment to 0 rather than going negative. */
export function elapsedSeconds(t: TaskTimer, now: number): number {
  const live = t.runningSince !== undefined ? Math.max(0, Math.floor((now - t.runningSince) / 1000)) : 0;
  return t.spentSeconds + live;
}

/** `plannedSeconds − elapsed`, `undefined` when there's no plan. May be negative
 * (overtime) — callers render that with `fmtClock`'s `+` prefix. */
export function remainingSeconds(t: TaskTimer, now: number): number | undefined {
  if (t.plannedSeconds === undefined) return undefined;
  return t.plannedSeconds - elapsedSeconds(t, now);
}

/** The instant a running, planned timer will expire (may already be in the past —
 * callers decide what "expired" means). `undefined` unless both `runningSince` and
 * `plannedSeconds` are set: an idle or unplanned timer has no expiry. */
export function expiryAt(t: TaskTimer): number | undefined {
  if (t.runningSince === undefined || t.plannedSeconds === undefined) return undefined;
  return t.runningSince + (t.plannedSeconds - t.spentSeconds) * 1000;
}

/** Folds a sleep/suspend gap into a running timer: if `t` isn't running, or the
 * gap (`resumedAt − suspendedAt`) is at or under `thresholdMs`, returns `t`
 * unchanged (same reference — callers can cheaply detect a no-op). Otherwise pauses
 * `t` AT the suspend instant — the elapsed segment up to `suspendedAt` (floored
 * seconds, clamped to ≥ 0) is folded into `spentSeconds`, `runningSince` is cleared,
 * and `pausedAtSuspend` records when the sleep started. */
export function applySleepGap(t: TaskTimer, suspendedAt: number, resumedAt: number, thresholdMs: number): TaskTimer {
  if (t.runningSince === undefined || resumedAt - suspendedAt <= thresholdMs) return t;
  const folded = Math.max(0, Math.floor((suspendedAt - t.runningSince) / 1000));
  return {
    ...t,
    spentSeconds: t.spentSeconds + folded,
    runningSince: undefined,
    pausedAtSuspend: suspendedAt
  };
}

/**
 * Formats a duration in seconds as a clock string: `MM:SS` under an hour (minutes
 * always zero-padded to 2 digits), `H:MM:SS` at an hour or more (hours unpadded,
 * minutes/seconds zero-padded), and a `+`-prefixed, unclamped `+MM:SS`/`+H:MM:SS`
 * for negative input (DESIGN.md "overtime … `+MM:SS`, unclamped"; negative means
 * overtime). Non-integer input is floored toward zero first (`Math.trunc`).
 */
export function fmtClock(seconds: number): string {
  const truncated = Math.trunc(seconds);
  const overtime = truncated < 0;
  const abs = Math.abs(truncated);
  const hours = Math.floor(abs / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  const secs = abs % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  const sign = overtime ? '+' : '';
  return hours > 0 ? `${sign}${hours}:${mm}:${ss}` : `${sign}${mm}:${ss}`;
}
