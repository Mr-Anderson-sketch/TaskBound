import { describe, it, expect } from 'vitest';
import { nextOccurrence, describeRule } from '../../src/core/recur';
import { addDays } from '../../src/core/dates';
import type { Rule } from '../../src/core/types';
import { rows } from './parseRows';

describe('nextOccurrence: daily', () => {
  it('is after + 1 day', () => {
    expect(nextOccurrence({ kind: 'daily' }, '2026-09-14')).toBe('2026-09-15');
  });

  it('crosses the US spring-forward DST boundary (2026-03-08) via calendar-day math', () => {
    expect(nextOccurrence({ kind: 'daily' }, '2026-03-07')).toBe('2026-03-08');
  });

  it('crosses the US fall-back DST boundary (2026-11-01) via calendar-day math', () => {
    expect(nextOccurrence({ kind: 'daily' }, '2026-10-31')).toBe('2026-11-01');
  });
});

describe('nextOccurrence: weekdays', () => {
  const rule: Rule = { kind: 'weekdays' };
  it('Friday -> Monday', () => {
    expect(nextOccurrence(rule, '2026-09-18')).toBe('2026-09-21'); // Fri -> Mon
  });
  it('Saturday -> Monday', () => {
    expect(nextOccurrence(rule, '2026-09-19')).toBe('2026-09-21'); // Sat -> Mon
  });
  it('Sunday -> Monday', () => {
    expect(nextOccurrence(rule, '2026-09-20')).toBe('2026-09-21'); // Sun -> Mon
  });
  it('a mid-week day advances by one', () => {
    expect(nextOccurrence(rule, '2026-09-16')).toBe('2026-09-17'); // Wed -> Thu
  });
});

describe('nextOccurrence: weekly', () => {
  const rule: Rule = { kind: 'weekly', days: [1, 3, 5] }; // Mon, Wed, Fri
  it('Wednesday -> Friday', () => {
    expect(nextOccurrence(rule, '2026-09-16')).toBe('2026-09-18'); // Wed -> Fri
  });
  it('Friday -> Monday (wraps the week)', () => {
    expect(nextOccurrence(rule, '2026-09-18')).toBe('2026-09-21'); // Fri -> Mon
  });
});

describe('nextOccurrence: monthly (clamp is recomputed from the rule every month)', () => {
  it('31 Jan -> 28 Feb 2026 -> 31 Mar -> 30 Apr (never drifts to 28 in March)', () => {
    const rule: Rule = { kind: 'monthly', dayOfMonth: 31 };
    const feb = nextOccurrence(rule, '2026-01-31');
    expect(feb).toBe('2026-02-28');
    const mar = nextOccurrence(rule, feb);
    expect(mar).toBe('2026-03-31');
    const apr = nextOccurrence(rule, mar);
    expect(apr).toBe('2026-04-30');
  });

  it('leap year: the 29th chains Jan -> Feb 29 -> Mar 29 in 2028', () => {
    const rule: Rule = { kind: 'monthly', dayOfMonth: 29 };
    const feb = nextOccurrence(rule, '2028-01-29');
    expect(feb).toBe('2028-02-29');
    const mar = nextOccurrence(rule, feb);
    expect(mar).toBe('2028-03-29');
  });

  it('the 31st from 28 Feb 2026 lands on 31 Mar, not clamped again', () => {
    expect(nextOccurrence({ kind: 'monthly', dayOfMonth: 31 }, '2026-02-28')).toBe('2026-03-31');
  });
});

