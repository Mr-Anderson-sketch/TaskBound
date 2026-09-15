// core/parse — natural-language capture parser. Pure TypeScript, no Electron/Node APIs,
// no Date.now(): the caller passes `now`. See docs/PLAN.md Task 2.1 and
// .superpowers/sdd/PLAN/task-2.1-brief.md for the grammar this implements.
import { nextMonday, addMonths, lastDayOfMonth } from 'date-fns';
import type { Due, Rule, Ymd, Hm } from './types';
import { ymd, parseYmd, addDays } from './dates';

export interface ParsedCapture {
  title: string;
  due?: Due;
  plannedSeconds?: number;
  tags: string[];
  listName?: string;
  recurrence?: Rule;
  tokens: Array<{ kind: 'when' | 'timer' | 'tag' | 'list' | 'repeat'; text: string; label: string }>;
}

const TITLE_MAX = 200;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

// ---- weekday / month lookups -------------------------------------------------

const DOW: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6
};
const DOW_ALT = Object.keys(DOW).sort((a, b) => b.length - a.length).join('|');
const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const MONTHS: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11
};
const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Days per month, 0-indexed; Feb is the generous 29 so a leap-year Feb 29 always
// validates (the exact year isn't known yet at match time for year-less forms).
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// ---- range validation (invalid literal dates/times/numbers stay unconsumed) ----

function isValidMonthDay(month: number, day: number): boolean {
  return month >= 0 && month <= 11 && day >= 1 && day <= DAYS_IN_MONTH[month];
}
function isValidHour24(h: number): boolean {
  return h >= 0 && h <= 23;
}
function isValidHour12(h: number): boolean {
  return h >= 1 && h <= 12;
}
function isValidMinute(m: number): boolean {
  return m >= 0 && m <= 59;
}
function isValidDayOfMonth(d: number): boolean {
  return d >= 1 && d <= 31;
}
function isValidRepeatN(n: number): boolean {
  return n >= 1 && n <= 365;
}

// ---- small pure date/time helpers --------------------------------------------

/** Smallest date > `from` (1..7 days ahead) whose local weekday is in `dows`. */
function nextMatchingDow(from: Ymd, dows: number[]): Ymd {
  for (let i = 1; i <= 7; i++) {
    const cand = addDays(from, i);
    if (dows.includes(parseYmd(cand).getDay())) return cand;
  }
  return from; // unreachable: dows is always non-empty
}

/** `from` itself if its weekday is in `dows`, else the next matching weekday. */
function todayOrNextMatchingDow(from: Ymd, dows: number[]): Ymd {
  return dows.includes(parseYmd(from).getDay()) ? from : nextMatchingDow(from, dows);
}

/**
 * Resolves a due date against `allowed` weekdays ('any' = every day, matching the
 * "no explicit date" and "daily" cases), bumping past today when a time is given
 * that has already passed relative to `nowMinutes`.
 */
function resolveDateWithTime(today: Ymd, allowed: number[] | 'any', time: Hm | undefined, nowMinutes: number): Ymd {
  const dows = allowed === 'any' ? [0, 1, 2, 3, 4, 5, 6] : allowed;
  const tentative = todayOrNextMatchingDow(today, dows);
  if (time && tentative === today) {
    const [h, m] = time.split(':').map(Number);
    if (h * 60 + m <= nowMinutes) return nextMatchingDow(today, dows);
  }
  return tentative;
}

/** First occurrence of `dayOfMonth` on/after `today`, clamped to month length. */
function firstMonthlyOccurrence(today: Ymd, dayOfMonth: number): Ymd {
  const d = parseYmd(today);
  const todayDom = d.getDate();
  let year = d.getFullYear();
  let month = d.getMonth();
  if (dayOfMonth < todayDom) {
    month += 1;
    if (month > 11) { month = 0; year += 1; }
  }
  const lastDay = new Date(year, month + 1, 0).getDate();
  return ymd(new Date(year, month, Math.min(dayOfMonth, lastDay)).getTime());
}

/** Next month's `dayOfMonth` strictly after `today`'s month, clamped to month length. */
function nextMonthlyOccurrence(today: Ymd, dayOfMonth: number): Ymd {
  const d = parseYmd(today);
  let year = d.getFullYear();
  let month = d.getMonth() + 1;
  if (month > 11) { month = 0; year += 1; }
  const lastDay = new Date(year, month + 1, 0).getDate();
  return ymd(new Date(year, month, Math.min(dayOfMonth, lastDay)).getTime());
}

