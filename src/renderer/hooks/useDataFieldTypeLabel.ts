import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { isDataFieldType } from '../../shared/data-field-types';

export function useDataFieldTypeLabel() {
  const { t } = useTranslation();
  return useCallback(
    (type: string | null | undefined) => {
      const raw = String(type ?? '').trim();
      if (!raw || !isDataFieldType(raw)) {
        return t('data.workflow.formLabels.common.dataTypeUnknown');
      }
      const key = 'dataType' + raw.charAt(0).toUpperCase() + raw.slice(1);
      return t(`data.workflow.formLabels.common.${key}`);
    },
    [t]
  );
}
