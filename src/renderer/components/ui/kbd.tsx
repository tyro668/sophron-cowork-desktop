import type { ReactNode } from 'react';
import { cn } from './cn';

export interface KbdProps {
  children: ReactNode;
  size?: 'xs' | 'sm';
  className?: string;
}

export function Kbd({ children, size = 'sm', className }: KbdProps) {
  return (
    <kbd
      className={cn(
        'inline-flex items-center justify-center border bg-surface font-sans text-text-secondary',
        size === 'xs'
          ? 'rounded border-border-subtle px-1 text-[10.5px] leading-4'
          : 'h-6 min-w-6 rounded-md border-border-muted px-1.5 text-xs',
        className
      )}
    >
      {children}
    </kbd>
  );
}
