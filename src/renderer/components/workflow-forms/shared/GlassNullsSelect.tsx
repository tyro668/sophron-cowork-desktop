import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { GlassOperatorSelect } from './GlassOperatorSelect';

interface GlassNullsSelectProps {
  value: 'first' | 'last' | undefined | null | '';
  onChange: (value: 'first' | 'last' | undefined) => void;
  className?: string;
}

export function GlassNullsSelect({ value, onChange, className }: GlassNullsSelectProps) {
  const { t } = useTranslation();

  const groups = useMemo(
    () => [
      {
        key: 'nulls',
        items: [
          { value: '', label: t('data.workflow.formLabels.sortNullsDefault', '空值默认') },
          { value: 'first', label: t('data.workflow.formLabels.sortNullsFirst', '空值在前') },
          { value: 'last', label: t('data.workflow.formLabels.sortNullsLast', '空值在后') },
        ],
      },
    ],
    [t]
  );

  return (
    <GlassOperatorSelect
      value={value ?? ''}
      groups={groups}
      onChange={(v) => onChange((v || undefined) as 'first' | 'last' | undefined)}
      className={className}
    />
  );
}
