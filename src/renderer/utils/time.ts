const pad = (value: number): string => value.toString().padStart(2, '0');

export const formatSeconds = (seconds?: number): string => {
  if (seconds === undefined || Number.isNaN(seconds)) {
    return '--:--';
  }
  const clamped = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const secs = clamped % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
};

// "1h 05m", "25m", "0m"
export const formatDuration = (seconds: number): string => {
  const totalMinutes = Math.round(Math.max(0, seconds) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${pad(minutes)}m` : `${minutes}m`;
};

export const splitSeconds = (seconds?: number): { hours: number; minutes: number } => {
  if (!seconds || Number.isNaN(seconds)) {
    return { hours: 0, minutes: 0 };
  }
  const clamped = Math.max(0, Math.floor(seconds));
  return { hours: Math.floor(clamped / 3600), minutes: Math.floor((clamped % 3600) / 60) };
};

export const combineToSeconds = (hours: number, minutes: number): number => {
  const safeHours = Number.isFinite(hours) ? Math.max(0, Math.floor(hours)) : 0;
  const safeMinutes = Number.isFinite(minutes) ? Math.max(0, Math.floor(minutes)) : 0;
  return (safeHours * 60 + safeMinutes) * 60;
};
