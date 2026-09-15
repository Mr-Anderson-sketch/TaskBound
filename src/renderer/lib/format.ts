// renderer/lib/format — pure display-time formatting that isn't part of core/timer's
// five-function interface (Task 3.1 ruling 1: `fmtClock` moved to `../../core/timer`,
// which the renderer may import directly since it's pure). No DOM, no Electron: safe
// to unit-test under plain Vitest 'node' environment.

/** `2h 40m` style total, used by the strip's "done for today" chip. */
export function fmtDuration(seconds: number): string {
  const abs = Math.round(Math.abs(seconds));
  const hours = Math.floor(abs / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
