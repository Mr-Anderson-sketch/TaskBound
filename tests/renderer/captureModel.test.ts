import { describe, it, expect } from 'vitest';
import {
  chipsFor,
  isQuoted,
  quoteInput,
  splitPastedLines,
  actionsFor,
  type CaptureContext
} from '../../src/renderer/palette/captureModel';
import { ActionSchema } from '../../src/core/schema';

// Mon 14 Sep 2026 10:00 local — same fixed instant parse.test.ts uses, so this file's
// assertions are time-zone independent (npm test runs under two time zones).
const now = new Date(2026, 8, 14, 10, 0).getTime();

let seq = 0;
function makeCtx(lists: Array<{ id: string; name: string }> = [{ id: 'inbox', name: 'Inbox' }]): CaptureContext {
  seq = 0;
  return { now, lists, newId: () => `id-${++seq}` };
}

describe('captureModel: chipsFor', () => {
  it('produces a title chip, a when chip, and a tag chip in input order', () => {
    const chips = chipsFor('call bank tomorrow 3pm #finance', makeCtx());
    expect(chips.map((c) => c.kind)).toEqual(['title', 'when', 'tag']);
    expect(chips[0]).toMatchObject({ kind: 'title', label: 'call bank' });
    expect(chips[2]).toMatchObject({ kind: 'tag', label: '#finance' });
  });

  it('returns [] for empty input', () => {
    expect(chipsFor('', makeCtx())).toEqual([]);
    expect(chipsFor('   ', makeCtx())).toEqual([]);
  });

  it('a whole-string quoted input collapses to just the title chip', () => {
    const chips = chipsFor('"tomorrow 3pm #finance"', makeCtx());
    expect(chips).toEqual([{ kind: 'title', label: 'tomorrow 3pm #finance' }]);
  });
});

describe('captureModel: isQuoted / quoteInput', () => {
  it('round-trips straight quotes', () => {
    expect(isQuoted('tomorrow')).toBe(false);
    const quoted = quoteInput('tomorrow');
    expect(quoted).toBe('"tomorrow"');
    expect(isQuoted(quoted)).toBe(true);
  });

  it('recognises curly quotes as already-quoted', () => {
    expect(isQuoted('“tomorrow”')).toBe(true);
  });

  it('quoteInput leaves already-quoted input unchanged', () => {
    expect(quoteInput('"tomorrow"')).toBe('"tomorrow"');
    expect(quoteInput('“tomorrow”')).toBe('“tomorrow”');
  });
});

describe('captureModel: splitPastedLines', () => {
  it('splits on CRLF, LF and CR', () => {
    expect(splitPastedLines('a\r\nb\nc\rd')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('trims and drops blank lines', () => {
    expect(splitPastedLines('  a  \n\n\n  b  \n   ')).toEqual(['a', 'b']);
  });

  it('strips leading bullet, dash and asterisk markers', () => {
    expect(splitPastedLines('- one\n* two\n• three')).toEqual(['one', 'two', 'three']);
  });

  it('strips numbered-list markers', () => {
    expect(splitPastedLines('1. first\n2. second')).toEqual(['first', 'second']);
  });

  it('strips markdown checkbox markers', () => {
    expect(splitPastedLines('- [ ] buy milk\n[ ] call bank')).toEqual(['buy milk', 'call bank']);
  });
});

describe('captureModel: actionsFor', () => {
  it('resolves a recurring task against an existing list, case-insensitively matched', () => {
    const ctx = makeCtx([
      { id: 'inbox', name: 'Inbox' },
      { id: 'h', name: 'Home' }
    ]);
    const actions = actionsFor('pay rent monthly on the 1st /Home', ctx, { makeCurrent: false });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: 'task/add',
      listId: 'h',
      recurrence: { kind: 'monthly', dayOfMonth: 1 }
    });
    expect((actions[0] as { due?: { date: string } }).due?.date).toBeDefined();
  });

  it('creates the list first when /list does not match an existing list', () => {
    const ctx = makeCtx();
    const actions = actionsFor('buy stamps /errands', ctx, { makeCurrent: false });
    expect(actions).toHaveLength(2);
    expect(actions[0]).toMatchObject({ type: 'list/add', name: 'Errands' });
    const listId = (actions[0] as { id: string }).id;
    expect(actions[1]).toMatchObject({ type: 'task/add', listId, title: 'buy stamps' });
  });

  it('a quoted input produces a task titled literally, with no due', () => {
    const actions = actionsFor('"tomorrow"', makeCtx(), { makeCurrent: false });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: 'task/add', title: 'tomorrow' });
    expect((actions[0] as { due?: unknown }).due).toBeUndefined();
  });

  it('whitespace-only input produces no actions', () => {
    expect(actionsFor('   ', makeCtx(), { makeCurrent: false })).toEqual([]);
    expect(actionsFor('', makeCtx(), { makeCurrent: false })).toEqual([]);
  });

  it('carries makeCurrent through to the task/add action', () => {
    const actions = actionsFor('call bank', makeCtx(), { makeCurrent: true });
    expect(actions[0]).toMatchObject({ type: 'task/add', makeCurrent: true });
  });

  it('every returned action passes ActionSchema', () => {
    const ctx = makeCtx([
      { id: 'inbox', name: 'Inbox' },
      { id: 'h', name: 'Home' }
    ]);
    const inputs = [
      'call bank tomorrow 3pm #finance',
      'pay rent monthly on the 1st /Home',
      'buy stamps /errands',
      '"tomorrow"',
      'deep work 1h30 /work'
    ];
    for (const input of inputs) {
      for (const action of actionsFor(input, ctx, { makeCurrent: false })) {
        const result = ActionSchema.safeParse(action);
        expect(result.success, result.success ? '' : JSON.stringify(result.error?.issues)).toBe(true);
      }
    }
  });
});
