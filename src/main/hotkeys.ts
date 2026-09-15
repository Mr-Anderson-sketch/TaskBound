// main/hotkeys — accelerator validation and global-shortcut registration. Pure logic
// plus a thin wrapper class: no top-level `electron` value import (only `import type`),
// so this runs under Vitest without Electron (CLAUDE.md, and the plan's interface spec
// in .superpowers/sdd/PLAN/task-1.8-1.9-brief.md Part C).
import type { GlobalShortcut } from 'electron';
import type { Settings } from '../core/types';

export type ValidateResult = { ok: true } | { ok: false; reason: 'no-modifier' | 'denylisted' | 'unparseable' };

// Modifier tokens recognised by Electron's accelerator parser. Matched
// case-insensitively (so 'ctrl+c' recognises 'ctrl' as a modifier, not a garbled
// two-character key token) — mirrors the DENYLIST comparison rule below.
const MODIFIERS_LOWER = new Set(
  ['Control', 'Ctrl', 'Alt', 'Option', 'AltGr', 'Shift', 'Super', 'Meta', 'Command', 'Cmd', 'CommandOrControl', 'CmdOrCtrl'].map((m) =>
    m.toLowerCase()
  )
);

function isModifier(token: string): boolean {
  return MODIFIERS_LOWER.has(token.toLowerCase());
}

// Electron's named (non-character) keys. Function keys F1-F24 are handled separately.
const NAMED_KEYS = new Set([
  'Space',
  'Enter',
  'Backspace',
  'Tab',
  'Escape',
  'Up',
  'Down',
  'Left',
  'Right',
  'Delete',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Plus'
]);

function isFunctionKey(token: string): boolean {
  if (!/^F([1-9]|1\d|2[0-4])$/.test(token)) return false;
  return true;
}

function isValidNonModifierKey(token: string): boolean {
  if (token.length === 1) return true; // single character key
  if (NAMED_KEYS.has(token)) return true;
  if (isFunctionKey(token)) return true;
  return false;
}

/** Denylist of accelerators that must never be registered as a global shortcut:
 * reserved by the OS/shell, or too easy to trigger destructively by accident.
 * Comparison is case-insensitive and treats `Ctrl` === `Control` (see `normalizeForDenylistCompare`). */
export const DENYLIST: readonly string[] = [
  'Alt+F4',
  'Alt+Tab',
  'Control+Alt+Delete',
  'Control+Shift+Escape',
  'CommandOrControl+Q',
  'CommandOrControl+W',
  'CommandOrControl+Tab',
  'CommandOrControl+Alt+Escape',
  'Control+C',
  'Control+V',
  'Control+X',
  'Control+Z',
  'Control+A',
  'CommandOrControl+Space'
];

/** Normalizes an accelerator string for denylist comparison: lowercase, and every
 * `ctrl` token folded to `control` so `Ctrl+C` and `Control+C` compare equal. Token
 * order is preserved (Electron accelerators are order-sensitive for parsing, but the
 * denylist entries above are all written in a fixed canonical order already; this
 * function is only used for equality, never re-fed to Electron). */
function normalizeForDenylistCompare(accelerator: string): string {
  return accelerator
    .split('+')
    .map((p) => p.trim().toLowerCase())
    .map((p) => (p === 'ctrl' ? 'control' : p))
    .join('+');
}

function isDenylisted(accelerator: string): boolean {
  const normalized = normalizeForDenylistCompare(accelerator);
  return DENYLIST.some((d) => normalizeForDenylistCompare(d) === normalized);
}

/**
 * Validates an Electron accelerator string against the plan's rules: at least one
 * modifier, exactly one non-modifier key (a single character or one of Electron's
 * named keys), and not on `DENYLIST`. Order of checks: unparseable shape first
 * (so a garbled string never reports as merely "denylisted" or "no-modifier"),
 * then modifier presence, then the denylist.
 */
export function validateAccelerator(accelerator: string): ValidateResult {
  const parts = accelerator
    .split('+')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (parts.length === 0) return { ok: false, reason: 'unparseable' };

  const modifierParts = parts.filter(isModifier);
  const nonModifierParts = parts.filter((p) => !isModifier(p));

  // Exactly one non-modifier key, and it must be a recognised key token.
  if (nonModifierParts.length !== 1 || !isValidNonModifierKey(nonModifierParts[0])) {
    return { ok: false, reason: 'unparseable' };
  }

  if (modifierParts.length === 0) {
    return { ok: false, reason: 'no-modifier' };
  }

  if (isDenylisted(accelerator)) {
    return { ok: false, reason: 'denylisted' };
  }

  return { ok: true };
}

export interface HotkeyHandlers {
  capture?: () => void;
  toggleStrip?: () => void;
  completeAdvance?: () => void;
  toggleTimer?: () => void;
  undo?: () => void;
}

type GlobalShortcutLike = Pick<GlobalShortcut, 'register' | 'unregisterAll'>;

/** Registers the app's five configurable global shortcuts. `apply` is idempotent and
 * safe to call again with new settings: it always unregisters everything first (so a
 * previous run never leaves a stale accelerator registered under different settings),
 * then validates and registers each configured accelerator that maps to a handler. */
export class Hotkeys {
  constructor(private readonly globalShortcut: GlobalShortcutLike) {}

  /** Unregisters everything, then validates and registers each of
   * `settings.hotkeys`'s five accelerators that has a corresponding handler.
   * Returns a map of accelerator -> whether it was actually registered (false
   * for an invalid/denylisted accelerator, or one with no handler supplied). */
  apply(settings: Settings, handlers: HotkeyHandlers): Record<string, boolean> {
    this.globalShortcut.unregisterAll();

    const result: Record<string, boolean> = {};
    const entries: Array<[string, (() => void) | undefined]> = [
      [settings.hotkeys.capture, handlers.capture],
      [settings.hotkeys.toggleStrip, handlers.toggleStrip],
      [settings.hotkeys.completeAdvance, handlers.completeAdvance],
      [settings.hotkeys.toggleTimer, handlers.toggleTimer],
      [settings.hotkeys.undo, handlers.undo]
    ];

    for (const [accelerator, handler] of entries) {
      if (!handler) {
        result[accelerator] = false;
        continue;
      }
      const validation = validateAccelerator(accelerator);
      if (!validation.ok) {
        result[accelerator] = false;
        continue;
      }
      this.globalShortcut.register(accelerator, handler);
      result[accelerator] = true;
    }

    return result;
  }

  unregisterAll(): void {
    this.globalShortcut.unregisterAll();
  }
}
