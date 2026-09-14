// shared/platform — pure, dependency-free platform helpers. Runs in the sandboxed
// renderer (no `process.platform`), so every helper takes the platform explicitly —
// main passes `process.platform` down via `Snapshot.platform` (see ./ipc.ts).
export type Platform = 'win32' | 'darwin' | 'linux';

// Accelerator token -> glyph, macOS only. Tokens not listed here (e.g. plain letters,
// 'Space', function keys) render as their literal accelerator text on every platform.
const MAC_GLYPHS: Record<string, string> = {
  Control: '⌃',
  Ctrl: '⌃',
  Alt: '⌥',
  Option: '⌥',
  AltGr: '⌥',
  Shift: '⇧',
  CommandOrControl: '⌘',
  CmdOrCtrl: '⌘',
  Command: '⌘',
  Cmd: '⌘',
  Super: '⌘',
  Meta: '⌘',
  Enter: '↩',
  Return: '↩',
  Backspace: '⌫',
  Delete: '⌦',
  Tab: '⇥',
  Escape: '⎋',
  Esc: '⎋'
};

// Accelerator token -> label, win32/linux only. Everything else renders as-is.
const OTHER_LABELS: Record<string, string> = {
  CommandOrControl: 'Ctrl',
  CmdOrCtrl: 'Ctrl',
  Command: 'Ctrl',
  Cmd: 'Ctrl',
  Control: 'Ctrl',
  Super: 'Win',
  Meta: 'Win'
};

/**
 * Splits an Electron accelerator string ("Control+Alt+Space") into the glyphs/labels
 * shown in the UI for the given platform, e.g. on darwin: ['⌃', '⌥', 'Space'].
 */
export function keyGlyphs(accelerator: string, platform: Platform): string[] {
  const parts = accelerator
    .split('+')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const table = platform === 'darwin' ? MAC_GLYPHS : OTHER_LABELS;
  return parts.map((part) => table[part] ?? part);
}
