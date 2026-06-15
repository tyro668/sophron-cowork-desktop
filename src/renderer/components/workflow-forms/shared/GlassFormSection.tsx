import type { ReactNode } from 'react';

interface GlassFormSectionProps {
  title?: string;
  children: ReactNode;
  className?: string;
}

export function GlassFormSection({ title, children, className = '' }: GlassFormSectionProps) {
  return (
    <div className={`space-y-2 ${className}`}>
      {title && <h4 className="text-[12px] font-medium text-text-secondary">{title}</h4>}
      {children}
    </div>
  );
}