/** Resolves a year-less month/day pair against `today`, rolling to next year if past. */
function resolveYearlessDate(month: number, day: number, today: Ymd): Ymd {
  const year = parseYmd(today).getFullYear();
  let d = new Date(year, month, day);
  if (ymd(d.getTime()) < today) d = new Date(year + 1, month, day);
  return ymd(d.getTime());
}

function to24h(hour: number, minute: number, ampm?: string): Hm {
  let h = hour;
  if (ampm) {
    const isPm = ampm.toLowerCase() === 'pm';
    h = h % 12;
    if (isPm) h += 12;
  }
  return `${pad2(h)}:${pad2(minute)}`;
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

// ---- labels --------------------------------------------------------------

function dateLabel(d: Ymd): string {
  const parsed = parseYmd(d);
  return `${DOW_SHORT[parsed.getDay()]} ${parsed.getDate()} ${MONTH_SHORT[parsed.getMonth()]}`;
}

function timeLabel12(t: Hm): string {
  const [h, m] = t.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${pad2(m)} ${period}`;
}

function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h} h ${m} min`;
  if (h > 0) return `${h} h`;
  return `${m} min`;
}

function recurrenceLabel(r: Rule): string {
  switch (r.kind) {
    case 'daily': return 'Every day';
    case 'weekdays': return 'Every weekday';
    case 'weekly': return `Every ${r.days.map((d) => DOW_SHORT[d]).join(', ')}`;
    case 'monthly': return `Monthly on the ${ordinal(r.dayOfMonth)}`;
    case 'everyN': return `Every ${r.n} ${r.unit}${r.n === 1 ? '' : 's'}`;
  }
}

// ---- quoted-input escape hatch --------------------------------------------

function detectQuoted(raw: string): string | null {
  const t = raw.trim();
  if (t.length < 2) return null;
  const first = t[0];
  const last = t[t.length - 1];
  const isOpen = first === '"' || first === '“';
  const isClose = last === '"' || last === '”';
  if (isOpen && isClose) return t.slice(1, -1);
  return null;
}

function truncateTitle(t: string): string {
  return t.length > TITLE_MAX ? t.slice(0, TITLE_MAX) : t;
}

function blank(text: string, start: number, end: number): string {
  return text.slice(0, start) + ' '.repeat(end - start) + text.slice(end);
}

// ---- recurrence matching ---------------------------------------------------

interface RecurrenceMatch { start: number; end: number; rule: Rule }

function matchRecurrence(work: string): RecurrenceMatch | undefined {
  const monthlyOnThe = new RegExp(`\\b(?:every\\s+month\\s+on\\s+the|monthly\\s+on\\s+the)\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i').exec(work);
  if (monthlyOnThe) {
    const dayOfMonth = Number(monthlyOnThe[1]);
    if (isValidDayOfMonth(dayOfMonth)) {
      return { start: monthlyOnThe.index, end: monthlyOnThe.index + monthlyOnThe[0].length, rule: { kind: 'monthly', dayOfMonth } };
    }
    // Out-of-range day (e.g. "on the 45th"): fall through without consuming anything —
    // and `monthlyBare` below is guarded so it doesn't scavenge the bare "monthly" word
    // out of this same invalid phrase.
  }
  const everyNDays = /\bevery\s+(\d{1,3})\s+days?\b/i.exec(work);
  if (everyNDays && isValidRepeatN(Number(everyNDays[1]))) {
    return { start: everyNDays.index, end: everyNDays.index + everyNDays[0].length, rule: { kind: 'everyN', n: Number(everyNDays[1]), unit: 'day', anchor: '' } };
  }
  const everyNWeeks = /\bevery\s+(\d{1,3})\s+weeks?\b/i.exec(work);
  if (everyNWeeks && isValidRepeatN(Number(everyNWeeks[1]))) {
    return { start: everyNWeeks.index, end: everyNWeeks.index + everyNWeeks[0].length, rule: { kind: 'everyN', n: Number(everyNWeeks[1]), unit: 'week', anchor: '' } };
  }
  // Negative lookahead keeps this from matching the bare word "monthly" inside an
  // "monthly on the Nth" phrase whose Nth was out of range and therefore unconsumed above.
  const monthlyBare = /\bmonthly\b(?!\s+on\s+the)/i.exec(work);
  if (monthlyBare) {
    // Placeholder `dayOfMonth: -1`: the real day is derived by the caller from an
    // explicit due date when one is present, else today's day-of-month (see parseCapture).
    return { start: monthlyBare.index, end: monthlyBare.index + monthlyBare[0].length, rule: { kind: 'monthly', dayOfMonth: -1 } };
  }
  const daily = /\b(?:every\s+day|daily)\b/i.exec(work);
  if (daily) {
    return { start: daily.index, end: daily.index + daily[0].length, rule: { kind: 'daily' } };
  }
  const weekdaysWord = /\bevery\s+(?:weekday|weekdays)\b/i.exec(work);
  if (weekdaysWord) {
    return { start: weekdaysWord.index, end: weekdaysWord.index + weekdaysWord[0].length, rule: { kind: 'weekdays' } };
  }
  const weekdayList = new RegExp(`\\bevery\\s+((?:${DOW_ALT})(?:\\s*,\\s*(?:${DOW_ALT}))*)\\b`, 'i').exec(work);
  if (weekdayList) {
    const days = Array.from(new Set(weekdayList[1].split(/\s*,\s*/).map((w) => DOW[w.toLowerCase()]))).sort((a, b) => a - b);
    return { start: weekdayList.index, end: weekdayList.index + weekdayList[0].length, rule: { kind: 'weekly', days } };
  }
  const weeklyBare = /\bweekly\b/i.exec(work);
  if (weeklyBare) {
    // Placeholder `days: [-1]`: the real weekday is derived by the caller from an
    // explicit due date when one is present, else today's weekday (see parseCapture).
    return { start: weeklyBare.index, end: weeklyBare.index + weeklyBare[0].length, rule: { kind: 'weekly', days: [-1] } };
  }
  return undefined;
}

// ---- date matching ----------------------------------------------------------

type DateMatch =
  | { start: number; end: number; kind: 'literal'; date: Ymd }
  | { start: number; end: number; kind: 'weekday'; target: number };

function matchDate(work: string, today: Ymd): DateMatch | undefined {
  const m = (re: RegExp) => re.exec(work) ?? undefined;

  const todayWord = m(/\btoday\b/i);
  if (todayWord) return { start: todayWord.index, end: todayWord.index + todayWord[0].length, kind: 'literal', date: today };

  const tomorrowWord = m(/\b(?:tomorrow|tmrw)\b/i);
  if (tomorrowWord) return { start: tomorrowWord.index, end: tomorrowWord.index + tomorrowWord[0].length, kind: 'literal', date: addDays(today, 1) };

  const yesterdayWord = m(/\byesterday\b/i);
  if (yesterdayWord) return { start: yesterdayWord.index, end: yesterdayWord.index + yesterdayWord[0].length, kind: 'literal', date: today };

  const eomWord = m(/\beom\b/i);
  if (eomWord) return { start: eomWord.index, end: eomWord.index + eomWord[0].length, kind: 'literal', date: ymd(lastDayOfMonth(parseYmd(today)).getTime()) };

  const nextWeekWord = m(/\bnext\s+week\b/i);
  if (nextWeekWord) return { start: nextWeekWord.index, end: nextWeekWord.index + nextWeekWord[0].length, kind: 'literal', date: ymd(nextMonday(parseYmd(today)).getTime()) };

  const nextMonthWord = m(/\bnext\s+month\b/i);
  if (nextMonthWord) {
    const firstOfMonth = new Date(parseYmd(today).getFullYear(), parseYmd(today).getMonth(), 1);
    const firstOfNext = addMonths(firstOfMonth, 1);
    return { start: nextMonthWord.index, end: nextMonthWord.index + nextMonthWord[0].length, kind: 'literal', date: ymd(firstOfNext.getTime()) };
  }

  const inNDays = m(/\bin\s+(\d{1,3})\s+days?\b/i);
  if (inNDays && isValidRepeatN(Number(inNDays[1]))) return { start: inNDays.index, end: inNDays.index + inNDays[0].length, kind: 'literal', date: addDays(today, Number(inNDays[1])) };

  const inNWeeks = m(/\bin\s+(\d{1,3})\s+weeks?\b/i);
  if (inNWeeks && isValidRepeatN(Number(inNWeeks[1]))) return { start: inNWeeks.index, end: inNWeeks.index + inNWeeks[0].length, kind: 'literal', date: addDays(today, Number(inNWeeks[1]) * 7) };

  const isoDate = m(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoDate && isValidMonthDay(Number(isoDate[2]) - 1, Number(isoDate[3]))) {
    return { start: isoDate.index, end: isoDate.index + isoDate[0].length, kind: 'literal', date: `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}` };
  }

  const slashDate = m(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (slashDate && isValidMonthDay(Number(slashDate[2]) - 1, Number(slashDate[1]))) {
    return { start: slashDate.index, end: slashDate.index + slashDate[0].length, kind: 'literal', date: resolveYearlessDate(Number(slashDate[2]) - 1, Number(slashDate[1]), today) };
  }

  const monthDay = m(new RegExp(`\\b(${MONTH_ALT})\\s+(\\d{1,2})\\b`, 'i'));
  if (monthDay && isValidMonthDay(MONTHS[monthDay[1].toLowerCase()], Number(monthDay[2]))) {
    return { start: monthDay.index, end: monthDay.index + monthDay[0].length, kind: 'literal', date: resolveYearlessDate(MONTHS[monthDay[1].toLowerCase()], Number(monthDay[2]), today) };
  }

  const dayMonth = m(new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_ALT})\\b`, 'i'));
  if (dayMonth && isValidMonthDay(MONTHS[dayMonth[2].toLowerCase()], Number(dayMonth[1]))) {
    return { start: dayMonth.index, end: dayMonth.index + dayMonth[0].length, kind: 'literal', date: resolveYearlessDate(MONTHS[dayMonth[2].toLowerCase()], Number(dayMonth[1]), today) };
  }

  const weekday = m(new RegExp(`\\b(${DOW_ALT})\\b`, 'i'));
  if (weekday) return { start: weekday.index, end: weekday.index + weekday[0].length, kind: 'weekday', target: DOW[weekday[1].toLowerCase()] };

  return undefined;
}

