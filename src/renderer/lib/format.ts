// renderer/lib/format — pure display-time formatting. No DOM, no Electron: safe to
// unit-test under plain Vitest 'node' environment (tests/renderer/format.test.ts).

/**
 * Formats a duration in seconds as a clock string: `MM:SS` under an hour (minutes
 * always zero-padded to 2 digits), `H:MM:SS` at an hour or more (hours unpadded,
 * minutes/seconds zero-padded), and a `+`-prefixed, unclamped `+MM:SS`/`+H:MM:SS`
 * for negative input (DESIGN.md "overtime … `+MM:SS`, unclamped").
 */
export function fmtClock(seconds: number): string {
  const overtime = seconds < 0;
  const abs = Math.round(Math.abs(seconds));
  const hours = Math.floor(abs / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  const secs = abs % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  const sign = overtime ? '+' : '';
  return hours > 0 ? `${sign}${hours}:${mm}:${ss}` : `${sign}${mm}:${ss}`;
}

/** `2h 40m` style total, used by the strip's "done for today" chip. */
export function fmtDuration(seconds: number): string {
  const abs = Math.round(Math.abs(seconds));
  const hours = Math.floor(abs / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
