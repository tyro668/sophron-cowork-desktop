import type { ReactNode } from 'react';

interface GlassFormLabelProps {
  children: ReactNode;
  required?: boolean;
}

export function GlassFormLabel({ children, required }: GlassFormLabelProps) {
  return (
    <span className="mb-1 block text-[12px] font-medium text-text-secondary">
      {children}
      {required && <span className="ml-0.5 text-error">*</span>}
    </span>
  );
}
