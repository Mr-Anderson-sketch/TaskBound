export const formatSeconds = (seconds?: number): string => {
  if (seconds === undefined || Number.isNaN(seconds)) {
    return '---';
  }
  const clamped = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(clamped / 60)
    .toString()
    .padStart(2, '0');
  const secs = (clamped % 60).toString().padStart(2, '0');
  return `${minutes}:${secs}`;
};

export const splitSeconds = (seconds?: number): { minutes: number; seconds: number } => {
  if (!seconds || Number.isNaN(seconds)) {
    return { minutes: 0, seconds: 0 };
  }
  const clamped = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(clamped / 60);
  const remainder = clamped % 60;
  return { minutes, seconds: remainder };
};

export const combineToSeconds = (minutes: number, seconds: number): number => {
  const safeMinutes = Number.isFinite(minutes) ? minutes : 0;
  const safeSeconds = Number.isFinite(seconds) ? seconds : 0;
  return Math.max(0, Math.floor(safeMinutes * 60 + safeSeconds));
};
