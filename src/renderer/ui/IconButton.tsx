// renderer/ui/IconButton — a 24×24 icon-only control. `label` is required: it becomes
// the `aria-label` (DESIGN.md/WCAG: "nothing interactive under 24 × 24 CSS px", and
// every panel row action needs an accessible name — see the brief's "Complete",
// "Skip", "Snooze until tomorrow").
import type { ButtonHTMLAttributes } from 'react';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  label: string;
}

export function IconButton({ label, className, children, ...rest }: IconButtonProps) {
  const cls = ['icon-btn', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}