// ---- time matching ------------------------------------------------------

interface TimeMatch { start: number; end: number; time: Hm }

function matchTime(work: string): TimeMatch | undefined {
  const colon = /\b(\d{1,2}):(\d{2})\s*([ap]m)?\b/i.exec(work);
  if (colon) {
    const h = Number(colon[1]);
    const min = Number(colon[2]);
    const hourOk = colon[3] ? isValidHour12(h) : isValidHour24(h);
    if (hourOk && isValidMinute(min)) {
      return { start: colon.index, end: colon.index + colon[0].length, time: to24h(h, min, colon[3]) };
    }
    // Invalid (e.g. "9:75"): fall through, but don't let `atN` below scavenge the hour
    // back out of this same expression — its `(?!:)` guard keeps it off a trailing colon.
  }

  const ampm = /\b(\d{1,2})\s*([ap]m)\b/i.exec(work);
  if (ampm && isValidHour12(Number(ampm[1]))) {
    return { start: ampm.index, end: ampm.index + ampm[0].length, time: to24h(Number(ampm[1]), 0, ampm[2]) };
  }

  // `(?!:)` keeps this off the hour of a colon-time that failed validation above
  // (e.g. "at 9:75" must stay fully literal, not partially consumed as "at 9").
  const atN = /\bat\s+(\d{1,2})(?!:)\b/i.exec(work);
  if (atN && isValidHour24(Number(atN[1]))) {
    return { start: atN.index, end: atN.index + atN[0].length, time: to24h(Number(atN[1]), 0) };
  }

  const noon = /\bnoon\b/i.exec(work);
  if (noon) return { start: noon.index, end: noon.index + noon[0].length, time: '12:00' };

  const midnight = /\bmidnight\b/i.exec(work);
  if (midnight) return { start: midnight.index, end: midnight.index + midnight[0].length, time: '00:00' };

  const morning = /\bmorning\b/i.exec(work);
  if (morning) return { start: morning.index, end: morning.index + morning[0].length, time: '09:00' };

  const evening = /\bevening\b/i.exec(work);
  if (evening) return { start: evening.index, end: evening.index + evening[0].length, time: '18:00' };

  return undefined;
}

