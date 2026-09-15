// Task 5.2 binding ruling: pure KeyboardEvent -> accelerator mapping for the hotkey
// recorder. Plain 'node' env, same convention as tests/renderer/keys.test.ts.
import { describe, it, expect } from 'vitest';
import { acceleratorFromKeyEvent, isModifierOnlyKey } from '../../src/renderer/settings/keyRecorderModel';

const base = { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };

describe('acceleratorFromKeyEvent', () => {
  it('maps {ctrlKey, altKey, key: " "} to "Control+Alt+Space"', () => {
    expect(acceleratorFromKeyEvent({ ...base, ctrlKey: true, altKey: true, key: ' ' }, 'win32')).toBe('Control+Alt+Space');
  });

  it('rejects a bare key with no modifier (e.g. {key: "a"})', () => {
    expect(acceleratorFromKeyEvent({ ...base, key: 'a' }, 'win32')).toBeUndefined();
  });

  it('ignores a modifier-only press (still waiting for the real key)', () => {
    expect(acceleratorFromKeyEvent({ ...base, ctrlKey: true, key: 'Control' }, 'win32')).toBeUndefined();
    expect(acceleratorFromKeyEvent({ ...base, altKey: true, key: 'Alt' }, 'win32')).toBeUndefined();
    expect(acceleratorFromKeyEvent({ ...base, shiftKey: true, key: 'Shift' }, 'win32')).toBeUndefined();
    expect(acceleratorFromKeyEvent({ ...base, metaKey: true, key: 'Meta' }, 'win32')).toBeUndefined();
  });

  it('maps Meta to Super on win32/linux', () => {
    expect(acceleratorFromKeyEvent({ ...base, metaKey: true, key: 'q' }, 'win32')).toBe('Super+Q');
    expect(acceleratorFromKeyEvent({ ...base, metaKey: true, key: 'q' }, 'linux')).toBe('Super+Q');
  });

  it('maps Meta to Command on darwin', () => {
    expect(acceleratorFromKeyEvent({ ...base, metaKey: true, key: 'q' }, 'darwin')).toBe('Command+Q');
  });

  it('uppercases a single-character key', () => {
    expect(acceleratorFromKeyEvent({ ...base, ctrlKey: true, key: 'b' }, 'win32')).toBe('Control+B');
  });

  it('maps named non-character keys', () => {
    expect(acceleratorFromKeyEvent({ ...base, ctrlKey: true, key: 'ArrowUp' }, 'win32')).toBe('Control+Up');
    expect(acceleratorFromKeyEvent({ ...base, ctrlKey: true, key: 'Enter' }, 'win32')).toBe('Control+Enter');
    expect(acceleratorFromKeyEvent({ ...base, ctrlKey: true, altKey: true, key: 'Backspace' }, 'win32')).toBe(
      'Control+Alt+Backspace'
    );
  });

  it('maps function keys as-is', () => {
    expect(acceleratorFromKeyEvent({ ...base, ctrlKey: true, key: 'F5' }, 'win32')).toBe('Control+F5');
  });

  it('combines every held modifier in a stable order', () => {
    expect(acceleratorFromKeyEvent({ ctrlKey: true, altKey: true, shiftKey: true, metaKey: false, key: 'x' }, 'win32')).toBe(
      'Control+Alt+Shift+X'
    );
  });

  it('rejects an unrepresentable multi-character key with no named mapping', () => {
    expect(acceleratorFromKeyEvent({ ...base, ctrlKey: true, key: 'MediaPlayPause' }, 'win32')).toBeUndefined();
  });
});

describe('isModifierOnlyKey', () => {
  it('recognises the bare modifier key names', () => {
    expect(isModifierOnlyKey('Control')).toBe(true);
    expect(isModifierOnlyKey('Alt')).toBe(true);
    expect(isModifierOnlyKey('Shift')).toBe(true);
    expect(isModifierOnlyKey('Meta')).toBe(true);
  });

  it('does not treat a real key as modifier-only', () => {
    expect(isModifierOnlyKey('a')).toBe(false);
    expect(isModifierOnlyKey('Space')).toBe(false);
  });
});
