// renderer/palette/CloseDay — the "Close the day" sheet (DESIGN.md "Palette (keyboard
// sheets)"). Stats come from the pure `dayStats` selector (core/select.ts); Enter
// dispatches `day/close` and hides, Escape hides without dispatching.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { dayStats } from '../../core/select';
import { dayKeyForRollover } from '../../core/dates';
import type { Data } from '../../core/types';
import { dispatch } from '../lib/useStore';

interface CloseDayProps {
  data: Data;
}

/** "2h 40m" / "45m" / "0m" — bare (no "about" prefix; that's PlanToday's footer style). */
function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export function CloseDay({ data }: CloseDayProps) {
  // Captured once per mount (PaletteApp remounts this on every `palette:mode`).
  const [now] = useState(() => Date.now());
  const dateKey = useMemo(() => dayKeyForRollover(now), [now]);
  const stats = useMemo(() => dayStats(data, dateKey, now), [data, dateKey, now]);
  const [note, setNote] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const confirm = (): void => {
    const trimmed = note.trim();
    dispatch({ type: 'day/close', date: dateKey, note: trimmed === '' ? undefined : trimmed });
    void window.tb.invoke('palette:hide');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      confirm();
    } else if (e.key === 'Escape') {
      void window.tb.invoke('palette:hide');
    }
  };

  return (
    <>
      <div className="title">Close the day</div>
      <div className="stats">
        <div className="stat">
          <span className="v">{stats.completed}</span>
          <span className="k">completed</span>
        </div>
        <div className="stat">
          <span className="v">{formatDuration(stats.focusSeconds)}</span>
          <span className="k">focused</span>
        </div>
        <div className="stat">
          <span className="v">{stats.rolledOver}</span>
          <span className="k">rolled over</span>
        </div>
      </div>
      <div className="note">
        <input
          ref={inputRef}
          type="text"
          placeholder="Add a note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="foot">
        <span>Enter closes the day, Esc cancels.</span>
        <button type="button" className="btn" onClick={confirm}>
          Close the day
        </button>
      </div>
    </>
  );
}
