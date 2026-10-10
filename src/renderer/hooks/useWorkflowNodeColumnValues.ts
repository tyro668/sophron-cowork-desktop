import { useCallback, useEffect, useRef, useState } from 'react';
import { dataClient } from '../features/data/api/data-client';

interface UseColumnValuesInput {
  pipelineId?: string;
  sourceNode?: { id: string; type: string; config?: Record<string, unknown> } | null;
  column?: string;
}

export interface WorkflowNodeColumnValuesResult {
  values: string[];
  loading: boolean;
  loaded: boolean;
  error: boolean;
  reload: () => void;
}

/**
 * 获取上游工作流节点指定字段的唯一值列表。
 *
 * 在透视（pivot）等操作中，需要让用户选择字段的取值作为"固定值域"（IN 子句）。
 * 此 hook 通过 electronAPI.data.getWorkflowNodeColumnValues 查询上游表的
 * SELECT DISTINCT column FROM table 结果，返回 { values, loading, error, reload }。
 *
 * 查询只由 reload() 驱动（挂载时不自动查询），调用方通常在"展开下拉"时调用它，
 * 实现"每次展开重新查询"的懒加载语义。这样：
 * - 切 tab 重挂载不会自动查库转圈；
 * - 失败后关闭再展开可重新查询重试；
 * - 每次展开都反映上游表当前内容，避免返回过期数据。
 *
 * 当 pipelineId/sourceNode/column 任一为空时返回空状态，这不算错误，仅表示条件不满足。
 */
export function useWorkflowNodeColumnValues({
  pipelineId,
  sourceNode,
  column,
}: UseColumnValuesInput): WorkflowNodeColumnValuesResult {
  const [values, setValues] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [queryToken, setQueryToken] = useState(0);

  // 最新查询参数，供 reload 驱动的查询 effect 读取，避免依赖 column 变化自动触发查询。
  const paramsRef = useRef<{
    pipelineId?: string;
    sourceNode?: typeof sourceNode;
    column?: string;
  }>({
    pipelineId,
    sourceNode,
    column,
  });
  paramsRef.current = { pipelineId, sourceNode, column };

  // 字段变化时清空旧结果，回到"未查询"空态，避免展示上一字段的候选值。
  useEffect(() => {
    setValues([]);
    setLoading(false);
    setLoaded(false);
    setError(false);
  }, [pipelineId, sourceNode?.id, sourceNode?.type, sourceNode?.config, column]);

  // 查询只由 reload()（queryToken）驱动；queryToken === 0 表示尚未发起过查询（懒加载）。
  useEffect(() => {
    if (queryToken === 0) return;
    const {
      pipelineId: currentPipelineId,
      sourceNode: currentSourceNode,
      column: currentColumn,
    } = paramsRef.current;
    if (!currentPipelineId || !currentSourceNode?.id || !currentColumn) return;
    if (!dataClient.has('getWorkflowNodeColumnValues')) {
      setValues([]);
      setLoading(false);
      setLoaded(false);
      setError(true);
      return;
    }
    let cancelled = false;
    setValues([]);
    setLoading(true);
    setLoaded(false);
    setError(false);
    dataClient
      .getWorkflowNodeColumnValues({
        pipelineId: currentPipelineId,
        nodeId: currentSourceNode.id,
        nodeType: currentSourceNode.type as never,
        nodeConfig: (currentSourceNode.config ?? {}) as Record<string, unknown>,
        column: currentColumn,
      })
      .then((result) => {
        if (cancelled) return;
        setValues(result);
        setLoading(false);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setValues([]);
        setError(true);
        setLoading(false);
        setLoaded(false);
      });
    return () => {
      cancelled = true;
    };
  }, [queryToken]);

  const reload = useCallback(() => setQueryToken((token) => token + 1), []);

  return { values, loading, loaded, error, reload };
}
