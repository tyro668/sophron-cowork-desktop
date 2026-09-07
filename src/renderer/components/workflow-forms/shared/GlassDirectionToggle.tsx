import { useFormTranslation } from '../../../hooks/useFormTranslation';

export type SortDirection = 'asc' | 'desc';

interface GlassDirectionToggleProps {
  value: SortDirection;
  onChange: (value: SortDirection) => void;
  className?: string;
  variant?: 'default' | 'highlight';
}

export function GlassDirectionToggle({
  value,
  onChange,
  className,
  variant = 'default',
}: GlassDirectionToggleProps) {
  const tr = useFormTranslation('sortKeys');

  return (
    <button
      type="button"
      onClick={() => onChange(value === 'asc' ? 'desc' : 'asc')}
      className={`inline-flex min-h-7 items-center justify-center rounded border px-2 text-[12px] outline-none transition-colors focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 ${
        variant === 'highlight'
          ? 'border-transparent bg-[rgb(var(--color-surface-active-rgb))] text-accent-text'
          : value === 'asc'
            ? 'border-accent/30 bg-accent/10 text-accent'
            : 'border-border-muted bg-background/42 text-text-secondary hover:border-accent/30'
      } ${className ?? ''}`}
      title={value === 'asc' ? tr('asc') : tr('desc')}
      aria-label={value === 'asc' ? tr('asc') : tr('desc')}
    >
      {value === 'asc' ? tr('asc') : tr('desc')}
    </button>
  );
}
