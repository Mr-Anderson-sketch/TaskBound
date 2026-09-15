// renderer/planner/DueField — the keyboard due picker's text field (Task 4.2 addendum
// ruling 3): free text parsed with the same `parseCapture` grammar as capture, using
// only the parsed `due`; a live preview label underneath; Enter applies when a date
// was parsed (else shows "Couldn't read that date"); a "Clear due date" item removes it.
// Reused as-is by Task 4.3's detail pane (addendum ruling 8) rather than a separate
// DuePicker.tsx.
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { parseCapture } from '../../core/parse';
import type { Due } from '../../core/types';
import { shortDateLabel } from './TaskRow';

export interface DueFieldProps {
  now: number;
  /** `task/edit { patch: { due } }` — `due: undefined` clears it (the "Clear due date"
   * item calls this with `undefined`). */
  onApply: (due: Due | undefined) => void;
  onClose: () => void;
}

function previewLabel(due: Due): string {
  return due.time ? `${shortDateLabel(due.date)} · ${due.time}` : shortDateLabel(due.date);
}

export function DueField({ now, onApply, onClose }: DueFieldProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const parsed = value.trim() === '' ? undefined : parseCapture(value, now, []).due;
  const couldNotRead = value.trim() !== '' && parsed === undefined;

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (parsed !== undefined) onApply(parsed);
      return;
    }
    // Escape bubbles up to Menu's own handler (onClose) — nothing to do here.
  };

  return (
    <div className="due-field">
      <input
        ref={inputRef}
        type="text"
        placeholder="tomorrow 3pm, fri, sep 20…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label="Due date"
      />
      <div className="due-preview">{parsed ? previewLabel(parsed) : couldNotRead ? "Couldn't read that date" : ' '}</div>
      <button
        type="button"
        role="menuitem"
        className="mi"
        onClick={() => {
          onApply(undefined);
          onClose();
        }}
      >
        Clear due date
      </button>
    </div>
  );
}
