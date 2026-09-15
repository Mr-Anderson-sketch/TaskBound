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

// Electron's named (non-character) keys. Matched case-insensitively (fix round 1,
// finding 6: 'control+alt+SPACE' must be ok, same as 'Space'). Function keys F1-F24
// are handled separately by isFunctionKey.
const NAMED_KEYS = new Set([
  'space',
  'enter',
  'backspace',
  'tab',
  'escape',
  'up',
  'down',
  'left',
  'right',
  'delete',
  'home',
  'end',
  'pageup',
  'pagedown',
  'plus'
]);

function isFunctionKey(token: string): boolean {
  return /^f([1-9]|1\d|2[0-4])$/i.test(token);
}

function isValidNonModifierKey(token: string): boolean {
  if (token.length === 1) return true; // single character key
  if (NAMED_KEYS.has(token.toLowerCase())) return true;
  if (isFunctionKey(token)) return true;
  return false;
}

/** Denylist of accelerators that must never be registered as a global shortcut:
 * reserved by the OS/shell, or too easy to trigger destructively by accident. This
 * is the plan's exact list (fix round 1, finding 6) — compared via `canonicalize`
 * below, so e.g. `CmdOrCtrl+C` on win32 and `Ctrl+C` both match `Control+C`. */
export const DENYLIST: readonly string[] = [
  'Alt+F4',
  'Control+C',
  'Control+V',
  'Control+X',
  'Control+Z',
  'Control+A',
  'Control+S',
  'Control+W',
  'Control+Tab',
  'Alt+Tab',
  'CommandOrControl+Q'
];

// Maps a recognised modifier token (lowercased) to its canonical form for denylist
// comparison. `CommandOrControl`/`CmdOrCtrl` resolve per-platform: `Command` on
// darwin, `Control` elsewhere. `Super`/`Meta` likewise resolve to `Command` on
// darwin (fix round 2, minor b) — Electron itself maps the Windows/Super key token
// to Cmd on macOS, so `Super+Q` really is the same physical shortcut as `Cmd+Q`
// there and must be denylisted the same way; elsewhere they stay their own label
// (`Super`), never equal to any denylist entry's modifiers (which only ever use
// Control/Alt/Shift/Command). `AltGr` likewise maps to its own label.
function canonicalModifier(token: string, platform: NodeJS.Platform): string {
  switch (token.toLowerCase()) {
    case 'control':
    case 'ctrl':
      return 'Control';
    case 'alt':
    case 'option':
      return 'Alt';
    case 'shift':
      return 'Shift';
    case 'command':
    case 'cmd':
      return 'Command';
    case 'commandorcontrol':
    case 'cmdorctrl':
      return platform === 'darwin' ? 'Command' : 'Control';
    case 'super':
    case 'meta':
      return platform === 'darwin' ? 'Command' : 'Super';
    case 'altgr':
      return 'AltGr';
    default:
      return token;
  }
}

/** Parses an accelerator into a canonical, platform-resolved, order-independent
 * shape for denylist comparison: a sorted list of canonical modifiers plus one
 * lowercased key. Returns `undefined` for anything that doesn't have exactly one
 * non-modifier token (mirrors validateAccelerator's own parse — an unparseable
 * accelerator is never "denylisted", it's "unparseable"). */
function canonicalize(accelerator: string, platform: NodeJS.Platform): { mods: string[]; key: string } | undefined {
  const parts = accelerator
    .split('+')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) return undefined;
  const modifierParts = parts.filter(isModifier);
  const nonModifierParts = parts.filter((p) => !isModifier(p));
  if (nonModifierParts.length !== 1) return undefined;
  const mods = modifierParts.map((m) => canonicalModifier(m, platform)).sort();
  return { mods, key: nonModifierParts[0].toLowerCase() };
}

function sameCanonical(a: { mods: string[]; key: string }, b: { mods: string[]; key: string }): boolean {
  return a.key === b.key && a.mods.length === b.mods.length && a.mods.every((m, i) => m === b.mods[i]);
}

function isDenylisted(accelerator: string, platform: NodeJS.Platform): boolean {
  const target = canonicalize(accelerator, platform);
  if (!target) return false;
  return DENYLIST.some((d) => {
    const entry = canonicalize(d, platform);
    return entry !== undefined && sameCanonical(target, entry);
  });
}

/**
 * Validates an Electron accelerator string against the plan's rules: at least one
 * modifier, exactly one non-modifier key (a single character or one of Electron's
 * named keys), and not on `DENYLIST`. Order of checks: unparseable shape first
 * (so a garbled string never reports as merely "denylisted" or "no-modifier"),
 * then modifier presence, then the denylist. `platform` (default `process.platform`)
 * resolves `CommandOrControl`/`CmdOrCtrl` for the denylist comparison.
 */
export function validateAccelerator(accelerator: string, platform: NodeJS.Platform = process.platform): ValidateResult {
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

  if (isDenylisted(accelerator, platform)) {
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
   * Returns a map of accelerator -> whether it is actually active: `false` for an
   * invalid/denylisted accelerator, one with no handler supplied, a duplicate of an
   * accelerator already bound to an earlier action in this same call (fix round 1,
   * finding 14 — Electron would otherwise silently rebind it, so only one handler
   * could ever fire; fix round 2 minor c: duplicates are detected by CANONICAL form,
   * so e.g. `Ctrl+Alt+Space` and `Control+Alt+Space` — the same physical shortcut,
   * spelled differently — are correctly treated as one), or one
   * `globalShortcut.register` itself reports failing (e.g. already held by another
   * app); `true` only when register() returns true. */
  apply(settings: Settings, handlers: HotkeyHandlers): Record<string, boolean> {
    this.globalShortcut.unregisterAll();

    const platform = process.platform;
    const result: Record<string, boolean> = {};
    const registeredCanonical = new Set<string>();
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
      const validation = validateAccelerator(accelerator, platform);
      if (!validation.ok) {
        result[accelerator] = false;
        continue;
      }
      const canonical = canonicalize(accelerator, platform);
      // canonicalize() only returns undefined for a shape validateAccelerator would
      // already have rejected above, so this is unreachable in practice — the raw
      // accelerator is a safe fallback key regardless.
      const dedupeKey = canonical ? `${canonical.mods.join('+')}|${canonical.key}` : accelerator;
      if (registeredCanonical.has(dedupeKey)) {
        result[accelerator] = false;
        continue;
      }
      registeredCanonical.add(dedupeKey);
      result[accelerator] = this.globalShortcut.register(accelerator, handler);
    }

    return result;
  }

  unregisterAll(): void {
    this.globalShortcut.unregisterAll();
  }
}
