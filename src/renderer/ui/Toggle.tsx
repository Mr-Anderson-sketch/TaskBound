// renderer/ui/Toggle — an on/off switch (DESIGN.md "Settings"). `role="switch"` with
// `aria-checked`; a native `<button>` already fires `onClick` for both Space and
// Enter, so no extra key handling is needed (Task 5.1 addendum ruling 3).
export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** id of the row label this control is `aria-labelledby` to. */
  labelledBy: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, labelledBy, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      disabled={disabled}
      className={checked ? 'toggle on' : 'toggle'}
      onClick={() => onChange(!checked)}
    >
      <span className="knob" />
    </button>
  );
}
