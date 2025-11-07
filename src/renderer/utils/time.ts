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

export const splitSeconds = (seconds?: number): { hours: number; minutes: number } => {
  if (!seconds || Number.isNaN(seconds)) {
    return { hours: 0, minutes: 0 };
  }
  const clamped = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  return { hours, minutes };
};

export const combineToSeconds = (hours: number, minutes: number): number => {
  const safeHours = Number.isFinite(hours) ? Math.max(0, Math.floor(hours)) : 0;
  const safeMinutes = Number.isFinite(minutes) ? Math.max(0, Math.floor(minutes)) : 0;
  const totalMinutes = safeHours * 60 + safeMinutes;
  return Math.max(0, totalMinutes * 60);
};
