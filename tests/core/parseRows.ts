// tests/core/parseRows — the `parseCapture` table-test fixture, extracted from
// parse.test.ts (Task 3.3 ruling 4) so tests/core/recur.test.ts can cross-check
// `nextOccurrence` against every row whose expected result carries both `recurrence`
// and `due`, without duplicating the table. All rows assume `now` = Mon 14 Sep 2026
// 10:00 local, matching parse.test.ts's `now` constant exactly.
import type { ParsedCapture } from '../../src/core/parse';

export const rows: Array<[string, Partial<ParsedCapture>]> = [
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
  ['taxes 2026-09-20', { due: { date: '2026-09-20' } }], // valid ISO date

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
  ['review 1h 30m', { title: 'review', plannedSeconds: 5400 }], // spaced compound duration, one token
  ['workout 2 hours 15 minutes', { title: 'workout', plannedSeconds: 8100 }], // spaced compound, full unit words
  ['review 1h 30', { title: 'review 30', plannedSeconds: 3600 }], // bare trailing number is NOT a duration continuation

  // --- recurrence ---
  ['water every 3 days', { recurrence: { kind: 'everyN', n: 3, unit: 'day', anchor: '2026-09-14' } }],
  ['stretch every day', { recurrence: { kind: 'daily' }, due: { date: '2026-09-14' } }],
  ['meds daily', { recurrence: { kind: 'daily' }, due: { date: '2026-09-14' } }],
  ['sync weekly', { recurrence: { kind: 'weekly', days: [1] }, due: { date: '2026-09-14' } }],
  ['pay bill every month on the 31st', { recurrence: { kind: 'monthly', dayOfMonth: 31 }, due: { date: '2026-09-30' } }], // 30-day month clamp

  // --- recurrence with implicit parameters derived from an explicit date, not today ---
  ['sync weekly wed', { due: { date: '2026-09-16' }, recurrence: { kind: 'weekly', days: [3] } }],
  ['pay rent monthly sep 20', { due: { date: '2026-09-20' }, recurrence: { kind: 'monthly', dayOfMonth: 20 } }],
  ['review every 2 weeks fri', { due: { date: '2026-09-18' }, recurrence: { kind: 'everyN', n: 2, unit: 'week', anchor: '2026-09-18' } }],
  // explicit recurrence day wins over a contradicting explicit date: due becomes the
  // first occurrence on/after the typed date, not the typed date itself
  ['standup every monday sep 16', { due: { date: '2026-09-21' }, recurrence: { kind: 'weekly', days: [1] } }],

  // --- lists ---
  ['workout @home', { listName: 'home' }],
  ['clean /errands', { listName: 'errands' }], // unknown list kept for creation

  // --- tags ---
  ['task #foo-bar #baz_qux', { tags: ['foo-bar', 'baz_qux'] }],

  // --- title handling ---
  ['🎉 celebrate #fun', { title: '🎉 celebrate', tags: ['fun'] }], // emoji preserved
  ['a'.repeat(250), { title: 'a'.repeat(200) }], // truncated to 200 chars
  ['tomorrow', { title: 'tomorrow', due: { date: '2026-09-15' } }], // fully consumed -> falls back to raw input
  ['tomorrow friday', { title: 'friday', due: { date: '2026-09-15' } }], // first date wins; the rest stays literal

  // --- quoted input disables parsing ---
  ['"buy milk tomorrow"', { title: 'buy milk tomorrow', tags: [], tokens: [] }],
  ['“buy milk”', { title: 'buy milk', tags: [], tokens: [] }],

  // --- invalid calendar dates stay unconsumed and literal, no due ---
  ['deadline 2026-02-30', { title: 'deadline 2026-02-30', due: undefined }], // Feb has 28/29 days
  ['plan sep 31', { title: 'plan sep 31', due: undefined }], // Sep has 30 days
  ['event 31/2', { title: 'event 31/2', due: undefined }], // Feb has 28/29 days
  ['meeting 2026-13-01', { title: 'meeting 2026-13-01', due: undefined }], // month 13 doesn't exist

  // --- out-of-range numbers stay unconsumed and literal ---
  ['meeting at 25', { title: 'meeting at 25', due: undefined }], // hour > 23
  ['call 13pm', { title: 'call 13pm', due: undefined }], // hour > 12 with am/pm
  ['pay monthly on the 45th', { title: 'pay monthly on the 45th', recurrence: undefined }], // day-of-month > 31
  ['pay monthly on the 0th', { title: 'pay monthly on the 0th', recurrence: undefined }], // day-of-month < 1
  ['task every 0 days', { title: 'task every 0 days', recurrence: undefined }], // N < 1
  ['plant in 0 days', { title: 'plant in 0 days', due: undefined }], // N < 1
  ['meet at 9:75', { title: 'meet at 9:75', due: undefined }] // minute > 59
];
