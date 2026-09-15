// renderer/planner/keys — pure keyboard model for the planner (Task 4.2 addendum
// ruling 2). `commandForKey` is a plain lookup: no Date.now(), no DOM, no timers — the
// caller (usePlannerKeys.ts) owns the 1 s chord window itself (arming/clearing a
// `chordState` ref on a `setTimeout`) and passes in only whether a chord is CURRENTLY
// pending, already timeout-adjusted. This keeps the mapping itself unit-testable in the
// plain 'node' Vitest environment (tests/renderer/keys.test.ts).
import type { Platform } from '../../shared/platform';

export type Command =
  | { type: 'nav'; dir: 'down' | 'up' }
  | { type: 'toggleDone' }
  | { type: 'openDetail' }
  | { type: 'editTitle' }
  | { type: 'toggleToday' }
  | { type: 'delete' }
  | { type: 'snooze' }
  | { type: 'due' }
  | { type: 'move' }
  | { type: 'reorder'; dir: 'up' | 'down' }
  /** A bare `g` with no chord pending: the caller arms a 1 s chord window in response. */
  | { type: 'chordStart' }
  | { type: 'goto'; view: 'today' | 'upcoming' | 'inbox' | 'logbook' }
  | { type: 'commandPalette' }
  /** Task 5.1 addendum ruling 1: Ctrl+, / ⌘, opens Settings. */
  | { type: 'openSettings' };

/** `'g'` while the caller's 1 s chord window (armed by a `chordStart` command) is still
 * open; `undefined` otherwise (no chord pending, or it already timed out). */
export type ChordState = 'g' | undefined;