describe('nextOccurrence: everyN', () => {
  it('days: after before the anchor returns the anchor itself', () => {
    expect(nextOccurrence({ kind: 'everyN', n: 3, unit: 'day', anchor: '2026-09-01' }, '2026-08-25')).toBe('2026-09-01');
  });
  it('days: after exactly on the anchor steps one interval forward', () => {
    expect(nextOccurrence({ kind: 'everyN', n: 3, unit: 'day', anchor: '2026-09-01' }, '2026-09-01')).toBe('2026-09-04');
  });
  it('days: after past the anchor finds the next multiple strictly after it', () => {
    expect(nextOccurrence({ kind: 'everyN', n: 3, unit: 'day', anchor: '2026-09-01' }, '2026-09-05')).toBe('2026-09-07');
  });
  it('weeks: after before the anchor returns the anchor itself', () => {
    expect(nextOccurrence({ kind: 'everyN', n: 2, unit: 'week', anchor: '2026-09-01' }, '2026-08-01')).toBe('2026-09-01');
  });
  it('weeks: after exactly on the anchor steps one interval forward', () => {
    expect(nextOccurrence({ kind: 'everyN', n: 2, unit: 'week', anchor: '2026-09-01' }, '2026-09-01')).toBe('2026-09-15');
  });
  it('weeks: after past the anchor finds the next multiple strictly after it', () => {
    expect(nextOccurrence({ kind: 'everyN', n: 2, unit: 'week', anchor: '2026-09-01' }, '2026-09-20')).toBe('2026-09-29');
  });
});

describe('describeRule', () => {
  const table: Array<[Rule, string]> = [
    [{ kind: 'daily' }, 'Every day'],
    [{ kind: 'weekdays' }, 'Every weekday'],
    [{ kind: 'weekly', days: [1, 3, 5] }, 'Every Mon, Wed, Fri'],
    [{ kind: 'weekly', days: [1] }, 'Every Monday'],
    // Monday-first, Sunday-last ordering regardless of input order.
    [{ kind: 'weekly', days: [0, 1] }, 'Every Mon, Sun'],
    [{ kind: 'monthly', dayOfMonth: 1 }, 'Monthly on the 1st'],
    [{ kind: 'monthly', dayOfMonth: 2 }, 'Monthly on the 2nd'],
    [{ kind: 'monthly', dayOfMonth: 3 }, 'Monthly on the 3rd'],
    [{ kind: 'monthly', dayOfMonth: 4 }, 'Monthly on the 4th'],
    [{ kind: 'monthly', dayOfMonth: 11 }, 'Monthly on the 11th'],
    [{ kind: 'monthly', dayOfMonth: 12 }, 'Monthly on the 12th'],
    [{ kind: 'monthly', dayOfMonth: 13 }, 'Monthly on the 13th'],
    [{ kind: 'monthly', dayOfMonth: 21 }, 'Monthly on the 21st'],
    [{ kind: 'monthly', dayOfMonth: 22 }, 'Monthly on the 22nd'],
    [{ kind: 'monthly', dayOfMonth: 23 }, 'Monthly on the 23rd'],
    [{ kind: 'monthly', dayOfMonth: 31 }, 'Monthly on the 31st'],
    [{ kind: 'everyN', n: 3, unit: 'day', anchor: '2026-09-01' }, 'Every 3 days'],
    [{ kind: 'everyN', n: 2, unit: 'week', anchor: '2026-09-01' }, 'Every 2 weeks'],
    [{ kind: 'everyN', n: 1, unit: 'week', anchor: '2026-09-01' }, 'Every week'],
    [{ kind: 'everyN', n: 1, unit: 'day', anchor: '2026-09-01' }, 'Every day']
  ];
  it.each(table)('%o -> %s', (rule, expected) => {
    expect(describeRule(rule)).toBe(expected);
  });
});

// Task 3.3 ruling 4: cross-check nextOccurrence against every parseCapture table row
// (shared with tests/core/parse.test.ts via ./parseRows) whose expected result has
// both `recurrence` and `due`. `addDays(due.date, -1)` recovers a plausible "day
// before the due date" the recurrence's own arithmetic must also produce that due
// date from — if this fails, it is a real disagreement between the parser and the
// recurrence engine, not a bug to silently paper over in either.
describe('nextOccurrence agrees with the parser (parseRows cross-check)', () => {
  const qualifying = rows.filter(([, expected]) => expected.recurrence !== undefined && expected.due !== undefined);

  it('has at least one qualifying row (sanity check on the filter itself)', () => {
    expect(qualifying.length).toBeGreaterThan(0);
  });

  it.each(qualifying)('%s', (_input, expected) => {
    const rule = expected.recurrence as Rule;
    const due = expected.due!;
    expect(nextOccurrence(rule, addDays(due.date, -1))).toBe(due.date);
  });
});
