// renderer/ui/Segmented — a segmented control (DESIGN.md "Settings": one of the four
// setting-row control kinds). `role="radiogroup"` of `role="radio"` buttons (Task 5.1
// addendum ruling 3): arrow keys move the selection (wrapping), Left/Up and
// Right/Down both work so the control reads correctly regardless of visual
// orientation. Only the selected option is in the tab order (roving tabindex), the
// standard radiogroup keyboard pattern.
import type { KeyboardEvent } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** id of the row label this control is `aria-labelledby` (DESIGN.md: "all with
   * visible labels via aria-labelledby to the row label"). */
  labelledBy: string;
}

export function Segmented<T extends string>({ options, value, onChange, labelledBy }: SegmentedProps<T>) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const i = options.findIndex((o) => o.value === value);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      onChange(options[(i + 1 + options.length) % options.length].value);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      onChange(options[(i - 1 + options.length) % options.length].value);
    }
  };

  return (
    <div className="segmented" role="radiogroup" aria-labelledby={labelledBy} onKeyDown={onKeyDown}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          tabIndex={value === o.value ? 0 : -1}
          className={value === o.value ? 'seg-opt sel' : 'seg-opt'}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
