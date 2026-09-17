import React from 'react';
import { cn } from './cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Error state — swaps border/focus ring to the error tone. */
  error?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ error = false, className, ...rest }, ref) => (
    <input
      ref={ref}
      aria-invalid={error || undefined}
      className={cn(
        'h-8 w-full rounded-lg border bg-surface px-2.5 text-[13px] text-text-primary transition-colors',
        'placeholder:text-text-muted',
        'focus-visible:outline-none focus-visible:ring-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        error
          ? 'border-error focus-visible:border-error focus-visible:ring-error/25'
          : 'border-border-muted focus-visible:border-accent focus-visible:ring-accent/25',
        className
      )}
      {...rest}
    />
  )
);
Input.displayName = 'Input';