// ---- duration matching ---------------------------------------------------

interface DurationMatch { start: number; end: number; minutes: number }

function matchDuration(work: string): DurationMatch | undefined {
  // Space-separated compound form first (`1h 30m`, `1 h 30 min`, `2 hours 15 minutes`):
  // it must win over the compact/minutes-only matchers below, which would otherwise
  // claim only the "1h" part and leave a bare trailing number in the title.
  const compoundHM = /\b(?:for\s+)?(\d{1,3})\s*(?:h|hr|hrs|hour|hours)\s+(\d{1,3})\s*(?:m|min|mins|minute|minutes)\b/i.exec(work);
  if (compoundHM) return { start: compoundHM.index, end: compoundHM.index + compoundHM[0].length, minutes: Number(compoundHM[1]) * 60 + Number(compoundHM[2]) };

  const compact = /\b(\d{1,3})h(\d{1,2})?m?\b/i.exec(work);
  if (compact) return { start: compact.index, end: compact.index + compact[0].length, minutes: Number(compact[1]) * 60 + (compact[2] ? Number(compact[2]) : 0) };

  const forHours = /\bfor\s+(\d{1,3})\s*(?:h|hr|hrs|hour|hours)\b/i.exec(work);
  if (forHours) return { start: forHours.index, end: forHours.index + forHours[0].length, minutes: Number(forHours[1]) * 60 };

  const minutesWord = /\b(?:for\s+)?(\d{1,3})\s*(?:min|mins|minute|minutes)\b/i.exec(work);
  if (minutesWord) return { start: minutesWord.index, end: minutesWord.index + minutesWord[0].length, minutes: Number(minutesWord[1]) };

  const bareM = /\b(?:for\s+)?(\d{1,3})m\b/i.exec(work);
  if (bareM) return { start: bareM.index, end: bareM.index + bareM[0].length, minutes: Number(bareM[1]) };

  return undefined;
}

