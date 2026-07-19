import { useCallback } from 'react';
import type { DataWorkflowNode } from '../types';

export function useUpdateConfig(
  onNodeChange: (updater: (node: DataWorkflowNode) => DataWorkflowNode) => void
) {
  return useCallback(
    (updater: (config: Record<string, unknown>) => Record<string, unknown>) => {
      onNodeChange((current) => ({
        ...current,
        config: updater(current.config),
        updatedAt: Date.now(),
      }));
    },
    [onNodeChange]
  );
}
