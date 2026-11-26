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

/** Value for an <input type="datetime-local">: local "YYYY-MM-DDTHH:MM". */
export const toLocalInput = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

const clock12 = (date: Date): string => {
  const hours = date.getHours();
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${pad(date.getMinutes())} ${hours < 12 ? 'AM' : 'PM'}`;
};

/** "9:00 AM", "tomorrow 9:00 AM", "Thu 27 Nov 9:00 AM" relative to `now`. */
export const formatStart = (iso: string, now: Date = new Date()): string => {
  const date = new Date(iso);
  const dayDiff = Math.round(
    (new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
      86_400_000
  );
  if (dayDiff === 0) return clock12(date);
  if (dayDiff === 1) return `tomorrow ${clock12(date)}`;
  const day = date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day} ${clock12(date)}`;
};
