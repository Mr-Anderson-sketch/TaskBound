import { describe, it, expect, vi } from 'vitest';
import { validateAccelerator, Hotkeys, DENYLIST } from '../../src/main/hotkeys';
import { defaultSettings } from '../../src/core/defaults';

describe('validateAccelerator', () => {
  it('rejects a bare key with no modifier', () => {
    expect(validateAccelerator('Space')).toEqual({ ok: false, reason: 'no-modifier' });
  });

  it('rejects denylisted accelerators, case-insensitively and Ctrl===Control', () => {
    expect(validateAccelerator('Alt+F4')).toEqual({ ok: false, reason: 'denylisted' });
    expect(validateAccelerator('ctrl+c')).toEqual({ ok: false, reason: 'denylisted' });
  });

  it('accepts valid accelerators', () => {
    expect(validateAccelerator('Control+Alt+Space')).toEqual({ ok: true });
    expect(validateAccelerator('Control+Alt+Shift+Enter')).toEqual({ ok: true });
    expect(validateAccelerator('CommandOrControl+Alt+Backspace')).toEqual({ ok: true });
  });

  it('rejects unparseable shapes', () => {
    expect(validateAccelerator('Control+Alt')).toEqual({ ok: false, reason: 'unparseable' });
    expect(validateAccelerator('Control+Alt+Space+X')).toEqual({ ok: false, reason: 'unparseable' });
  });

  it('DENYLIST is a non-empty readonly list', () => {
    expect(DENYLIST.length).toBeGreaterThan(0);
  });

  // Fix round 1, finding 6: canonical, platform-aware, order-independent comparison.
  it('denylists CmdOrCtrl+C on win32 (resolves to Control+C)', () => {
    expect(validateAccelerator('CmdOrCtrl+C', 'win32')).toEqual({ ok: false, reason: 'denylisted' });
  });

  it('Shift+Control+Tab is ok — a superset of a denylisted combo is not itself denylisted', () => {
    expect(validateAccelerator('Shift+Control+Tab', 'win32')).toEqual({ ok: true });
  });

  it('named keys are matched case-insensitively too', () => {
    expect(validateAccelerator('control+alt+SPACE', 'win32')).toEqual({ ok: true });
  });

  it('denylists Cmd+Q on darwin (resolves to CommandOrControl+Q)', () => {
    expect(validateAccelerator('Cmd+Q', 'darwin')).toEqual({ ok: false, reason: 'denylisted' });
  });

  it('does not denylist Cmd+Q on win32 (Cmd never resolves to Control there)', () => {
    expect(validateAccelerator('Cmd+Q', 'win32')).toEqual({ ok: true });
  });
});

function fakeGlobalShortcut(registerReturns: (accelerator: string) => boolean = () => true) {
  const registered = new Map<string, () => void>();
  return {
    register: vi.fn((accelerator: string, cb: () => void) => {
      const ok = registerReturns(accelerator);
      if (ok) registered.set(accelerator, cb);
      return ok;
    }),
    unregisterAll: vi.fn(() => {
      registered.clear();
    }),
    registered
  };
}

describe('Hotkeys.apply', () => {
  it('registers only valid accelerators and returns the registration map', () => {
    const gs = fakeGlobalShortcut();
    const hotkeys = new Hotkeys(gs);
    const settings = defaultSettings();
    settings.hotkeys.capture = 'Space'; // invalid: no modifier

    const result = hotkeys.apply(settings, {
      capture: vi.fn(),
      toggleStrip: vi.fn(),
      completeAdvance: vi.fn(),
      toggleTimer: vi.fn(),
      undo: vi.fn()
    });

    expect(result[settings.hotkeys.capture]).toBe(false);
    expect(result[settings.hotkeys.toggleStrip]).toBe(true);
    expect(result[settings.hotkeys.completeAdvance]).toBe(true);
    expect(result[settings.hotkeys.toggleTimer]).toBe(true);
    expect(result[settings.hotkeys.undo]).toBe(true);
    expect(gs.registered.has(settings.hotkeys.toggleStrip)).toBe(true);
    expect(gs.registered.has('Space')).toBe(false);
  });

  it('unregisters everything before re-registering on a second apply', () => {
    const gs = fakeGlobalShortcut();
    const hotkeys = new Hotkeys(gs);
    const settings = defaultSettings();
    const handlers = {
      capture: vi.fn(),
      toggleStrip: vi.fn(),
      completeAdvance: vi.fn(),
      toggleTimer: vi.fn(),
      undo: vi.fn()
    };

    hotkeys.apply(settings, handlers);
    expect(gs.unregisterAll).toHaveBeenCalledTimes(1);

    hotkeys.apply(settings, handlers);
    expect(gs.unregisterAll).toHaveBeenCalledTimes(2);
  });

  it('does not register an accelerator with no handler', () => {
    const gs = fakeGlobalShortcut();
    const hotkeys = new Hotkeys(gs);
    const settings = defaultSettings();

    const result = hotkeys.apply(settings, { capture: vi.fn() });

    expect(result[settings.hotkeys.capture]).toBe(true);
    expect(result[settings.hotkeys.toggleStrip]).toBe(false);
    expect(gs.registered.has(settings.hotkeys.toggleStrip)).toBe(false);
  });

  it('unregisterAll delegates to the injected globalShortcut', () => {
    const gs = fakeGlobalShortcut();
    const hotkeys = new Hotkeys(gs);
    hotkeys.unregisterAll();
    expect(gs.unregisterAll).toHaveBeenCalledTimes(1);
  });

  // Fix round 1, finding 14.
  it('registers a shared accelerator once for the first action and marks the second false', () => {
    const gs = fakeGlobalShortcut();
    const hotkeys = new Hotkeys(gs);
    const settings = defaultSettings();
    settings.hotkeys.toggleTimer = settings.hotkeys.capture; // same accelerator, two actions

    const result = hotkeys.apply(settings, {
      capture: vi.fn(),
      toggleStrip: vi.fn(),
      completeAdvance: vi.fn(),
      toggleTimer: vi.fn(),
      undo: vi.fn()
    });

    // The result map is keyed by accelerator STRING, not action — when two actions
    // share one accelerator, only the last entry processed (toggleTimer, the
    // duplicate) survives in the map, and it's `false`. What actually matters here
    // is that Electron only ever saw ONE register() call for this accelerator.
    expect(result[settings.hotkeys.capture]).toBe(false);
    expect(gs.register).toHaveBeenCalledTimes(4); // capture, toggleStrip, completeAdvance, undo — toggleTimer skipped
    expect(gs.register).toHaveBeenCalledWith(settings.hotkeys.capture, expect.any(Function));
  });

  it('records globalShortcut.register\'s own return value (e.g. already held by another app)', () => {
    const gs = fakeGlobalShortcut((accelerator) => accelerator !== defaultSettings().hotkeys.capture);
    const hotkeys = new Hotkeys(gs);
    const settings = defaultSettings();

    const result = hotkeys.apply(settings, {
      capture: vi.fn(),
      toggleStrip: vi.fn(),
      completeAdvance: vi.fn(),
      toggleTimer: vi.fn(),
      undo: vi.fn()
    });

    expect(result[settings.hotkeys.capture]).toBe(false);
    expect(result[settings.hotkeys.toggleStrip]).toBe(true);
  });
});
