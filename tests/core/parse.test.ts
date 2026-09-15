import { describe, it, expect } from 'vitest';
import { parseCapture } from '../../src/core/parse';
import { ymd, parseYmd } from '../../src/core/dates';
import { rows } from './parseRows';

// Mon 14 Sep 2026 10:00 local — matches the brief exactly so rows are time-zone
// independent (npm test runs this file under both America/New_York and Asia/Kolkata).
const now = new Date(2026, 8, 14, 10, 0).getTime();
const listNames = ['Work', 'Home'];

// `rows` itself now lives in ./parseRows.ts (a shared fixture also used by
// tests/core/recur.test.ts's cross-check against nextOccurrence — Task 3.3 ruling 4).

describe('parseCapture (table)', () => {
  it.each(rows)('%s', (input, expected) => {
    expect(parseCapture(input, now, listNames)).toMatchObject(expected);
  });
});

describe('parseCapture (tokens)', () => {
  it('emits a merged when-token and a tag token, in input order', () => {
    const r = parseCapture('call bank tomorrow 3pm #finance', now, listNames);
    expect(r.tokens).toEqual([
      { kind: 'when', text: 'tomorrow 3pm', label: 'Tue 15 Sep · 3:00 PM' },
      { kind: 'tag', text: '#finance', label: '#finance' }
    ]);
  });

  it('emits a timer token before a list token when the duration comes first', () => {
    const r = parseCapture('deep work 1h30 /work', now, listNames);
    expect(r.tokens).toEqual([
      { kind: 'timer', text: '1h30', label: '1 h 30 min' },
      { kind: 'list', text: '/work', label: 'Work' }
    ]);
  });

  it('emits only a repeat token when the due date is computed, not typed', () => {
    const r = parseCapture('pay rent monthly on the 1st', now, listNames);
    expect(r.tokens).toEqual([{ kind: 'repeat', text: 'monthly on the 1st', label: 'Monthly on the 1st' }]);
  });

  it('emits a repeat token and a time-only when-token', () => {
    const r = parseCapture('gym every mon,wed,fri 7am', now, listNames);
    expect(r.tokens).toEqual([
      { kind: 'repeat', text: 'every mon,wed,fri', label: 'Every Mon, Wed, Fri' },
      { kind: 'when', text: '7am', label: '7:00 AM' }
    ]);
  });

  it('emits a list token for a known @list mention', () => {
    const r = parseCapture('workout @home', now, listNames);
    expect(r.tokens).toEqual([{ kind: 'list', text: '@home', label: 'Home' }]);
  });

  it('resolves a repeat token to the final, date-derived recurrence, not the bare placeholder', () => {
    const r = parseCapture('sync weekly wed', now, listNames);
    expect(r.tokens).toEqual([{ kind: 'repeat', text: 'weekly', label: 'Every Wed' }, { kind: 'when', text: 'wed', label: 'Wed 16 Sep' }]);
  });
});

describe('parseCapture (DST)', () => {
  it('crosses the US fall-back DST boundary via local calendar math', () => {
    const dstNow = new Date(2026, 10, 1, 10, 0).getTime(); // Sun 1 Nov 2026 10:00 (US DST ends today)
    expect(parseCapture('tomorrow 9am', dstNow, listNames)).toMatchObject({ due: { date: '2026-11-02', time: '09:00' } });
  });
});

describe('parseCapture (due validity)', () => {
  it('every parsed due.date across the whole table is a real calendar date, and every due.time is a valid HH:mm', () => {
    for (const [input] of rows) {
      const r = parseCapture(input, now, listNames);
      if (r.due) {
        expect(ymd(parseYmd(r.due.date).getTime())).toBe(r.due.date);
        if (r.due.time) {
          expect(r.due.time).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
        }
      }
    }
  });
});
