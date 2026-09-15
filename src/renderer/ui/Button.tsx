// renderer/ui/Button — the two button treatments named in DESIGN.md's palette section:
// primary (`--accent` fill) and ghost (hairline outline).
import type { ButtonHTMLAttributes } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost';
}

export function Button({ variant = 'primary', className, ...rest }: ButtonProps) {
  const cls = ['btn', variant === 'ghost' ? 'ghost' : '', className].filter(Boolean).join(' ');
  return <button type="button" className={cls} {...rest} />;
}
