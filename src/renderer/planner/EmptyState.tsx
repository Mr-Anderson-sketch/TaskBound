// renderer/planner/EmptyState — DESIGN.md "Component inventory": "Empty state (serif
// line + one hint)". Task 4.1 addendum ruling 5. `hint` is optional: Today is the only
// view with a second line (a hint to press the capture hotkey); every other view's
// empty state is a single serif line.
import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title: string;
  hint?: ReactNode;
}

export function EmptyState({ title, hint }: EmptyStateProps) {
  return (
    <div className="empty">
      <div className="e1">{title}</div>
      {hint !== undefined && <p>{hint}</p>}
    </div>
  );
}
