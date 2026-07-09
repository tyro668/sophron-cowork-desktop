import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

export type SortDirection = 'asc' | 'desc';

interface GlassDirectionToggleProps {
  value: SortDirection;
  onChange: (value: SortDirection) => void;
  className?: string;
}

export function GlassDirectionToggle({ value, onChange, className }: GlassDirectionToggleProps) {
  const { t } = useTranslation();
  const tr = useCallback(
    (key: string, fallback: string) =>
      t(`data.workflow.formLabels.${key}`, { defaultValue: fallback }),
    [t]
  );

  return (
    <button
      type="button"
      onClick={() => onChange(value === 'asc' ? 'desc' : 'asc')}
      className={`inline-flex items-center justify-center rounded border outline-none transition-colors focus:border-accent ${
        value === 'asc'
          ? 'border-accent/30 bg-accent/10 text-accent'
          : 'border-border-muted bg-background/42 text-text-secondary hover:border-accent/30'
      } ${className ?? ''}`}
      title={value === 'asc' ? tr('asc', '升序') : tr('desc', '降序')}
      aria-label={value === 'asc' ? tr('asc', '升序') : tr('desc', '降序')}
    >
      {value === 'asc' ? tr('asc', '升序') : tr('desc', '降序')}
    </button>
  );
}
