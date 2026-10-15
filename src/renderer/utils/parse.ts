export interface ParsedTask {
  title: string;
  seconds?: number;
}

export const MAX_TASK_MINUTES = 8 * 60;

const clampMinutes = (minutes: number): number | undefined => {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return undefined;
  }
  return Math.min(MAX_TASK_MINUTES, Math.round(minutes)) * 60;
};

const H = '(?:h|hr|hrs|hour|hours)';
const M = '(?:m|min|mins|minute|minutes)';

// Durations are only read at the END of the line so titles like "Call 3 people" stay intact.
const patterns: Array<{ re: RegExp; minutes: (m: RegExpMatchArray) => number }> = [
  // "Write report [01:30]"  (legacy: hours:minutes)
  { re: /^(.+?)\s*\[(\d{1,2}):(\d{2})\]\s*$/, minutes: (m) => Number(m[2]) * 60 + Number(m[3]) },
  // "Testing; 15" or "Testing; 15 mins" (legacy: minutes)
  { re: new RegExp(`^(.+?);\\s*(\\d+)\\s*${M}?\\s*$`, 'i'), minutes: (m) => Number(m[2]) },
  // "Deep work 1h30", "Deep work 1h 30m", "Deep work 1 hr 30 min"
  { re: new RegExp(`^(.+?)\\s+(\\d+(?:\\.\\d+)?)\\s*${H}\\s*(\\d+)\\s*${M}?\\s*$`, 'i'), minutes: (m) => Number(m[2]) * 60 + Number(m[3]) },
  // "Deep work 2h", "Deep work 1.5 hours"
  { re: new RegExp(`^(.+?)\\s+(\\d+(?:\\.\\d+)?)\\s*${H}\\s*$`, 'i'), minutes: (m) => Number(m[2]) * 60 },
  // "Review deck 20m", "Review deck 20 min"
  { re: new RegExp(`^(.+?)\\s+(\\d+)\\s*${M}\\s*$`, 'i'), minutes: (m) => Number(m[2]) }
];

export const parseQuickAdd = (input: string): ParsedTask => {
  const text = input.trim();
  for (const { re, minutes } of patterns) {
    const match = text.match(re);
    if (match) {
      const title = match[1].trim();
      const seconds = clampMinutes(minutes(match));
      if (title && seconds) {
        return { title, seconds };
      }
    }
  }
  return { title: text };
};

export const parseTaskLines = (text: string): ParsedTask[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseQuickAdd)
    .filter((task) => task.title.length > 0);

// CSV: "Task, Minutes" with an optional header row.
export const parseCsv = (text: string): ParsedTask[] => {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const hasHeader = lines[0] !== undefined && /task|time/i.test(lines[0]);
  return lines.slice(hasHeader ? 1 : 0).flatMap((line) => {
    const [rawTitle, rawMinutes] = line.split(',').map((part) => part.trim());
    if (!rawTitle) {
      return [];
    }
    const seconds = rawMinutes ? clampMinutes(parseInt(rawMinutes, 10)) : undefined;
    return [{ title: rawTitle, seconds }];
  });
};
