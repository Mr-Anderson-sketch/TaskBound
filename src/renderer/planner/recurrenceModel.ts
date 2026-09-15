// renderer/planner/recurrenceModel — pure state <-> Rule conversion for
// RecurrenceEditor.tsx (Task 4.3 addendum ruling 3). No DOM: the component owns a
// `RecurrenceState` while the user is editing, and converts it to/from a `Rule` only at
// load and save time — this keeps the "kind" segmented control, weekday toggles, and
// number fields simple, independently-editable pieces of local state instead of trying
// to keep a discriminated-union `Rule` half-edited.
import type { Rule, Ymd } from '../../core/types';

export type RecurrenceKind = 'never' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'everyN';

export interface RecurrenceState {
  kind: RecurrenceKind;
  /** 0=Sun … 6=Sat. Used (and required non-empty to save) only when `kind === 'weekly'`. */
  weeklyDays: number[];
  /** 1..31. Used only when `kind === 'monthly'`. */
  monthlyDay: number;
  /** 1..365. Used only when `kind === 'everyN'`. */
  everyN: number;
  everyUnit: 'day' | 'week';
}

const DEFAULT_STATE: RecurrenceState = { kind: 'never', weeklyDays: [], monthlyDay: 1, everyN: 1, everyUnit: 'day' };

/** The editor's starting state for an existing (or absent) rule — every field is
 * populated with a sane default even for kinds the rule doesn't use, so switching the
 * segmented control never shows an empty/invalid sub-field. */
export function ruleToState(rule: Rule | undefined): RecurrenceState {
  if (!rule) return { ...DEFAULT_STATE };
  switch (rule.kind) {
    case 'daily':
      return { ...DEFAULT_STATE, kind: 'daily' };
    case 'weekdays':
      return { ...DEFAULT_STATE, kind: 'weekdays' };
    case 'weekly':
      return { ...DEFAULT_STATE, kind: 'weekly', weeklyDays: [...rule.days] };
    case 'monthly':
      return { ...DEFAULT_STATE, kind: 'monthly', monthlyDay: rule.dayOfMonth };
    case 'everyN':
      return { ...DEFAULT_STATE, kind: 'everyN', everyN: rule.n, everyUnit: rule.unit };
  }
}

/**
 * Converts editor state to a `Rule` (`undefined` for `'never'`), clamping numeric
 * fields to their valid ranges and sorting/deduping weekly days. Returns `undefined`
 * for `'weekly'` with no days selected too — ruling 3's "at least one required" is a
 * save-blocking validation the caller (RecurrenceEditor) enforces by checking
 * `state.weeklyDays.length === 0`, but this conversion is defensive either way: an
 * invalid weekly state should never coerce into a persisted empty-days rule. `anchor` is
 * only used for `'everyN'` (today, unless the task already has a due date — the
 * caller's job to pick).
 */
export function stateToRule(state: RecurrenceState, anchor: Ymd): Rule | undefined {
  switch (state.kind) {
    case 'never':
      return undefined;
    case 'daily':
      return { kind: 'daily' };
    case 'weekdays':
      return { kind: 'weekdays' };
    case 'weekly': {
      const days = [...new Set(state.weeklyDays)].sort((a, b) => a - b);
      if (days.length === 0) return undefined;
      return { kind: 'weekly', days };
    }
    case 'monthly': {
      const dayOfMonth = Math.min(31, Math.max(1, Math.round(state.monthlyDay) || 1));
      return { kind: 'monthly', dayOfMonth };
    }
    case 'everyN': {
      const n = Math.min(365, Math.max(1, Math.round(state.everyN) || 1));
      return { kind: 'everyN', n, unit: state.everyUnit, anchor };
    }
  }
}
