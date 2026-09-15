// renderer/palette/captureModel — pure capture logic behind the live-parsed quick-capture
// input (DESIGN.md "Palette (keyboard sheets)": capture mode). Kept dependency-free and
// DOM-free (no @testing-library/react, no jsdom — see docs/DECISIONS.md) so it is
// unit-testable in the plain 'node' Vitest environment; Capture.tsx is a thin React
// wrapper around these functions and is otherwise verified by e2e (e2e/capture.spec.ts).
import { parseCapture } from '../../core/parse';
import type { Action } from '../../core/types';

export interface CaptureContext {
  now: number;
  lists: Array<{ id: string; name: string }>;
  newId: () => string;
  /** When set, a line with no explicit `/list` token goes to this list instead of
   * Inbox (Task 4.1 addendum ruling 7: the planner's inline capture defaults new tasks
   * to the current view's list). An explicit `/list` token always wins. */
  defaultListId?: string;
}

export interface CaptureChip {
  kind: 'title' | 'when' | 'timer' | 'tag' | 'list' | 'repeat';
  label: string;
  text?: string;
}

/** Title chip first (label = the parsed title), then one chip per token parse.ts found,
 * in input order. Empty (or whitespace-only) input produces no chips at all. */
export function chipsFor(input: string, ctx: CaptureContext): CaptureChip[] {
  if (input.trim() === '') return [];
  const parsed = parseCapture(input, ctx.now, ctx.lists.map((l) => l.name));
  const chips: CaptureChip[] = [{ kind: 'title', label: parsed.title }];
  for (const token of parsed.tokens) {
    chips.push({ kind: token.kind, label: token.label, text: token.text });
  }
  return chips;
}

/** Whether the whole (trimmed) input is wrapped in a matching pair of quotes — straight
 * (`"…"`) or curly (`“…”`) — the same escape hatch `parseCapture` itself recognises. */
export function isQuoted(input: string): boolean {
  const t = input.trim();
  if (t.length < 2) return false;
  const first = t[0];
  const last = t[t.length - 1];
  const isOpen = first === '"' || first === '“';
  const isClose = last === '"' || last === '”';
  return isOpen && isClose;
}

/** Wraps `input` in straight quotes to disable parsing; already-quoted input (straight
 * or curly) is returned completely unchanged. */
export function quoteInput(input: string): string {
  if (isQuoted(input)) return input;
  return `"${input}"`;
}

const LEADING_MARKER = /^(?:-\s*\[\s?\]\s+|\[\s?\]\s+|[-*•]\s+|\d+\.\s+)/;

/** Splits pasted text into candidate capture lines: split on any line ending, trim each
 * line, drop empty ones, and strip a single leading list marker ("- ", "* ", "• ",
 * "1. ", "- [ ] ", "[ ] ") so pasted bullet/numbered/checkbox lists capture cleanly. */
export function splitPastedLines(text: string): string[] {
  return text
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(LEADING_MARKER, ''));
}

function capitalize(name: string): string {
  return name.length === 0 ? name : name.charAt(0).toUpperCase() + name.slice(1);
}

/** The actions to dispatch for one capture line: resolves `listName` against `ctx.lists`
 * case-insensitively, creating the list first (`list/add`) when it doesn't exist yet, then
 * a `task/add` carrying only the fields the parse actually found. `now` is filled from
 * `ctx.now` so every returned action is complete and independently testable/dispatchable.
 * Empty (or whitespace-only) input, after parsing, yields no actions at all.
 *
 * `opts.today` (default `true`) is the palette's long-standing behaviour — every capture
 * goes to Today. The planner's inline capture (Task 4.1 addendum ruling 7) passes `false`
 * outside the Today view, so new tasks land in the target list/Inbox without also being
 * added to Today. `ctx.defaultListId` (used when the input has no explicit `/list` token)
 * lets the planner default to the current view's list; an explicit `/list` always wins. */
export function actionsFor(input: string, ctx: CaptureContext, opts: { makeCurrent: boolean; today?: boolean }): Action[] {
  const parsed = parseCapture(input, ctx.now, ctx.lists.map((l) => l.name));
  const title = parsed.title.trim();
  if (title === '') return [];

  const actions: Action[] = [];
  let listId: string | undefined = ctx.defaultListId;
  if (parsed.listName !== undefined) {
    const existing = ctx.lists.find((l) => l.name.toLowerCase() === parsed.listName!.toLowerCase());
    if (existing) {
      listId = existing.id;
    } else {
      listId = ctx.newId();
      actions.push({ type: 'list/add', id: listId, now: ctx.now, name: capitalize(parsed.listName) });
    }
  }

  const taskAction: Action = {
    type: 'task/add',
    id: ctx.newId(),
    now: ctx.now,
    title,
    today: opts.today ?? true,
    makeCurrent: opts.makeCurrent,
    ...(parsed.due !== undefined ? { due: parsed.due } : {}),
    ...(parsed.tags.length > 0 ? { tags: parsed.tags } : {}),
    ...(parsed.plannedSeconds !== undefined ? { plannedSeconds: parsed.plannedSeconds } : {}),
    ...(parsed.recurrence !== undefined ? { recurrence: parsed.recurrence } : {}),
    ...(listId !== undefined ? { listId } : {})
  };
  actions.push(taskAction);

  return actions;
}

/** The actions to dispatch for several capture lines (a multi-line paste), processed in
 * order: each line is resolved with `actionsFor` against a running copy of `ctx.lists`
 * that is extended with every `list/add` a previous line minted, so two lines that both
 * reference the SAME new list (e.g. two lines with `/errands` and no existing "Errands"
 * list) produce exactly one `list/add` and share its id — instead of each line minting
 * its own `list/add` (the second of which the reducer no-ops by name, leaving its paired
 * `task/add` pointing at an id that was never created). `ctx` itself is never mutated;
 * lines that resolve to no actions (blank/whitespace, after parsing) are simply skipped. */
export function actionsForLines(lines: string[], ctx: CaptureContext, opts: { today?: boolean } = {}): Action[] {
  const actions: Action[] = [];
  let lists = ctx.lists;
  for (const line of lines) {
    const lineActions = actionsFor(
      line,
      { now: ctx.now, lists, newId: ctx.newId, defaultListId: ctx.defaultListId },
      { makeCurrent: false, today: opts.today }
    );
    for (const action of lineActions) {
      if (action.type === 'list/add') {
        lists = [...lists, { id: action.id, name: action.name }];
      }
    }
    actions.push(...lineActions);
  }
  return actions;
}