// ---- top level ------------------------------------------------------------

export function parseCapture(input: string, now: number, listNames: string[]): ParsedCapture {
  const quoted = detectQuoted(input);
  if (quoted !== null) {
    return { title: truncateTitle(quoted), tags: [], tokens: [] };
  }

  const today = ymd(now);
  const todayDow = parseYmd(today).getDay();
  const nowDate = new Date(now);
  const nowMinutes = nowDate.getHours() * 60 + nowDate.getMinutes();

  let work = input;
  const tags: string[] = [];
  const tokens: Array<{ kind: 'when' | 'timer' | 'tag' | 'list' | 'repeat'; text: string; label: string; start: number }> = [];

  // 1. tags (all occurrences, deduplicated, lowercase)
  work = work.replace(/(?<=^|\s)#([A-Za-z0-9_-]+)/g, (full: string, word: string, offset: number) => {
    const value = word.toLowerCase();
    if (!tags.includes(value)) {
      tags.push(value);
      tokens.push({ kind: 'tag', text: full, label: `#${value}`, start: offset });
    }
    return ' '.repeat(full.length);
  });

  // 2. list (first occurrence only)
  let listName: string | undefined;
  {
    const m = /(?<=^|\s)[@/]([A-Za-z][A-Za-z0-9_-]*)/.exec(work);
    if (m) {
      const raw = m[1];
      const known = listNames.find((n) => n.toLowerCase() === raw.toLowerCase());
      // `listName` is always the raw typed text (case as typed) — the caller does its
      // own case-insensitive lookup/creation against listNames; only the chip label
      // shows the canonical name when one matches.
      listName = raw;
      tokens.push({ kind: 'list', text: m[0], label: known ?? raw, start: m.index });
      work = blank(work, m.index, m.index + m[0].length);
    }
  }

  // 3. recurrence (first match by priority). Bare `weekly`/`monthly` carry a sentinel
  // (`days: [-1]` / `dayOfMonth: -1`) until the combine step below resolves them —
  // against an explicit due date when one is typed, else today — so the 'repeat' token
  // (pushed after that resolution) always describes the real, final recurrence.
  let recurrence: Rule | undefined;
  let recurrenceBare: 'weekly' | 'monthly' | undefined;
  let recFound: { start: number; end: number } | undefined;
  {
    const found = matchRecurrence(work);
    if (found) {
      recFound = { start: found.start, end: found.end };
      recurrence = found.rule;
      if (recurrence.kind === 'monthly' && recurrence.dayOfMonth === -1) recurrenceBare = 'monthly';
      if (recurrence.kind === 'weekly' && recurrence.days[0] === -1) recurrenceBare = 'weekly';
      work = blank(work, found.start, found.end);
    }
  }

  // 4. date (first match by priority)
  const dateFound = matchDate(work, today);
  if (dateFound) work = blank(work, dateFound.start, dateFound.end);

  // 5. time (first match by priority)
  const timeFound = matchTime(work);
  if (timeFound) work = blank(work, timeFound.start, timeFound.end);

  // 6. duration (first match by priority)
  const durationFound = matchDuration(work);
  if (durationFound) {
    tokens.push({ kind: 'timer', text: input.slice(durationFound.start, durationFound.end), label: durationLabel(durationFound.minutes), start: durationFound.start });
    work = blank(work, durationFound.start, durationFound.end);
  }

  // ---- combine due + recurrence ----
  const dueTime = timeFound?.time;

  // The date the input literally specifies, independent of any recurrence — resolved
  // exactly as it would be with no recurrence at all (weekday words still get the
  // today-or-next-occurrence, bumped-past-a-passed-time treatment).
  const explicitDate: Ymd | undefined = dateFound
    ? dateFound.kind === 'literal'
      ? dateFound.date
      : resolveDateWithTime(today, [dateFound.target], dueTime, nowMinutes)
    : undefined;

  // Bare recurrence parameters are implicit: derive them from the explicit due date
  // when one was typed, else from today.
  if (recurrenceBare === 'monthly') {
    const dayOfMonth = explicitDate ? parseYmd(explicitDate).getDate() : parseYmd(today).getDate();
    recurrence = { kind: 'monthly', dayOfMonth };
  } else if (recurrenceBare === 'weekly') {
    const dow = explicitDate ? parseYmd(explicitDate).getDay() : todayDow;
    recurrence = { kind: 'weekly', days: [dow] };
  }

  let dueDate: Ymd | undefined;

  if (recurrence && explicitDate) {
    // Explicit recurrence parameters win over a contradicting explicit date: the due
    // date becomes the first occurrence on/after the typed date, not the typed date
    // itself (e.g. "every monday sep 16" when the 16th is a Wednesday).
    if (recurrence.kind === 'everyN') {
      dueDate = explicitDate;
      recurrence = { ...recurrence, anchor: explicitDate };
    } else if (recurrence.kind === 'monthly') {
      dueDate = firstMonthlyOccurrence(explicitDate, recurrence.dayOfMonth);
    } else {
      const allowed = recurrence.kind === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : recurrence.kind === 'weekdays' ? [1, 2, 3, 4, 5] : recurrence.days;
      dueDate = todayOrNextMatchingDow(explicitDate, allowed);
    }
  } else if (recurrence) {
    if (recurrence.kind === 'monthly') {
      dueDate = firstMonthlyOccurrence(today, recurrence.dayOfMonth);
      if (dueTime && dueDate === today) {
        const [h, m] = dueTime.split(':').map(Number);
        if (h * 60 + m <= nowMinutes) dueDate = nextMonthlyOccurrence(today, recurrence.dayOfMonth);
      }
    } else if (recurrence.kind === 'everyN') {
      dueDate = today;
      recurrence = { ...recurrence, anchor: dueDate };
    } else {
      const allowed = recurrence.kind === 'daily' ? 'any' : recurrence.kind === 'weekdays' ? [1, 2, 3, 4, 5] : recurrence.days;
      dueDate = resolveDateWithTime(today, allowed, dueTime, nowMinutes);
    }
  } else if (explicitDate) {
    dueDate = explicitDate;
  } else if (timeFound) {
    dueDate = resolveDateWithTime(today, 'any', dueTime, nowMinutes);
  }

  const due: Due | undefined = dueDate ? (dueTime ? { date: dueDate, time: dueTime } : { date: dueDate }) : undefined;

  if (recFound && recurrence) {
    tokens.push({ kind: 'repeat', text: input.slice(recFound.start, recFound.end), label: recurrenceLabel(recurrence), start: recFound.start });
  }

  // ---- 'when' token: only for text actually consumed from the input ----
  if (dateFound && timeFound) {
    const start = Math.min(dateFound.start, timeFound.start);
    const end = Math.max(dateFound.end, timeFound.end);
    tokens.push({ kind: 'when', text: input.slice(start, end), label: `${dateLabel(due!.date)} · ${timeLabel12(due!.time!)}`, start });
  } else if (dateFound) {
    tokens.push({ kind: 'when', text: input.slice(dateFound.start, dateFound.end), label: dateLabel(due!.date), start: dateFound.start });
  } else if (timeFound) {
    tokens.push({ kind: 'when', text: input.slice(timeFound.start, timeFound.end), label: timeLabel12(due!.time!), start: timeFound.start });
  }

  // ---- title ----
  let title = work.replace(/\s+/g, ' ').trim();
  if (title === '') title = input.trim();
  title = truncateTitle(title);

  tokens.sort((a, b) => a.start - b.start);

  return {
    title,
    due,
    plannedSeconds: durationFound ? durationFound.minutes * 60 : undefined,
    tags,
    listName,
    recurrence,
    tokens: tokens.map(({ kind, text, label }) => ({ kind, text, label }))
  };
}
