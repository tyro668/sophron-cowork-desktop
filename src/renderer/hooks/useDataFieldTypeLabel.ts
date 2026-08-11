import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { normalizeDataFieldType } from '../../shared/data-field-types';

export function useDataFieldTypeLabel() {
  const { t } = useTranslation();
  return useCallback(
    (type: string | null | undefined) => {
      const normalized = normalizeDataFieldType(type);
      const key = 'dataType' + normalized.charAt(0).toUpperCase() + normalized.slice(1);
      return t(`data.workflow.formLabels.${key}`);
    },
    [t]
  );
}
