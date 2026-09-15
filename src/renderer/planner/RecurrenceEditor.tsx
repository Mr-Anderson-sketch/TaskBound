// renderer/planner/RecurrenceEditor — the detail pane's "Repeats" editor (Task 4.3
// addendum ruling 3): a kind segmented control (Never/Daily/Weekdays/Weekly/Monthly/
// Every N), Weekly's Mon-Sun toggles, Monthly's day-of-month number, and Every N's
// number+unit. State <-> Rule conversion is the pure `recurrenceModel.ts`; this
// component only owns the in-progress `RecurrenceState` and calls `onSave` with the
// resulting `Rule | undefined` (Never).
import { useState } from 'react';
import type { Ymd } from '../../core/types';
import type { RecurrenceState, RecurrenceKind } from './recurrenceModel';
import { ruleToState, stateToRule } from './recurrenceModel';
import type { Rule } from '../../core/types';

const KIND_LABELS: Record<RecurrenceKind, string> = {
  never: 'Never',
  daily: 'Daily',
  weekdays: 'Weekdays',
  weekly: 'Weekly',
  monthly: 'Monthly',
  everyN: 'Every N'
};
const KINDS: RecurrenceKind[] = ['never', 'daily', 'weekdays', 'weekly', 'monthly', 'everyN'];

// Monday-first display, matching core/recur.ts's describeRule.
const DOW = [
  { d: 1, label: 'Mon' },
  { d: 2, label: 'Tue' },
  { d: 3, label: 'Wed' },
  { d: 4, label: 'Thu' },
  { d: 5, label: 'Fri' },
  { d: 6, label: 'Sat' },
  { d: 0, label: 'Sun' }
];

export interface RecurrenceEditorProps {
  rule: Rule | undefined;
  /** Today, per ruling 3's "anchor = today unless the task has a due date" — the caller
   * (Detail.tsx) resolves which Ymd that is before passing it in. */
  anchor: Ymd;
  onSave: (rule: Rule | undefined) => void;
  onClose: () => void;
}

export function RecurrenceEditor({ rule, anchor, onSave, onClose }: RecurrenceEditorProps) {
  const [state, setState] = useState<RecurrenceState>(() => ruleToState(rule));

  const invalid = state.kind === 'weekly' && state.weeklyDays.length === 0;

  const toggleDay = (d: number): void => {
    setState((s) => ({ ...s, weeklyDays: s.weeklyDays.includes(d) ? s.weeklyDays.filter((x) => x !== d) : [...s.weeklyDays, d] }));
  };

  const save = (): void => {
    if (invalid) return;
    onSave(stateToRule(state, anchor));
    onClose();
  };

  return (
    <div className="recur-editor" role="group" aria-label="Repeats">
      <div className="seg" role="radiogroup" aria-label="Repeat kind">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={state.kind === k}
            className={state.kind === k ? 'seg-item sel' : 'seg-item'}
            onClick={() => setState((s) => ({ ...s, kind: k }))}
          >
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>

      {state.kind === 'weekly' && (
        <div className="recur-days">
          {DOW.map(({ d, label }) => (
            <button
              key={d}
              type="button"
              aria-pressed={state.weeklyDays.includes(d)}
              className={state.weeklyDays.includes(d) ? 'day sel' : 'day'}
              onClick={() => toggleDay(d)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {state.kind === 'monthly' && (
        <label className="recur-field">
          Day of month
          <input
            type="number"
            min={1}
            max={31}
            value={state.monthlyDay}
            onChange={(e) => setState((s) => ({ ...s, monthlyDay: Number(e.target.value) }))}
          />
        </label>
      )}

      {state.kind === 'everyN' && (
        <div className="recur-field">
          Every
          <input
            type="number"
            min={1}
            max={365}
            aria-label="Every N"
            value={state.everyN}
            onChange={(e) => setState((s) => ({ ...s, everyN: Number(e.target.value) }))}
          />
          <select
            aria-label="Every N unit"
            value={state.everyUnit}
            onChange={(e) => setState((s) => ({ ...s, everyUnit: e.target.value as 'day' | 'week' }))}
          >
            <option value="day">days</option>
            <option value="week">weeks</option>
          </select>
        </div>
      )}

      <div className="recur-actions">
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn" disabled={invalid} onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}
