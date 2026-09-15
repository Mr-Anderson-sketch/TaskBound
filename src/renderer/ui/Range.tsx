// renderer/ui/Range — a native `<input type="range">` styled with tokens, with a
// visible value label (DESIGN.md "Settings"; Task 5.1 addendum ruling 3). The native
// element already gives correct slider semantics/keyboard handling for free.
export interface RangeProps {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  /** id of the row label this control is `aria-labelledby` to. */
  labelledBy: string;
  formatValue?: (value: number) => string;
}

export function Range({ min, max, step = 1, value, onChange, labelledBy, formatValue }: RangeProps) {
  return (
    <div className="range-wrap">
      <input
        type="range"
        className="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-labelledby={labelledBy}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="range-value">{formatValue ? formatValue(value) : value}</span>
    </div>
  );
}
