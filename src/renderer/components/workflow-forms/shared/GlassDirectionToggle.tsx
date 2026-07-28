import { useFormTranslation } from '../../../hooks/useFormTranslation';

export type SortDirection = 'asc' | 'desc';

interface GlassDirectionToggleProps {
  value: SortDirection;
  onChange: (value: SortDirection) => void;
  className?: string;
}

export function GlassDirectionToggle({ value, onChange, className }: GlassDirectionToggleProps) {
  const tr = useFormTranslation();

  return (
    <button
      type="button"
      onClick={() => onChange(value === 'asc' ? 'desc' : 'asc')}
      className={`inline-flex items-center justify-center rounded border outline-none transition-colors focus:border-accent ${
        value === 'asc'
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
