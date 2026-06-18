import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';
import { GlassFormLabel } from './shared/GlassFormLabel';

import { GlassMultiSelect } from './shared/GlassMultiSelect';
import { GlassListEditor } from './shared/GlassListEditor';

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
  return { function: 'count', expression: '*', alias: '' };
}

export default function FormAggregate({ node, fieldCompletions, onNodeChange }: OperatorFormProps) {
  const { t } = useTranslation();
  const tr = useCallback(
    (key: string, fallback: string) =>
      t(`data.workflow.formLabels.${key}`, { defaultValue: fallback }),
    [t]
  );

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

  const groupBy: string[] = (node.config.groupBy as string[]) ?? [];
  const metrics: MetricEntry[] = (node.config.metrics as MetricEntry[]) ?? [];

  const expressionCompletions = useMemo(
    () => ['*', ...fieldCompletions.map((c) => `[${c}]`)],
    [fieldCompletions]
  );

  // Track which metric indices are in custom text-input mode
  const [customIndices, setCustomIndices] = useState<Set<number>>(new Set());
  const prevMetricsLen = useRef(metrics.length);
  useEffect(() => {
    if (metrics.length !== prevMetricsLen.current) {
      prevMetricsLen.current = metrics.length;
      setCustomIndices(new Set());
    }
  }, [metrics.length]);

  function handleMetricsChange(items: MetricEntry[]) {
    updateConfig((cfg) => ({
      ...cfg,
      metrics: items.length > 0 ? items : undefined,
    }));
  }

  return (
    <div className="grid content-start gap-2.5">
      {/* Group by — multi-select dropdown */}
      <GlassFormSection title={tr('aggregateGroupBy', '选择字段')}>
        <p className="mb-2 text-[11px] text-text-muted">
          {tr('aggregateGroupByHint', '可选择多个字段作为分组依据，不选则全表聚合。')}
        </p>
        <GlassMultiSelect
          value={groupBy}
          suggestions={fieldCompletions}
          onChange={(next) =>
            updateConfig((cfg) => ({
              ...cfg,
              groupBy: next.length > 0 ? next : undefined,
            }))
          }
          placeholder={tr('aggregateGroupByPlaceholder', '选择分组字段...')}
        />
      </GlassFormSection>

      {/* Metrics */}
      <GlassFormSection title={tr('aggregateMetrics', '聚合指标')}>
        <GlassListEditor
          items={metrics}
          renderRow={(item, index, onChange) => (
            <div className="grid gap-1.5">
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <GlassFormLabel>{tr('aggregateFunction', '聚合函数')}</GlassFormLabel>
                  <select
                    value={item.function}
                    onChange={(e) => onChange({ ...item, function: e.target.value })}
                    className="h-7 w-full rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-secondary outline-none focus:border-accent"
                  >
                    {AGG_FUNCTIONS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <GlassFormLabel required>{tr('aggregateAlias', '别名 (as)')}</GlassFormLabel>
                  <input
                    type="text"
                    value={item.alias ?? ''}
                    onChange={(e) => onChange({ ...item, alias: e.target.value })}
                    placeholder={tr('aggregateAliasPlaceholder', '如 total_revenue')}
                    className={`h-7 w-full rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent ${
                      !(item.alias ?? '').trim() ? '!border-warning/60' : ''
                    }`}
                  />
                </div>
              </div>
              <div>
                <GlassFormLabel>{tr('expressionLabel', '表达式')}</GlassFormLabel>
                {customIndices.has(index) ||
                (!expressionCompletions.includes(item.expression) && item.expression !== '') ? (
                  <div className="flex gap-1.5">
                    <input
                      autoFocus
                      value={item.expression}
                      onChange={(e) => onChange({ ...item, expression: e.target.value })}
                      placeholder={tr(
                        'aggregateExpressionPlaceholder',
                        '输入表达式，如 [price] * [qty]'
                      )}
                      className="h-7 flex-1 rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-primary outline-none focus:border-accent placeholder:text-text-muted"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setCustomIndices((prev) => {
                          const next = new Set(prev);
                          next.delete(index);
                          return next;
                        });
                        onChange({ ...item, expression: '*' });
                      }}
                      className="h-7 flex-shrink-0 rounded-md border border-border-muted bg-background/42 px-1.5 text-[11px] text-text-muted hover:text-text-secondary"
                    >
                      {tr('aggregateSelectField', '选择字段')}
                    </button>
                  </div>
                ) : (
                  <select
                    value={item.expression}
                    onChange={(e) => {
                      if (e.target.value === '__custom__') {
                        setCustomIndices((prev) => new Set(prev).add(index));
                        onChange({ ...item, expression: '' });
                      } else {
                        onChange({ ...item, expression: e.target.value });
                      }
                    }}
                    className="h-7 w-full rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-secondary outline-none focus:border-accent"
                  >
                    <option value="__custom__">{tr('aggregateCustom', '自定义...')}</option>
                    {expressionCompletions.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          )}
          createDefault={createDefault}
          onChange={handleMetricsChange}
          addLabel={tr('aggregateAddMetric', '添加指标')}
          emptyText={tr('aggregateNoMetrics', '暂无聚合指标')}
        />
      </GlassFormSection>
    </div>
  );
}
