import { describe, expect, it } from 'vitest';
import { MAX_TASK_MINUTES, parseCsv, parseQuickAdd, parseTaskLines } from '../src/renderer/utils/parse';

describe('parseQuickAdd', () => {
  it.each([
    ['Review deck 20m', 'Review deck', 20 * 60],
    ['Review deck 20 min', 'Review deck', 20 * 60],
    ['Write intro 25 minutes', 'Write intro', 25 * 60],
    ['Deep work 2h', 'Deep work', 2 * 3600],
    ['Deep work 1.5 hours', 'Deep work', 90 * 60],
    ['Deep work 1h30', 'Deep work', 90 * 60],
    ['Deep work 1h 30m', 'Deep work', 90 * 60],
    ['Deep work 1 hr 30 min', 'Deep work', 90 * 60],
    ['Write report [01:30]', 'Write report', 90 * 60],
    ['Testing; 15', 'Testing', 15 * 60],
    ['Testing; 15 mins', 'Testing', 15 * 60]
  ])('%s', (input, title, seconds) => {
    expect(parseQuickAdd(input)).toEqual({ title, seconds });
  });

  it('leaves numbers inside the title alone', () => {
    expect(parseQuickAdd('Call 3 people')).toEqual({ title: 'Call 3 people' });
    expect(parseQuickAdd('Q4 plan')).toEqual({ title: 'Q4 plan' });
  });

  it('needs a title, not just a duration', () => {
    expect(parseQuickAdd('25m')).toEqual({ title: '25m' });
  });

  it('caps very long durations', () => {
    expect(parseQuickAdd('Marathon 99h').seconds).toBe(MAX_TASK_MINUTES * 60);
  });

  it('ignores zero durations', () => {
    expect(parseQuickAdd('Nothing 0m')).toEqual({ title: 'Nothing 0m' });
  });
});

describe('parseTaskLines', () => {
  it('parses one task per non-empty line', () => {
    expect(parseTaskLines('A 10m\n\n  B\r\nC [00:05]')).toEqual([
      { title: 'A', seconds: 600 },
      { title: 'B' },
      { title: 'C', seconds: 300 }
    ]);
  });
});

describe('parseCsv', () => {
  it('reads Task,Minutes with or without a header', () => {
    expect(parseCsv('Task,Time\nEmail,15\nCall,')).toEqual([
      { title: 'Email', seconds: 900 },
      { title: 'Call', seconds: undefined }
    ]);
    expect(parseCsv('Email,15')).toEqual([{ title: 'Email', seconds: 900 }]);
  });
});
