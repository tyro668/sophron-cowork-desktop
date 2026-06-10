import type { ReactNode } from 'react';

interface GlassFormSectionProps {
  title?: string;
  children: ReactNode;
  className?: string;
}

export function GlassFormSection({ title, children, className = '' }: GlassFormSectionProps) {
  return (
    <div className={`glass-card space-y-2.5 rounded-xl px-3 py-2.5 ${className}`}>
      {title && <h4 className="text-[13px] font-medium text-text-primary">{title}</h4>}
      {children}
    </div>
  );
}
