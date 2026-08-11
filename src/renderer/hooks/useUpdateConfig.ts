import { useCallback } from 'react';
import type { DataWorkflowNode } from '../types';

export function useUpdateConfig(
  onNodeChange: (updater: (node: DataWorkflowNode) => DataWorkflowNode) => void
) {
  return useCallback(
    (updater: (config: Record<string, unknown>) => Record<string, unknown>) => {
      onNodeChange((current) => {
        const nextConfig = updater(current.config);
        return {
          ...current,
          config: {
            ...nextConfig,
            dsl: undefined,
          },
          updatedAt: Date.now(),
        };
      });
    },
    [onNodeChange]
  );
}
