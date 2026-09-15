import { describe, it, expect } from 'vitest';
import { parseCapture, type ParsedCapture } from '../../src/core/parse';

// Mon 14 Sep 2026 10:00 local — matches the brief exactly so rows are time-zone
// independent (npm test runs this file under both America/New_York and Asia/Kolkata).
const now = new Date(2026, 8, 14, 10, 0).getTime();
const listNames = ['Work', 'Home'];

describe('parseCapture (table)', () => {
  const rows: Array<[string, Partial<ParsedCapture>]> = [
    // --- brief rows, verbatim ---
    ['call bank tomorrow 3pm #finance', { title: 'call bank', due: { date: '2026-09-15', time: '15:00' }, tags: ['finance'] }],
    ['call bank at 9', { title: 'call bank', due: { date: '2026-09-15', time: '09:00' } }], // 9:00 has passed today
    ['buy 9 apples', { title: 'buy 9 apples', due: undefined }],
    ['deep work 1h30 /work', { title: 'deep work', plannedSeconds: 5400, listName: 'work' }],
    ['standup every weekday 9:30', { title: 'standup', recurrence: { kind: 'weekdays' }, due: { date: '2026-09-15', time: '09:30' } }],
    ['pay rent monthly on the 1st', { title: 'pay rent', recurrence: { kind: 'monthly', dayOfMonth: 1 }, due: { date: '2026-10-01' } }],
    ['gym every mon,wed,fri 7am', { recurrence: { kind: 'weekly', days: [1, 3, 5] } }],
    ['review every 2 weeks', { recurrence: { kind: 'everyN', n: 2, unit: 'week', anchor: '2026-09-14' } }],
    ['eat at joes', { title: 'eat at joes' }],
    ['report fri', { due: { date: '2026-09-18' } }],
    ['taxes sep 20', { due: { date: '2026-09-20' } }],
    ['taxes 20/9', { due: { date: '2026-09-20' } }],
    ['  spaced   title  #a #a', { title: 'spaced title', tags: ['a'] }],

    // --- weekday names: every full name and 3-letter form at least once ---
    ['task monday', { due: { date: '2026-09-14' } }],
    ['task mon', { due: { date: '2026-09-14' } }],
    ['task tuesday', { due: { date: '2026-09-15' } }],
    ['task tue', { due: { date: '2026-09-15' } }],
    ['task wednesday', { due: { date: '2026-09-16' } }],
    ['task wed', { due: { date: '2026-09-16' } }],
    ['task thursday', { due: { date: '2026-09-17' } }],
    ['task thu', { due: { date: '2026-09-17' } }],
    ['task friday', { due: { date: '2026-09-18' } }],
    ['task fri', { due: { date: '2026-09-18' } }],
    ['task saturday', { due: { date: '2026-09-19' } }],
    ['task sat', { due: { date: '2026-09-19' } }],
    ['task sunday', { due: { date: '2026-09-20' } }],
    ['task sun', { due: { date: '2026-09-20' } }],

    // --- other date forms ---
    ['plan trip next week', { due: { date: '2026-09-21' } }],
    ['renew passport next month', { due: { date: '2026-10-01' } }],
    ['water plants in 3 days', { due: { date: '2026-09-17' } }],
    ['checkup in 2 weeks', { due: { date: '2026-09-28' } }],
    ['submit report eom', { due: { date: '2026-09-30' } }],
    ['pay taxes sep 1', { due: { date: '2027-09-01' } }], // past this year -> rolls to next year
    ['call bank today 9am', { due: { date: '2026-09-14', time: '09:00' } }], // explicit today keeps today

    // --- times ---
    ['lunch noon', { due: { date: '2026-09-14', time: '12:00' } }],
    ['release midnight', { due: { date: '2026-09-15', time: '00:00' } }],
    ['run morning', { due: { date: '2026-09-15', time: '09:00' } }],
    ['dinner evening', { due: { date: '2026-09-14', time: '18:00' } }],
    ['meeting 3:30pm', { due: { date: '2026-09-14', time: '15:30' } }],
    ['call 15:00', { due: { date: '2026-09-14', time: '15:00' } }],

    // --- durations ---
    ['focus for 45 min', { plannedSeconds: 2700 }],
    ['sprint 90 min', { plannedSeconds: 5400 }],
    ['workout 1h', { plannedSeconds: 3600 }],
    ['look for keys', { title: 'look for keys', due: undefined, plannedSeconds: undefined }], // 'for' with no number stays literal

    // --- recurrence ---
    ['water every 3 days', { recurrence: { kind: 'everyN', n: 3, unit: 'day', anchor: '2026-09-14' } }],
    ['stretch every day', { recurrence: { kind: 'daily' }, due: { date: '2026-09-14' } }],
    ['meds daily', { recurrence: { kind: 'daily' }, due: { date: '2026-09-14' } }],
    ['sync weekly', { recurrence: { kind: 'weekly', days: [1] }, due: { date: '2026-09-14' } }],
    ['pay bill every month on the 31st', { recurrence: { kind: 'monthly', dayOfMonth: 31 }, due: { date: '2026-09-30' } }], // 30-day month clamp

    // --- lists ---
    ['workout @home', { listName: 'home' }],
    ['clean /errands', { listName: 'errands' }], // unknown list kept for creation

    // --- tags ---
    ['task #foo-bar #baz_qux', { tags: ['foo-bar', 'baz_qux'] }],

    // --- title handling ---
    ['🎉 celebrate #fun', { title: '🎉 celebrate', tags: ['fun'] }], // emoji preserved
    ['a'.repeat(250), { title: 'a'.repeat(200) }], // truncated to 200 chars
    ['tomorrow', { title: 'tomorrow', due: { date: '2026-09-15' } }], // fully consumed -> falls back to raw input

    // --- quoted input disables parsing ---
    ['"buy milk tomorrow"', { title: 'buy milk tomorrow', tags: [], tokens: [] }],
    ['“buy milk”', { title: 'buy milk', tags: [], tokens: [] }]
  ];

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
});

describe('parseCapture (DST)', () => {
  it('crosses the US fall-back DST boundary via local calendar math', () => {
    const dstNow = new Date(2026, 10, 1, 10, 0).getTime(); // Sun 1 Nov 2026 10:00 (US DST ends today)
    expect(parseCapture('tomorrow 9am', dstNow, listNames)).toMatchObject({ due: { date: '2026-11-02', time: '09:00' } });
  });
});
