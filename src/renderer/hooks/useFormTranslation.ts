import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * formLabels 分层解析规则：
 * - key 含 '.'：视为完整子路径（如 'aggregateFns.sum' → formLabels.aggregateFns.sum），
 *   供跨组消费方显式指定子目录；
 * - 否则按 `<ns>.<key>` → `common.<key>` 回退；Form 组件传入自己的算子命名空间，
 *   共享控件传入自己的组件命名空间（如 'rowList'）；
 * - 不传 ns 的调用只查 common。
 */
export function useFormTranslation(ns?: string) {
  const { t } = useTranslation();
  return useCallback(
    (key: string, params?: Record<string, unknown>) => {
      if (key.includes('.')) {
        return t(`data.workflow.formLabels.${key}`, params);
      }
      const keys = ns
        ? [`data.workflow.formLabels.${ns}.${key}`, `data.workflow.formLabels.common.${key}`]
        : `data.workflow.formLabels.common.${key}`;
      return t(keys, params);
    },
    [t, ns]
  );
}
