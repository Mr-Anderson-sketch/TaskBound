import { describe, it, expect } from 'vitest';
import { parseData, ActionSchema } from '../../src/core/schema';
import { createEmptyData, defaultSettings } from '../../src/core/defaults';
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
  it('settings/patch requires whole strip.positions entries, not partial ones', () => {
    expect(
      ActionSchema.safeParse({
        type: 'settings/patch',
        now: 1,
        patch: { strip: { positions: { d1: { x: 1, y: 2 } } } }
      }).success
    ).toBe(true);
    expect(
      ActionSchema.safeParse({
        type: 'settings/patch',
        now: 1,
        patch: { strip: { positions: { d1: { y: 2 } } } }
      }).success
    ).toBe(false);
  });
  it('defaultSettings pins the brief-specified hotkeys and strip defaults', () => {
    const s = defaultSettings();
    expect(s.hotkeys).toEqual({
      capture: 'Control+Alt+Space',
      toggleStrip: 'Control+Alt+Shift+Space',
      completeAdvance: 'Control+Alt+Enter',
      toggleTimer: 'Control+Alt+Shift+Enter',
      undo: 'Control+Alt+Backspace'
    });
    expect(s.strip).toEqual({
      enabled: true,
      edge: 'bottom',
      width: 420,
      collapsed: false,
      autoHide: false,
      clickThrough: false,
      opacity: 1,
      reserveSpace: false,
      hideOverFullscreen: true,
      hideFromCapture: false,
      menuBarMode: false,
      positions: {}
    });
  });
});
