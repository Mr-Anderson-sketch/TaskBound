export interface ParsedTask {
  title: string;
  seconds?: number;
  /** Planned start, ISO. */
  startAt?: string;
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

const stripDuration = (text: string): { rest: string; seconds: number } | null => {
  for (const { re, minutes } of patterns) {
    const match = text.match(re);
    if (match) {
      const rest = match[1].trim();
      const seconds = clampMinutes(minutes(match));
      if (rest && seconds) {
        return { rest, seconds };
      }
    }
  }
  return null;
};

// A start time at the END of the line: "at 9", "at 9:30", "9am", "9:30 pm", "@14:00", "21:00",
// optionally with "today"/"tomorrow" on either side. A bare number ("Read chapter 2") is never
// a time: it needs "at"/"@", a colon, or am/pm.
const TIME_RE =
  /^(.+?)\s+(?:(today|tomorrow|tmrw)\s+)?(?:(?:at|@)\s*(\d{1,2})(?::([0-5]\d))?\s*(am|pm|a\.m\.|p\.m\.)?|(\d{1,2}):([0-5]\d)\s*(am|pm|a\.m\.|p\.m\.)?|(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.))(?:\s+(today|tomorrow|tmrw))?\s*$/i;
const LEADING_DAY_RE = /^(.+?)\s+(today|tomorrow|tmrw)$/i;

/**
 * Hour for a clock time typed without am/pm. Up to 12 is read as a working-hours time:
 * 7-11 morning, 12 noon, 1-6 afternoon. 0 and 13-23 are already 24-hour.
 */
const resolveHour = (hour: number, meridiem: string | undefined): number | null => {
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    const pm = meridiem.toLowerCase().startsWith('p');
    return (hour % 12) + (pm ? 12 : 0);
  }
  if (hour > 23) return null;
  if (hour === 0 || hour > 12) return hour;
  if (hour === 12) return 12;
  return hour >= 7 ? hour : hour + 12;
};

const stripStartTime = (text: string, now: Date): { rest: string; startAt: string } | null => {
  const match = text.match(TIME_RE);
  if (!match) {
    return null;
  }
  const [, before, dayBefore, atHour, atMin, atMer, colHour, colMin, colMer, merHour, merMer, dayAfter] = match;
  const rawHour = atHour ?? colHour ?? merHour;
  const minute = Number(atMin ?? colMin ?? 0);
  const hour = resolveHour(Number(rawHour), atMer ?? colMer ?? merMer);
  if (hour === null) {
    return null;
  }
  // A dangling "at" can be left in front when the time itself carried am/pm ("at 9pm").
  let rest = before.trim().replace(/(?:^|\s+)(?:at|@)$/i, '').trim();
  let day = (dayBefore ?? dayAfter)?.toLowerCase();
  if (!day) {
    // "Gym tomorrow 6pm" leaves "Gym tomorrow" in front of the time.
    const leading = rest.match(LEADING_DAY_RE);
    if (leading) {
      rest = leading[1].trim().replace(/(?:^|\s+)(?:at|@)$/i, '').trim();
      day = leading[2].toLowerCase();
    }
  }
  if (!rest) {
    return null;
  }
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  if (day === 'tomorrow' || day === 'tmrw') {
    start.setDate(start.getDate() + 1);
  } else if (!day && start.getTime() <= now.getTime()) {
    // A time that has already passed today means the next one.
    start.setDate(start.getDate() + 1);
  }
  return { rest, startAt: start.toISOString() };
};

export const parseQuickAdd = (input: string, now: Date = new Date()): ParsedTask => {
  const text = input.trim();
  let title = text;
  let seconds: number | undefined;
  let startAt: string | undefined;
  // Duration and start time can come in either order at the end of the line.
  for (let pass = 0; pass < 2; pass += 1) {
    if (seconds === undefined) {
      const duration = stripDuration(title);
      if (duration) {
        title = duration.rest;
        seconds = duration.seconds;
        continue;
      }
    }
    if (startAt === undefined) {
      const start = stripStartTime(title, now);
      if (start) {
        title = start.rest;
        startAt = start.startAt;
        continue;
      }
    }
    break;
  }
  if (seconds === undefined && startAt === undefined) {
    return { title: text };
  }
  const parsed: ParsedTask = { title };
  if (seconds !== undefined) parsed.seconds = seconds;
  if (startAt !== undefined) parsed.startAt = startAt;
  return parsed;
};

export const parseTaskLines = (text: string, now: Date = new Date()): ParsedTask[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseQuickAdd(line, now))
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