export interface KeyLike {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/** How long a `g` chord stays open for its second key (Task 4.2 addendum ruling 2). */
export const CHORD_WINDOW_MS = 1000;

function isPlatformMod(e: KeyLike, platform: Platform): boolean {
  return platform === 'darwin' ? e.metaKey : e.ctrlKey;
}

/**
 * Maps one keydown to a `Command`, or `undefined` when the key isn't a planner
 * shortcut. `chordState` reflects whether a `g` chord is currently open (the caller
 * already applied its own timeout, so `commandForKey` itself needs no clock). Callers
 * are expected to have already excluded keydowns while focus is inside an input,
 * textarea, select, or `[contenteditable]`, and while any overlay (command palette,
 * snooze/due/move menu) is open (Task 4.2 addendum ruling 2).
 */
export function commandForKey(e: KeyLike, platform: Platform, chordState: ChordState): Command | undefined {
  const lower = e.key.toLowerCase();

  // Ctrl+K / Cmd+K (platform-appropriate) always opens the command palette, chord or not.
  if (isPlatformMod(e, platform) && !e.altKey && lower === 'k') {
    return { type: 'commandPalette' };
  }

  // Ctrl+, / Cmd+, always opens Settings, chord or not (Task 5.1 addendum ruling 1).
  if (isPlatformMod(e, platform) && !e.altKey && e.key === ',') {
    return { type: 'openSettings' };
  }

  if (chordState === 'g') {
    if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return undefined;
    if (lower === 't') return { type: 'goto', view: 'today' };
    if (lower === 'u') return { type: 'goto', view: 'upcoming' };
    if (lower === 'i') return { type: 'goto', view: 'inbox' };
    if (lower === 'l') return { type: 'goto', view: 'logbook' };
    return undefined; // chord broken: caller clears chordState, no command fires
  }

  // No other modifier combination is a planner shortcut.
  if (e.ctrlKey || e.metaKey || e.altKey) return undefined;

  if (e.shiftKey) {
    if (e.key === 'ArrowUp') return { type: 'reorder', dir: 'up' };
    if (e.key === 'ArrowDown') return { type: 'reorder', dir: 'down' };
    return undefined;
  }

  if (lower === 'j' || e.key === 'ArrowDown') return { type: 'nav', dir: 'down' };
  if (lower === 'k' || e.key === 'ArrowUp') return { type: 'nav', dir: 'up' };
  if (e.key === ' ' || e.key === 'Spacebar') return { type: 'toggleDone' };
  if (e.key === 'Enter') return { type: 'openDetail' };
  if (lower === 'e') return { type: 'editTitle' };
  if (lower === 't') return { type: 'toggleToday' };
  if (lower === 'x' || e.key === 'Delete') return { type: 'delete' };
  if (lower === 's') return { type: 'snooze' };
  if (lower === 'd') return { type: 'due' };
  if (lower === 'm') return { type: 'move' };
  if (lower === 'g') return { type: 'chordStart' };

  return undefined;
}

/**
 * Whether `target` is a form control the keyboard model must stay out of (Task 4.2
 * addendum ruling 2: "Active only when focus is not in an input, textarea, select, or
 * `[contenteditable]`"). Exported so both `usePlannerKeys` and its tests share one
 * definition.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  // `typeof HTMLElement` guard: this file's own unit tests run in the plain 'node'
  // Vitest environment (no DOM globals at all), same convention as the rest of
  // tests/renderer/*.test.ts — see captureModel.test.ts's header comment.
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

/**
 * Where selection should land after the task at `removedId` stops being at its old spot
 * in the visible row order — because it was deleted, or because completing/uncompleting
 * it hid it from the current view (Task 4.2 addendum ruling 2: "Selection moves to the
 * next row after the selected task is deleted or completed-and-hidden"). `oldIds`/`newIds`
 * are the flat visible-row id lists (section headers skipped) before and after the
 * change. If `removedId` is STILL visible in `newIds` (e.g. Today keeps a just-completed
 * task visible in its Done section), selection simply stays on it. Otherwise this walks
 * forward from its old position for the next id that still exists, falling back to
 * walking backward, and finally to `undefined` when the view is now empty. Pure — no
 * DOM, easy to unit test.
 */
/**
 * The `task/move` `afterId` a `Shift+↑`/`Shift+↓` reorder should dispatch to swap
 * `selectedId` with its immediate neighbour in `ids` (the CURRENT section's own visible
 * task ids — Task 4.2 addendum ruling 3 scopes reordering to "the task's own sibling
 * group", so the caller passes only the selected row's section, not the whole view):
 * `up` swaps with the previous neighbour (afterId = the item two back, or `null` if the
 * neighbour was already first); `down` swaps with the next neighbour (afterId = that
 * neighbour's own id). `undefined` when `selectedId` is already at that end (or isn't in
 * `ids` at all) — nothing to dispatch. Whether the reorder is actually VISIBLE still
 * depends on whether that neighbour is a true `task/move` sibling (same listId AND
 * parentId) — ruling 3's own caveat ("the move is only visible if the displayed
 * ordering uses order"); this helper only computes the swap target, `task/move` itself
 * silently no-ops an `afterId` that isn't a real sibling.
 */
export function reorderTarget(ids: string[], selectedId: string, dir: 'up' | 'down'): { afterId: string | null } | undefined {
  const i = ids.indexOf(selectedId);
  if (i === -1) return undefined;
  if (dir === 'up') {
    if (i === 0) return undefined;
    return i === 1 ? { afterId: null } : { afterId: ids[i - 2] };
  }
  if (i >= ids.length - 1) return undefined;
  return { afterId: ids[i + 1] };
}

export interface SnoozeOption {
  id: 'hour' | 'evening' | 'tomorrow' | 'nextWeek' | 'pick';
  label: string;
  /** Absent for `pick`, which switches the snooze menu to a free-text field instead. */
  until?: number;
}

/**
 * The snooze menu's items, in order (Task 4.2 addendum ruling 3), computed against
 * `now` (all local time): `1 hour` (`now + 60 min`), `This evening` (today 18:00 —
 * omitted once it's past 17:00 local, matching the ruling's "hidden after 17:00"),
 * `Tomorrow` (tomorrow 09:00), `Next week` (next Monday 09:00 — always strictly in the
 * future: if today IS Monday, that's 7 days out, not today), and `Pick…` (no `until`;
 * the caller switches to a text field parsed the same way as capture's due).
 */
export function snoozeOptions(now: number): SnoozeOption[] {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = d.getMonth();
  const day = d.getDate();
  const at = (dayOffset: number, hour: number): number => new Date(y, m, day + dayOffset, hour, 0, 0, 0).getTime();

  const options: SnoozeOption[] = [{ id: 'hour', label: '1 hour', until: now + 60 * 60 * 1000 }];
  if (d.getHours() < 17) {
    options.push({ id: 'evening', label: 'This evening', until: at(0, 18) });
  }
  options.push({ id: 'tomorrow', label: 'Tomorrow', until: at(1, 9) });
  const daysToNextMonday = ((1 - d.getDay() + 7) % 7) || 7;
  options.push({ id: 'nextWeek', label: 'Next week', until: at(daysToNextMonday, 9) });
  options.push({ id: 'pick', label: 'Pick…' });
  return options;
}

export function nextSelection(oldIds: string[], newIds: string[], removedId: string): string | undefined {
  if (newIds.includes(removedId)) return removedId;
  const oldIndex = oldIds.indexOf(removedId);
  if (oldIndex === -1) return newIds[0];
  for (let i = oldIndex + 1; i < oldIds.length; i++) {
    if (newIds.includes(oldIds[i])) return oldIds[i];
  }
  for (let i = oldIndex - 1; i >= 0; i--) {
    if (newIds.includes(oldIds[i])) return oldIds[i];
  }
  return undefined;
}
