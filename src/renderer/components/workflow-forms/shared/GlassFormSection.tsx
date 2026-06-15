import type { ReactNode } from 'react';

interface GlassFormSectionProps {
  title?: string;
  children: ReactNode;
  className?: string;
}

export function GlassFormSection({ title, children, className = '' }: GlassFormSectionProps) {
  return (
    <div className={`space-y-2.5 ${className}`}>
      {title && (
        <div className="flex items-center gap-2 border-b border-border-muted/50 pb-2">
          <span className="h-1.5 w-1.5 rounded-full bg-accent/50" />
          <h4 className="text-[12px] font-semibold text-text-secondary">{title}</h4>
        </div>
      )}
      {children}
    </div>
  );
}
