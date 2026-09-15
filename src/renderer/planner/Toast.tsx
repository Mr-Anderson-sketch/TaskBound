// renderer/planner/Toast — the planner's confirmation toast (DESIGN.md "Component
// inventory: Toast" — bottom-centre, 12 px, accent-tint, `role="status"`). Task 2.4
// addendum ruling 2: two independent triggers, either of which can be showing at a
// time (the later one wins):
//   - `lastUndone` (Snapshot) changes rev: "Undid: <label>" / "Redid: <label>" for
//     4s. Fires for ANY undo/redo, from any window or the global hotkey — the whole
//     point of this toast is to confirm one just happened even if this window didn't
//     trigger it.
//   - `lastUndo` changes to a rev THIS planner window itself just produced (`ownRev`,
//     passed in by PlannerApp from the `store:dispatch` call's own response — not
//     every `lastUndo` change, which would also fire for actions dispatched by the
//     strip/palette while the planner happens to be open): "<label>" with an "Undo"
//     button.
import { useEffect, useRef, useState } from 'react';
import type { Snapshot } from '../../shared/ipc';

const TOAST_MS = 4000;

export interface ToastProps {
  lastUndo: Snapshot['lastUndo'];
  lastUndone: Snapshot['lastUndone'];
  /** The rev of the last `store:dispatch` this planner window itself made, if any. */
  ownRev: number | undefined;
  onUndo: () => void;
}

type Shown = { kind: 'undone'; text: string } | { kind: 'own'; label: string };

export function Toast({ lastUndo, lastUndone, ownRev, onUndo }: ToastProps) {
  const [shown, setShown] = useState<Shown | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const seenUndoneRevRef = useRef<number | undefined>(undefined);
  const seenOwnRevRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!lastUndone || lastUndone.rev === seenUndoneRevRef.current) return;
    seenUndoneRevRef.current = lastUndone.rev;
    setShown({ kind: 'undone', text: `${lastUndone.kind === 'undo' ? 'Undid' : 'Redid'}: ${lastUndone.label}` });
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setShown(undefined), TOAST_MS);
  }, [lastUndone]);

  useEffect(() => {
    if (!lastUndo || ownRev === undefined || lastUndo.rev !== ownRev) return;
    if (lastUndo.rev === seenOwnRevRef.current) return;
    seenOwnRevRef.current = lastUndo.rev;
    setShown({ kind: 'own', label: lastUndo.label });
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setShown(undefined), TOAST_MS);
  }, [lastUndo, ownRev]);

  // Timers cleared on unmount and on a newer rev (addendum ruling 2) — the latter is
  // already handled above (each new rev clears the previous timer before arming its
  // own); this only covers the unmount case.
  useEffect(() => () => clearTimeout(timerRef.current), []);

  if (!shown) return null;

  return (
    <div className="toast" role="status" aria-live="polite">
      {shown.kind === 'undone' ? (
        <span>{shown.text}</span>
      ) : (
        <>
          <span>{shown.label}</span>
          <button type="button" aria-label="Undo" onClick={onUndo}>
            Undo
          </button>
        </>
      )}
    </div>
  );
}
