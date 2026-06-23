import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

interface GlassNullsSelectProps {
  value: 'first' | 'last' | undefined | null | '';
  onChange: (value: 'first' | 'last' | undefined) => void;
  className?: string;
}

export function GlassNullsSelect({ value, onChange, className }: GlassNullsSelectProps) {
  const { t } = useTranslation();
  const tr = useCallback(
    (key: string, fallback: string) =>
      t(`data.workflow.formLabels.${key}`, { defaultValue: fallback }),
    [t]
  );

  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange((e.target.value || undefined) as 'first' | 'last' | undefined)}
      className={className}
      aria-label={tr('sortNullsHeader', '空值处理方式')}
    >
      <option value="">{tr('sortNullsDefault', '空值默认')}</option>
      <option value="first">{tr('sortNullsFirst', '空值在前')}</option>
      <option value="last">{tr('sortNullsLast', '空值在后')}</option>
    </select>
  );
}
