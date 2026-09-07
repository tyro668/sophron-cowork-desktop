import type { ReactNode } from 'react';

interface GlassFormLabelProps {
  children: ReactNode;
  className?: string;
}

export function GlassFormLabel({ children, className }: GlassFormLabelProps) {
  return (
    <span
      className={`flex h-8 w-20 shrink-0 items-center whitespace-nowrap text-[13px] text-text-secondary ${className ?? ''}`}
    >
      {children}
    </span>
  );
}
