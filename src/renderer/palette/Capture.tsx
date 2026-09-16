// renderer/palette/Capture — live natural-language capture (DESIGN.md "Palette
// (keyboard sheets)": capture mode). The input is controlled; token chips are re-derived
// from captureModel's pure chipsFor() on every keystroke (no debounce — it is cheap).
// Escape once wraps the text in quotes to disable parsing (chips collapse to the title
// chip); Escape again clears and hides. Pasting two or more non-empty lines adds one
// task per line instead of capturing the whole paste as one title.
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent, KeyboardEvent } from 'react';
import { dispatch } from '../lib/useStore';
import type { List } from '../../core/types';
import { actionsFor, actionsForLines, chipsFor, isQuoted, quoteInput, splitPastedLines } from './captureModel';
import type { CaptureContext } from './captureModel';
import { TokenChips } from './TokenChips';

// Kept short enough to fit the 560 px palette's footer on one line next to "paste lines
// to add several" without truncating mid-word (docs/screenshots/capture-chips.png
// showed a bare "t..." cutoff at the old, longer wording).
const DEFAULT_HINT = 'Enter add · Shift+Enter add & make current · Esc: literal once, twice close';
const ADDED_MESSAGE_MS = 1500;

interface CaptureProps {
  lists: List[];
  /** New tasks with no explicit `/list` token go here instead of Inbox (Task 4.1
   * addendum ruling 7: the planner's inline capture defaults to the current view's list). */
  defaultListId?: string;
  /** Whether new tasks are added to Today. Default `true` (the palette's long-standing
   * behaviour); the planner passes `false` outside the Today view. */
  today?: boolean;
  /** Called instead of the default `palette:hide` whenever this session would otherwise
   * close the palette (Enter, the second Escape, or the post-paste auto-hide). The
   * planner uses this to swap its inline capture back to the placeholder field instead
   * of hiding a window. Default: `palette:hide` (unchanged behaviour). */
  onDone?: () => void;
}

export function Capture({ lists, defaultListId, today, onDone }: CaptureProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Fix round 2, finding 2: the pending auto-hide `setTimeout` armed by
  // showAddedMessageThenHide below must be cancelled — not just left to fire — whenever
  // its "show the confirmation, then hide" promise is broken: a new capture session
  // starting (palette:mode), the user closing some other way first (clearAndHide), or the
  // user typing during the hold (onChange) to keep working. Without this, a stale timer
  // from a completed paste could fire `palette:hide` on an unrelated later session (round
  // 1's report incorrectly claimed `palette:mode` already did this) or yank the window
  // out from under someone actively typing.
  const cancelPendingHide = (): void => {
    if (messageTimer.current) {
      clearTimeout(messageTimer.current);
      messageTimer.current = null;
    }
    setMessage(null);
  };

  // Fix round 1, finding 5: the palette window persists across hide/show cycles (it
  // isn't unmounted/reloaded), so a `palette:mode` message — always sent on every
  // `palette:show()`, even back into the same mode — is the signal that a new
  // capture session has begun; clear any leftover text from the previous one.
  useEffect(() => {
    return window.tb.on('palette:mode', () => {
      cancelPendingHide();
      setValue('');
    });
  }, []);

  useEffect(
    () => () => {
      if (messageTimer.current) clearTimeout(messageTimer.current);
    },
    []
  );

  // Default (unchanged) behaviour: `palette:hide`. The planner passes its own `onDone`
  // (Task 4.1 addendum ruling 7) to swap its inline capture back to the placeholder
  // field instead.
  const done = onDone ?? ((): void => void window.tb.invoke('palette:hide'));

  const makeCtx = (): CaptureContext => ({
    now: Date.now(),
    lists: lists.map((l) => ({ id: l.id, name: l.name })),
    newId: () => crypto.randomUUID(),
    defaultListId
  });

  // Fix round 1, defect 2: hiding the palette in the same tick as the paste meant the
  // "Added N tasks" confirmation was never actually visible. Ruling: keep the palette
  // open showing the message for ADDED_MESSAGE_MS, then hide — cancelled (no hide fires)
  // by cancelPendingHide above.
  const showAddedMessageThenHide = (n: number): void => {
    setMessage(`Added ${n} task${n === 1 ? '' : 's'}`);
    if (messageTimer.current) clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => {
      messageTimer.current = null;
      setMessage(null);
      done();
    }, ADDED_MESSAGE_MS);
  };

  const clearAndHide = (): void => {
    cancelPendingHide();
    setValue('');
    done();
  };

  const onChange = (e: ChangeEvent<HTMLInputElement>): void => {
    // Fix round 2, finding 2: typing during the post-paste confirmation hold cancels the
    // auto-hide so the user keeps working — the palette then stays open (footer reverts
    // to the normal hint text) until they submit or press Escape.
    cancelPendingHide();
    setValue(e.target.value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') {
      if (value.trim() !== '' && !isQuoted(value)) {
        setValue(quoteInput(value));
        return;
      }
      clearAndHide();
      return;
    }
    if (e.key !== 'Enter') return;
    if (e.nativeEvent.isComposing) return; // IME composition: Enter confirms the composition, not the form

    const actions = actionsFor(value, makeCtx(), { makeCurrent: e.shiftKey, today });
    if (actions.length === 0) return; // empty input + Enter does nothing

    for (const action of actions) dispatch(action);
    clearAndHide();
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>): void => {
    const text = e.clipboardData.getData('text/plain');
    const lines = splitPastedLines(text);
    if (lines.length < 2) return; // a single-line paste behaves like typing

    e.preventDefault();
    // actionsForLines (not a per-line actionsFor loop) threads newly-minted lists across
    // lines, so two lines that share the same new /list mint exactly one list/add instead
    // of each other's task/add ending up with a dangling listId (fix round 1, defect 1).
    const actions = actionsForLines(lines, makeCtx(), { today });
    for (const action of actions) dispatch(action);
    const added = actions.filter((a) => a.type === 'task/add').length;

    setValue('');
    showAddedMessageThenHide(added);
  };

  const chips = chipsFor(value, makeCtx());

  return (
    <>
      <div className="in">
        <input
          ref={inputRef}
          type="text"
          placeholder="Add a task"
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          autoFocus
        />
      </div>
      <TokenChips chips={chips} />
      <div className="foot">
        <span>{message ?? DEFAULT_HINT}</span>
        <span>paste lines to add several</span>
      </div>
    </>
  );
}
