import React from 'react';
import { cn } from './cn';

export type BadgeTone = 'default' | 'accent' | 'success' | 'warning' | 'error';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

const toneClasses: Record<BadgeTone, string> = {
  default: 'border-border-subtle bg-surface-muted text-text-secondary',
  accent: 'border-accent/20 bg-accent-muted text-accent-text',
  success: 'border-success/20 bg-success/10 text-success',
  warning: 'border-warning/20 bg-warning/10 text-warning',
  error: 'border-error/20 bg-error/10 text-error',
};

export function Badge({ tone = 'default', className, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex select-none items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium leading-4',
        toneClasses[tone],
        className
      )}
      {...rest}
    />
  );
}
