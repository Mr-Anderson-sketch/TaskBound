// renderer/planner/commandsModel — pure model behind the command palette (Task 4.2
// addendum ruling 4): the full list of palette commands for a given planner context,
// and the fuzzy filter/rank used to narrow them as the user types. No DOM, no dispatch —
// Commands.tsx is a thin React wrapper (tested via e2e); this file is unit-tested in the
// plain 'node' Vitest environment (tests/renderer/commands.test.ts), same convention as
// captureModel.ts.
import type { List, Task } from '../../core/types';
import type { ViewId } from './TaskList';
import type { Platform } from '../../shared/platform';
import { keyGlyphs } from '../../shared/platform';

export type ThemeName = 'ledger' | 'kraft' | 'phosphor' | 'slate';
export type ThemeMode = 'light' | 'dark' | 'system';

export type PaletteCommandAction =
  | { kind: 'goto'; view: ViewId }
  | { kind: 'complete' }
  | { kind: 'toggleToday' }
  | { kind: 'snooze' }
  | { kind: 'due' }
  | { kind: 'move' }
  | { kind: 'delete' }
  | { kind: 'addTask' }
  | { kind: 'theme'; name: ThemeName }
  | { kind: 'appearance'; mode: ThemeMode };

export interface PaletteCommand {
  id: string;
  label: string;
  /** A short key hint shown on the right (e.g. "J K", "Space", "Ctrl+K") — omitted when
   * the command has none. */
  hint?: string;
  action: PaletteCommandAction;
}

const THEME_LABELS: Record<ThemeName, string> = {
  ledger: 'Ledger',
  kraft: 'Kraft',
  phosphor: 'Phosphor',
  slate: 'Slate'
};

const MODE_LABELS: Record<ThemeMode, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System'
};

// Task 5.1 addendum ruling 1 / Task 5.2 / Task 5.3: "Settings: Strip / Hotkeys / Timer /
// Theme / Startup / Score / Data" commands. Kept as a local literal list rather than importing
// settingsModel.ts's SETTINGS_SECTIONS, to avoid a planner -> settings -> planner
// import cycle (Settings.tsx already imports ViewId from this file's sibling
// TaskList.tsx).
const SETTINGS_SECTION_LABELS: Array<{ id: string; label: string }> = [
  { id: 'strip', label: 'Strip' },
  { id: 'hotkeys', label: 'Hotkeys' },
  { id: 'timer', label: 'Timer & pomodoro' },
  { id: 'theme', label: 'Theme' },
  { id: 'startup', label: 'Startup & notifications' },
  { id: 'score', label: 'Score' },
  { id: 'data', label: 'Data' }
];

export interface CommandsContext {
  lists: List[];
  tags: string[];
  /** The currently selected task, if any — gates the per-task commands (Complete,
   * Toggle today, Snooze…, Set due date…, Move to list…, Delete). */
  selectedTask?: Task;
  platform: Platform;
}

function hintFor(accelerator: string, platform: Platform): string {
  return keyGlyphs(accelerator, platform).join(platform === 'darwin' ? '' : '+');
}

/** The full, unfiltered list of palette commands for the given context, in a stable
 * order: navigation first, then (when a task is selected) that task's actions, then
 * "Add a task", then theme/appearance switches. Settings-section commands arrive in
 * Task 5.1 (addendum ruling 4). */
