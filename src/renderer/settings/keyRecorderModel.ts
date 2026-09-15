// renderer/settings/keyRecorderModel — pure KeyboardEvent -> Electron accelerator
// mapping for the hotkey recorder (Task 5.2 binding ruling). No DOM beyond the
// KeyLike shape below, no dispatch, no IPC — KeyRecorder.tsx is the thin component
// that wires this to `hotkeys:test`/`hotkeys:status`; this file is unit-tested in the
// plain 'node' Vitest environment (tests/renderer/keyRecorderModel.test.ts), same
// convention as keys.ts/commandsModel.ts.
import type { Platform } from '../../shared/platform';

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

// A bare modifier keypress (the user is still holding it down, hasn't pressed a real
// key yet) — `acceleratorFromKeyEvent` ignores these silently (ruling: "ignores
// modifier-only presses"); the recorder keeps waiting rather than showing an error.
const BARE_MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'OS', 'AltGraph']);

export function isModifierOnlyKey(key: string): boolean {
  return BARE_MODIFIER_KEYS.has(key);
}

// Named (non-character) keys -> their Electron accelerator token. Anything not listed
// here falls through to the single-character rule in `keyToken` below.
const NAMED_KEY_TOKENS: Record<string, string> = {
  ' ': 'Space',
  Spacebar: 'Space',
  Enter: 'Enter',
  // Mapped like any other key: Backspace WITH a modifier held (e.g. the default undo
  // hotkey, Control+Alt+Backspace) is a perfectly valid accelerator. KeyRecorder.tsx
  // intercepts only a BARE Backspace (no modifier held — never a valid accelerator on
  // its own anyway) as the separate "reset to default" gesture, before it ever reaches
  // this mapping.
  Backspace: 'Backspace',
  Tab: 'Tab',
  Escape: 'Escape',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right'
};

function isFunctionKey(key: string): boolean {
  return /^F([1-9]|1\d|2[0-4])$/.test(key);
}

/** Maps one non-modifier key to its Electron accelerator token, or `undefined` if it
 * isn't a recognised/representable key (e.g. a bare modifier, or a multi-character key
 * with no named mapping). */
function keyToken(key: string): string | undefined {
  if (key in NAMED_KEY_TOKENS) return NAMED_KEY_TOKENS[key];
  if (isFunctionKey(key)) return key;
  if (key.length === 1) return key.toUpperCase();
  return undefined;
}

/**
 * Builds an Electron accelerator string ("Control+Alt+Space") from one keydown event,
 * or `undefined` when the event isn't (yet) a complete hotkey attempt:
 * - a bare modifier press (still waiting for the real key) -> `undefined`, silently;
 * - a key with NO modifier held -> `undefined` (global shortcuts always need one —
 *   `{ key: 'a' }` is rejected, not built into a modifier-less "A").
 * `Meta` maps to `Super` on win32/linux and `Command` on darwin (Electron's own
 * convention — `Super`/`Meta` both resolve to `Command` on macOS, see
 * main/hotkeys.ts's `canonicalModifier`).
 */
export function acceleratorFromKeyEvent(e: KeyLike, platform: Platform): string | undefined {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push(platform === 'darwin' ? 'Command' : 'Super');
  if (mods.length === 0) return undefined;

  const key = keyToken(e.key);
  if (!key) return undefined;

  return [...mods, key].join('+');
}
