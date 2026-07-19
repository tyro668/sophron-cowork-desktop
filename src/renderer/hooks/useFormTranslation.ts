import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

export function useFormTranslation() {
  const { t } = useTranslation();
  return useCallback(
    (key: string, fallback: string) =>
      t(`data.workflow.formLabels.${key}`, { defaultValue: fallback }),
    [t]
  );
}