export function allCommands(ctx: CommandsContext): PaletteCommand[] {
  const commands: PaletteCommand[] = [
    { id: 'goto:today', label: 'Go to Today', hint: 'g t', action: { kind: 'goto', view: 'today' } },
    { id: 'goto:upcoming', label: 'Go to Upcoming', hint: 'g u', action: { kind: 'goto', view: 'upcoming' } },
    { id: 'goto:inbox', label: 'Go to Inbox', hint: 'g i', action: { kind: 'goto', view: 'inbox' } },
    { id: 'goto:logbook', label: 'Go to Logbook', hint: 'g l', action: { kind: 'goto', view: 'logbook' } }
  ];

  for (const list of ctx.lists) {
    commands.push({ id: `goto:list:${list.id}`, label: `Go to list: ${list.name}`, action: { kind: 'goto', view: `list:${list.id}` } });
  }
  for (const tag of ctx.tags) {
    commands.push({ id: `goto:tag:${tag}`, label: `Go to tag: #${tag}`, action: { kind: 'goto', view: `tag:${tag}` } });
  }

  if (ctx.selectedTask) {
    commands.push(
      { id: 'task:complete', label: 'Complete', hint: hintFor('Space', ctx.platform), action: { kind: 'complete' } },
      { id: 'task:toggleToday', label: 'Toggle today', hint: 't', action: { kind: 'toggleToday' } },
      { id: 'task:snooze', label: 'Snooze…', hint: 's', action: { kind: 'snooze' } },
      { id: 'task:due', label: 'Set due date…', hint: 'd', action: { kind: 'due' } },
      { id: 'task:move', label: 'Move to list…', hint: 'm', action: { kind: 'move' } },
      { id: 'task:delete', label: 'Delete', hint: 'x', action: { kind: 'delete' } }
    );
  }

  commands.push({ id: 'addTask', label: 'Add a task', action: { kind: 'addTask' } });

  for (const name of ['ledger', 'kraft', 'phosphor', 'slate'] as const) {
    commands.push({ id: `theme:${name}`, label: `Theme: ${THEME_LABELS[name]}`, action: { kind: 'theme', name } });
  }
  for (const mode of ['light', 'dark', 'system'] as const) {
    commands.push({ id: `appearance:${mode}`, label: `Appearance: ${MODE_LABELS[mode]}`, action: { kind: 'appearance', mode } });
  }

  for (const section of SETTINGS_SECTION_LABELS) {
    commands.push({
      id: `settings:${section.id}`,
      label: `Settings: ${section.label}`,
      action: { kind: 'goto', view: `settings:${section.id}` }
    });
  }

  return commands;
}

export interface RankedCommand {
  command: PaletteCommand;
  /** Index of the query's earliest matched character in the label (lower = better). */
  matchStart: number;
}

/** Case-insensitive SUBSEQUENCE match: every character of `query`, in order, appears
 * somewhere in `label` (not necessarily contiguous) — "gti" matches "Go to Inbox". `undefined`
 * when `query` doesn't match at all. On a match, returns the index of the first matched
 * character (used to rank "starts closer to the front" higher) and the match's overall
 * span length (used to rank "tighter" matches higher as a tiebreaker). */
function matchLabel(label: string, query: string): { start: number; span: number } | undefined {
  const lowerLabel = label.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let qi = 0;
  let start = -1;
  let last = -1;
  for (let li = 0; li < lowerLabel.length && qi < lowerQuery.length; li++) {
    if (lowerLabel[li] === lowerQuery[qi]) {
      if (start === -1) start = li;
      last = li;
      qi++;
    }
  }
  if (qi < lowerQuery.length) return undefined; // not every query char was found
  return { start, span: last - start + 1 };
}

const MAX_RESULTS = 8;

/** Filters and ranks `commands` against `query` (a case-insensitive subsequence match),
 * best match first — ranked by earliest match position, then by match span (tighter
 * matches first), then by the command's original order as a stable tiebreak. An empty
 * (or whitespace-only) query returns the first `MAX_RESULTS` commands unranked/unfiltered,
 * in their original order — the palette's default "browse everything" state. Capped at
 * `MAX_RESULTS` (Task 4.2 addendum ruling 4: "up to 8 results"). */
export function filterCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const trimmed = query.trim();
  if (trimmed === '') return commands.slice(0, MAX_RESULTS);

  const ranked: Array<RankedCommand & { span: number; index: number }> = [];
  commands.forEach((command, index) => {
    const m = matchLabel(command.label, trimmed);
    if (m) ranked.push({ command, matchStart: m.start, span: m.span, index });
  });

  ranked.sort((a, b) => a.matchStart - b.matchStart || a.span - b.span || a.index - b.index);
  return ranked.slice(0, MAX_RESULTS).map((r) => r.command);
}
