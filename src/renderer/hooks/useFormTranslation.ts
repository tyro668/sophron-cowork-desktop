import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

export function useFormTranslation() {
  const { t } = useTranslation();
  return useCallback(
    (key: string, params?: Record<string, unknown>) => t(`data.workflow.formLabels.${key}`, params),
    [t]
  );
}
