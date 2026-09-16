import { useEffect, useState } from 'react';
import { dataClient } from '../features/data/api/data-client';

interface UseColumnTypesInput {
  taskId?: string;
  sourceNode?: { id: string; type: string; config?: Record<string, unknown> } | null;
}

export function useWorkflowNodeColumnTypes({
  taskId,
  sourceNode,
}: UseColumnTypesInput): Record<string, string> {
  const [columnTypes, setColumnTypes] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!taskId || !sourceNode?.id) return;
    if (!dataClient.has('getWorkflowNodeColumnTypes')) return;
    let cancelled = false;
    dataClient
      .getWorkflowNodeColumnTypes({
        taskId,
        nodeId: sourceNode.id,
        nodeType: sourceNode.type as never,
        nodeConfig: (sourceNode.config ?? {}) as Record<string, unknown>,
      })
      .then((types: Array<{ name: string; type: string }>) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const t of types) map[t.name] = t.type;
        setColumnTypes(map);
      })
      .catch((error: unknown) => {
        console.warn('[useWorkflowNodeColumnTypes] Failed to load source column types', {
          taskId,
          sourceNodeId: sourceNode.id,
          error,
        });
        if (!cancelled) setColumnTypes({});
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, sourceNode?.id, sourceNode?.type, sourceNode?.config]);

  return columnTypes;
}
