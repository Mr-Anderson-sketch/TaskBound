import { describe, it, expect } from 'vitest';
import { parseData, ActionSchema } from '../../src/core/schema';
import { createEmptyData } from '../../src/core/defaults';
describe('schema', () => {
  it('round-trips empty data', () => {
    const d = createEmptyData(1_000, '2.0.0');
    expect(parseData(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });
  it('rejects unknown keys and bad versions', () => {
    const d: any = createEmptyData(1_000, '2.0.0');
    expect(() => parseData({ ...d, schemaVersion: 3 })).toThrow();
    expect(() => parseData({ ...d, extra: 1 })).toThrow();
  });
  it('rejects a task/add with a 201-char title and unknown fields', () => {
    expect(ActionSchema.safeParse({ type: 'task/add', id: 'a', now: 1, title: 'x'.repeat(201) }).success).toBe(false);
    expect(ActionSchema.safeParse({ type: 'task/add', id: 'a', now: 1, title: 'ok', bogus: true }).success).toBe(false);
    expect(ActionSchema.safeParse({ type: 'task/add', id: 'a', now: 1, title: 'ok' }).success).toBe(true);
  });
});
