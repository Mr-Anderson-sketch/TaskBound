// renderer/settings/SettingRow — one settings row (DESIGN.md "Settings": "label +
// one-line explanation on the left, control on the right; rows separated by
// hairlines"). `children` is a render-prop so each control can wire its own
// `aria-labelledby` to this row's own generated label id (Task 5.1 addendum ruling 3).
import { useId } from 'react';
import type { ReactNode } from 'react';

export interface SettingRowProps {
  label: string;
  hint?: string;
  /** Rows disabled by a missing capability (Task 5.1 addendum ruling 4: reserveSpace,
   * hideOverFullscreen, menuBarMode) show `disabledHint` instead of `hint` and dim the
   * whole row. */
  disabled?: boolean;
  disabledHint?: string;
  children: (labelId: string) => ReactNode;
}

export function SettingRow({ label, hint, disabled, disabledHint, children }: SettingRowProps) {
  const labelId = useId();
  const shownHint = disabled && disabledHint ? disabledHint : hint;
  return (
    <div className={disabled ? 'setting-row disabled' : 'setting-row'}>
      <div className="row-label">
        <span id={labelId}>{label}</span>
        {shownHint && <span className="row-hint">{shownHint}</span>}
      </div>
      <div className="row-control">{children(labelId)}</div>
    </div>
  );
}
