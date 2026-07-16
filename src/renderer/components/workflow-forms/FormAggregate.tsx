import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OperatorFormProps } from './index';
import { GlassFieldMultiSelect } from './shared/GlassFieldMultiSelect';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import { GlassExpressionInput } from './shared/GlassExpressionInput';
import { GlassRowList, type RowAction } from './shared/GlassRowList';

const AGG_FUNCTIONS = [
  'count',
  'count_distinct',
  'sum',
  'avg',
  'min',
  'max',
  'median',
  'mode',
  'first',
  'last',
  'stddev_samp',
  'stddev_pop',
  'var_samp',
  'var_pop',
  'string_agg',
  'list',
  'quantile_cont',
  'quantile_disc',
  'approx_count_distinct',
  'approx_quantile',
  'approx_top_k',
];

interface MetricEntry {
  function: string;
  expression: string;
  alias: string;
}

function createDefault(): MetricEntry {
  return { function: 'count', expression: '', alias: '' };
}

export default function FormAggregate({
  node,
  fieldCompletions,
  sourceNode,
  taskId,
  onNodeChange,
}: OperatorFormProps) {
  const { t } = useTranslation();
  const tr = useCallback(
    (key: string, fallback: string) =>
      t(`data.workflow.formLabels.${key}`, { defaultValue: fallback }),
    [t]
  );

  const [columnTypes, setColumnTypes] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!taskId || !sourceNode?.id) return;
    const api = window.electronAPI?.data;
    if (!api?.getWorkflowNodeColumnTypes) return;
    api
      .getWorkflowNodeColumnTypes({
        taskId,
        nodeId: sourceNode.id,
        nodeType: sourceNode.type as never,
        nodeConfig: (sourceNode.config ?? {}) as Record<string, unknown>,
      })
      .then((types: Array<{ name: string; type: string }>) => {
        const map: Record<string, string> = {};
        for (const t of types) map[t.name] = t.type;
        setColumnTypes(map);
      })
      .catch(() => console.error('Failed to fetch column types for aggregate form'));
  }, [taskId, sourceNode?.id, sourceNode?.type, sourceNode?.config]);

  const updateConfig = useCallback(
    (updater: (config: Record<string, unknown>) => Record<string, unknown>) => {
      onNodeChange((current) => ({
        ...current,
        config: updater(current.config),
        updatedAt: Date.now(),
      }));
    },
    [onNodeChange]
  );

  const groupBy = useMemo(() => (node.config.groupBy as string[]) ?? [], [node.config.groupBy]);
  const rawMetrics = useMemo(
    () => (node.config.metrics as MetricEntry[]) ?? [],
    [node.config.metrics]
  );
  const metrics = useMemo(
    () => (rawMetrics.length > 0 ? rawMetrics : [createDefault()]),
    [rawMetrics]
  );

  const functionGroups = useMemo(
    () => [
      {
        key: 'default',
        items: AGG_FUNCTIONS.map((f) => ({
          value: f,
          label: tr('aggregateFn_' + f, f),
        })),
      },
    ],
    [tr]
  );

  const handleGroupByChange = useCallback(
    (next: string[]) => {
      updateConfig((cfg) => ({
        ...cfg,
        groupBy: next.length > 0 ? next : undefined,
      }));
    },
    [updateConfig]
  );

  const handleMetricsChange = useCallback(
    (items: MetricEntry[]) => {
      updateConfig((cfg) => ({
        ...cfg,
        metrics: items.length > 0 ? items : undefined,
      }));
    },
    [updateConfig]
  );

  function updateMetric(index: number, partial: Partial<MetricEntry>) {
    handleMetricsChange(metrics.map((item, i) => (i === index ? { ...item, ...partial } : item)));
  }

  function addMetricAfter(index: number) {
    const hasEmpty = activeMetrics.some((m) => !m.expression);
    if (hasEmpty) return;
    const entry = createDefault();
    handleMetricsChange([
      ...activeMetrics.slice(0, index + 1),
      entry,
      ...activeMetrics.slice(index + 1),
    ]);
  }

  function removeMetric(index: number) {
    let next = activeMetrics.filter((_, i) => i !== index);
    const firstEmpty = next.findIndex((m) => !m.expression);
    if (firstEmpty >= 0) {
      next = next.filter((m, i) => i === firstEmpty || m.expression);
    }
    handleMetricsChange(next);
  }

  // ── Drag-to-reorder state ──
  const dragIndexRef = useRef<number | null>(null);
  const [dragMetrics, setDragMetrics] = useState<MetricEntry[] | null>(null);

  const activeMetrics = dragMetrics ?? metrics;

  const handleDragStart = useCallback(
    (index: number) => {
      dragIndexRef.current = index;
      setDragMetrics([...metrics]);
    },
    [metrics]
  );

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndexRef.current === null || dragIndexRef.current === index) return;
    const from = dragIndexRef.current;
    setDragMetrics((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(index, 0, moved);
      return next;
    });
    dragIndexRef.current = index;
  }, []);

  const handleDragEnd = useCallback(() => {
    if (dragMetrics && dragIndexRef.current !== null) {
      handleMetricsChange(dragMetrics);
    }
    dragIndexRef.current = null;
    setDragMetrics(null);
  }, [dragMetrics, handleMetricsChange]);

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <div className="flex gap-2.5 flex-1 min-h-0">
        {/* Left: group-by fields */}
        <div className="flex-[1.5] rounded-lg border border-border-muted bg-background/42 content-start flex flex-col min-h-0">
          <div className="flex items-end gap-3 px-3 pt-2.5 pb-1.5 shrink-0">
            <span className="h-8 w-8 rounded-full bg-accent/20 text-[14px] font-bold text-accent flex items-center justify-center leading-none">
              1
            </span>
            <div className="grid">
              <span className="text-[13px] font-semibold text-text-primary">
                {tr('aggregateGroupBy', '分组字段')}
              </span>
              <span className="text-[10px] text-text-muted">
                {tr('aggregateGroupByHint', '选择分组的字段')}
              </span>
            </div>
          </div>
          <div className="flex-1 min-h-0 px-3 pb-3 flex flex-col">
            <GlassFieldMultiSelect
              columns={fieldCompletions}
              selected={groupBy}
              onChange={handleGroupByChange}
              columnTypes={columnTypes}
              maxHeight="none"
            />
          </div>
        </div>

        {/* Right: metrics */}
        <div className="flex-[8.5] rounded-lg border border-border-muted bg-background/42 content-start flex flex-col min-h-0">
          <div className="flex items-end gap-3 px-3 pt-2.5 pb-1.5 shrink-0">
            <span className="h-8 w-8 rounded-full bg-accent/20 text-[14px] font-bold text-accent flex items-center justify-center leading-none">
              2
            </span>
            <div className="grid">
              <span className="text-[13px] font-semibold text-text-primary">
                {tr('aggregateMetric', '聚合指标')}
              </span>
              <span className="text-[10px] text-text-muted">
                {tr('aggregateMetricHint', '配置聚合函数和别名')}
              </span>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
            <GlassRowList
              items={activeMetrics}
              columns={[
                {
                  flex: 'flex-[2.5]',
                  header: tr('aggregateFunction', '聚合函数'),
                  render: (item: MetricEntry, i: number) => (
                    <GlassOptionSingleSelect
                      value={item.function}
                      groups={functionGroups}
                      onChange={(v) => updateMetric(i, { function: v })}
                      className="h-7 rounded-md text-[12px] w-full"
                    />
                  ),
                },
                {
                  flex: 'flex-[3.5]',
                  header: tr('expressionLabel', '表达式'),
                  render: (item: MetricEntry, i: number) => (
                    <GlassExpressionInput
                      value={item.expression}
                      onChange={(v) => updateMetric(i, { expression: v })}
                      fieldCompletions={fieldCompletions}
                      columnTypes={columnTypes}
                      placeholder={tr('aggregateExpressionPlaceholder', '输入表达式')}
                    />
                  ),
                },
                {
                  flex: 'flex-[2]',
                  header: tr('aggregateAlias', '别名 (as)'),
                  render: (item: MetricEntry, i: number) => (
                    <GlassFormTextInput
                      value={item.alias ?? ''}
                      onChange={(v) => updateMetric(i, { alias: v })}
                      placeholder={tr('aggregateAliasPlaceholder', '如 total_revenue')}
                      className="h-7 px-1.5 text-[12px] w-full"
                    />
                  ),
                },
              ]}
              onAdd={(i) => addMetricAfter(i)}
              onRemove={(i) => removeMetric(i)}
              addTitle={tr('aggregateAddMetric', '添加配置')}
              removeTitle={tr('aggregateRemoveMetric', '删除配置')}
              canAct={(action: RowAction, _i) =>
                action === 'add' ? !activeMetrics.some((m) => !m.expression) : true
              }
              draggable
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              getRowOpacity={(i) => !!(dragMetrics && dragIndexRef.current === i)}
              dragTitle={tr('dragToReorder', '拖拽排序')}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
