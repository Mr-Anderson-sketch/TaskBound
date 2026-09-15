// renderer/ui/NumberField — an integer field with min/max (DESIGN.md "Settings"; Task
// 5.1 addendum ruling 3). Edits are staged as local text so the user can freely
// backspace/retype; the value only commits (calls `onChange`) on blur or Enter, and an
// invalid value (non-integer, out of range, empty) reverts to the last committed value
// instead of committing.
import { useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';

export interface NumberFieldProps {
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  /** id of the row label this control is `aria-labelledby` to. */
  labelledBy: string;
}

export function NumberField({ min, max, value, onChange, labelledBy }: NumberFieldProps) {
  const [text, setText] = useState(String(value));

  // Keep the staged text in sync with an externally-changed value (another window's
  // edit, or this field's own committed change coming back through the store).
  useEffect(() => setText(String(value)), [value]);

  const commit = (): void => {
    const n = Number(text);
    if (text.trim() === '' || !Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
      setText(String(value)); // invalid -> revert
      return;
    }
    if (n !== value) onChange(n);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      (e.target as HTMLInputElement).blur(); // triggers commit via onBlur
    }
  };

  return (
    <input
      type="number"
      className="number-field"
      min={min}
      max={max}
      value={text}
      aria-labelledby={labelledBy}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  );
}
