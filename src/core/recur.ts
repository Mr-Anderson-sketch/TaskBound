// core/recur — the recurrence engine: computing the next occurrence of a repeating
// task's `Rule`, and a human label for it. Pure TypeScript, no Electron/Node APIs,
// no Date.now(). All calendar math goes through `dates.ts`'s local-calendar helpers
// (never `toISOString`/UTC) plus `date-fns` for month-length and day-count arithmetic.
// See docs/PLAN.md Task 3.3 and .superpowers/sdd/PLAN/task-3.3-brief.md.
import { addMonths, differenceInCalendarDays, getDaysInMonth } from 'date-fns';
import type { Rule, Ymd } from './types';
import { addDays, parseYmd, ymd } from './dates';

/** Smallest date, strictly after `after`, whose local weekday is Mon..Fri. */
function nextWeekday(after: Ymd): Ymd {
  let candidate = addDays(after, 1);
  for (let i = 0; i < 7; i++) {
    const dow = parseYmd(candidate).getDay();
    if (dow >= 1 && dow <= 5) return candidate;
    candidate = addDays(candidate, 1);
  }
  /* c8 ignore next */
  return candidate; // unreachable: Mon..Fri is always hit within 7 days
}

/** Smallest date, strictly after `after`, whose local weekday is in `days` (non-empty). */
function nextWeeklyDay(after: Ymd, days: number[]): Ymd {
  let candidate = addDays(after, 1);
  for (let i = 0; i < 7; i++) {
    if (days.includes(parseYmd(candidate).getDay())) return candidate;
    candidate = addDays(candidate, 1);
  }
  /* c8 ignore next */
  return candidate; // unreachable: `days` is always non-empty per Rule's contract
}

/** The first month (starting with `after`'s month) whose `dayOfMonth`, clamped to that
 * month's length, is strictly after `after`. The clamp is recomputed from `dayOfMonth`
 * every month (never carried over from a previous month's clamped value), so a chain
 * like 31 Jan -> 28 Feb -> 31 Mar never drifts to 28 in March. Bounded to 1200 months
 * (100 years) so a pathological input can never loop forever. */
function nextMonthly(after: Ymd, dayOfMonth: number): Ymd {
  const afterDate = parseYmd(after);
  let cursor = new Date(afterDate.getFullYear(), afterDate.getMonth(), 1);
  for (let i = 0; i < 1200; i++) {
    const daysInMonth = getDaysInMonth(cursor);
    const day = Math.min(dayOfMonth, daysInMonth);
    const candidate = ymd(new Date(cursor.getFullYear(), cursor.getMonth(), day).getTime());
    if (candidate > after) return candidate;
    cursor = addMonths(cursor, 1);
  }
  throw new Error(`nextOccurrence: monthly search for day ${dayOfMonth} exceeded bound after ${after}`);
}

/** Smallest `anchor + k * n * (1 day | 7 days)` (k >= 0 integer) strictly after `after`.
 * When `after < anchor`, k = 0 and the answer is `anchor` itself. Day arithmetic is done
 * via calendar-day counts (`differenceInCalendarDays`/`addDays`), never milliseconds, so
 * this is correct across DST transitions. */
function nextEveryN(after: Ymd, n: number, unit: 'day' | 'week', anchor: Ymd): Ymd {
  const stepDays = unit === 'day' ? n : n * 7;
  const diff = differenceInCalendarDays(parseYmd(after), parseYmd(anchor));
  const k = diff < 0 ? 0 : Math.floor(diff / stepDays) + 1;
  return addDays(anchor, k * stepDays);
}

/** The next occurrence of `rule`, strictly after `after`. Pure. */
export function nextOccurrence(rule: Rule, after: Ymd): Ymd {
  switch (rule.kind) {
    case 'daily':
      return addDays(after, 1);
    case 'weekdays':
      return nextWeekday(after);
    case 'weekly':
      return nextWeeklyDay(after, rule.days);
    case 'monthly':
      return nextMonthly(after, rule.dayOfMonth);
    case 'everyN':
      return nextEveryN(after, rule.n, rule.unit, rule.anchor);
  }
}

const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Monday-first display order (Sunday last), per the controller ruling.
const MON_FIRST_ORDER = [1, 2, 3, 4, 5, 6, 0];

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

/** Human, sentence-case description of `rule` (e.g. for the recurrence editor and
 * task rows): 'Every day', 'Every weekday', 'Every Mon, Wed, Fri', 'Every Monday'
 * (single weekly day), 'Monthly on the 31st', 'Every 3 days', 'Every 2 weeks'. */
export function describeRule(rule: Rule): string {
  switch (rule.kind) {
    case 'daily':
      return 'Every day';
    case 'weekdays':
      return 'Every weekday';
    case 'weekly': {
      if (rule.days.length === 1) return `Every ${DOW_FULL[rule.days[0]]}`;
      const ordered = MON_FIRST_ORDER.filter((d) => rule.days.includes(d));
      return `Every ${ordered.map((d) => DOW_SHORT[d]).join(', ')}`;
    }
    case 'monthly':
      return `Monthly on the ${ordinal(rule.dayOfMonth)}`;
    case 'everyN': {
      if (rule.n === 1 && rule.unit === 'day') return 'Every day';
      if (rule.n === 1 && rule.unit === 'week') return 'Every week';
      return `Every ${rule.n} ${rule.unit}s`;
    }
  }
}
