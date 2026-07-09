import { useEffect, useState } from 'react';

interface UseColumnValuesInput {
  taskId?: string;
  sourceNode?: { id: string; type: string; config?: Record<string, unknown> } | null;
  column?: string;
}

/**
 * 获取上游工作流节点指定字段的唯一值列表。
 *
 * 在透视（pivot）等操作中，需要让用户选择字段的取值作为"固定值域"（IN 子句）。
 * 此 hook 通过 electronAPI.data.getWorkflowNodeColumnValues 查询上游表的
 * SELECT DISTINCT column FROM table 结果，返回 string[]。
 *
 * 当 taskId/sourceNode/column 任一为空时返回空数组。
 * 查询失败时同样返回空数组（静默降级）。
 */
export function useWorkflowNodeColumnValues({
  taskId,
  sourceNode,
  column,
}: UseColumnValuesInput): string[] {
  const [values, setValues] = useState<string[]>([]);

  useEffect(() => {
    if (!taskId || !sourceNode?.id || !column) return;
    const api = window.electronAPI?.data;
    if (!api?.getWorkflowNodeColumnValues) return;
    let cancelled = false;
    api
      .getWorkflowNodeColumnValues({
        taskId,
        nodeId: sourceNode.id,
        nodeType: sourceNode.type as never,
        nodeConfig: (sourceNode.config ?? {}) as Record<string, unknown>,
        column,
      })
      .then((result) => {
        if (!cancelled) setValues(result);
      })
      .catch(() => {
        if (!cancelled) setValues([]);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, sourceNode?.id, sourceNode?.type, sourceNode?.config, column]);

  return values;
}
