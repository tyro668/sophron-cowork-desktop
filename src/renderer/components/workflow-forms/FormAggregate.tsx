import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Trash2, X } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';
import { GlassRowList } from './shared/GlassRowList';
import { GlassOperatorSelect } from './shared/GlassOperatorSelect';
import { GlassExpressionInput } from './shared/GlassExpressionInput';

import { GlassColumnSelector } from './shared/GlassColumnSelector';

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

  const [showGroupByPicker, setShowGroupByPicker] = useState(false);

  function handleMetricsChange(items: MetricEntry[]) {
    updateConfig((cfg) => ({
      ...cfg,
      metrics: items.length > 0 ? items : undefined,
    }));
  }

  function updateMetric(index: number, partial: Partial<MetricEntry>) {
    handleMetricsChange(metrics.map((item, i) => (i === index ? { ...item, ...partial } : item)));
  }

  function addMetricAfter(index: number) {
    const entry = createDefault();
    handleMetricsChange([...metrics.slice(0, index + 1), entry, ...metrics.slice(index + 1)]);
  }

  function removeMetric(index: number) {
    handleMetricsChange(metrics.filter((_, i) => i !== index));
  }

  const handleGroupByChange = useCallback(
    (next: string[]) => {
      updateConfig((cfg) => ({
        ...cfg,
        groupBy: next.length > 0 ? next : undefined,
      }));
    },
    [updateConfig]
  );

  const removeGroupByField = useCallback(
    (col: string) => {
      handleGroupByChange(groupBy.filter((c) => c !== col));
    },
    [groupBy, handleGroupByChange]
  );

  return (
    <div className="flex flex-col min-h-0 overflow-hidden" style={{ height: '100%' }}>
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col gap-2.5">
        {/* Group by — collapsible field selector */}
        <div className="flex-shrink-0 flex min-h-7 items-center rounded-md border border-border-muted bg-background/42 focus-within:border-accent">
          {groupBy.length > 0 && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleGroupByChange([]);
              }}
              className="ml-1 inline-flex flex-shrink-0 items-center justify-center self-stretch rounded px-1 text-text-muted hover:text-error hover:bg-error/10 transition-colors"
              title={tr('clearAll', '清空')}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
          <div className="flex flex-1 flex-wrap items-center gap-1 px-1.5 py-1">
            {groupBy.map((col) => (
              <span
                key={col}
                className="inline-flex items-center gap-0.5 rounded bg-accent/10 px-1.5 py-0.5 text-[12px] font-medium text-accent"
              >
                {col}
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    removeGroupByField(col);
                  }}
                  className="ml-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full hover:bg-accent/20"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
            <input
              type="text"
              readOnly
              placeholder={
                groupBy.length === 0 ? tr('aggregateGroupByPlaceholder', '选择分组字段...') : ''
              }
              onFocus={() => setShowGroupByPicker(true)}
              className="h-5 min-w-[60px] flex-1 bg-transparent text-[12px] text-text-primary outline-none placeholder:text-text-muted cursor-pointer"
            />
          </div>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setShowGroupByPicker((v) => !v);
            }}
            className="flex w-7 items-center justify-center border-l border-border-muted text-text-muted hover:text-text-secondary transition-colors rounded-r-md"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${showGroupByPicker ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
        {showGroupByPicker && (
          <GlassColumnSelector
            columns={fieldCompletions}
            selected={groupBy}
            onChange={handleGroupByChange}
            maxHeight="200px"
          />
        )}

        {/* Metrics */}
        <GlassFormSection className="flex-1 min-h-0 overflow-y-auto">
          <GlassRowList
            items={metrics}
            columns={[
              {
                flex: 'flex-[2]',
                header: tr('aggregateFunction', '聚合函数'),
                render: (item: MetricEntry, index) => (
                  <GlassOperatorSelect
                    value={item.function}
                    groups={functionGroups}
                    onChange={(v) => updateMetric(index, { function: v })}
                    className="w-full"
                  />
                ),
              },
              {
                flex: 'flex-[4]',
                header: tr('expressionLabel', '表达式'),
                render: (item: MetricEntry, index) => (
                  <GlassExpressionInput
                    value={item.expression}
                    onChange={(v) => updateMetric(index, { expression: v })}
                    fieldCompletions={fieldCompletions}
                    columnTypes={columnTypes}
                    placeholder={tr('aggregateExpressionPlaceholder', '输入表达式')}
                  />
                ),
              },
              {
                flex: 'flex-[2]',
                header: tr('aggregateAlias', '别名 (as)'),
                render: (item: MetricEntry, index) => (
                  <input
                    type="text"
                    value={item.alias ?? ''}
                    onChange={(e) => updateMetric(index, { alias: e.target.value })}
                    placeholder={tr('aggregateAliasPlaceholder', '如 total_revenue')}
                    className={`h-7 w-full rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent ${
                      !(item.alias ?? '').trim() ? '!border-warning/60' : ''
                    }`}
                  />
                ),
              },
            ]}
            onAdd={addMetricAfter}
            onRemove={removeMetric}
            addTitle={tr('aggregateAddMetric', '添加配置')}
            removeTitle={tr('aggregateRemoveMetric', '删除配置')}
          />
        </GlassFormSection>
      </div>
    </div>
  );
}
