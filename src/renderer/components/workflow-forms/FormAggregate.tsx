import { useCallback } from 'react';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassTagInput } from './shared/GlassTagInput';
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

  function handleMetricsChange(items: MetricEntry[]) {
    updateConfig((cfg) => ({
      ...cfg,
      metrics: items.length > 0 ? items : undefined,
    }));
  }

  return (
    <div className="grid content-start gap-2.5">
      <GlassFormSection title="分组字段 (group by)">
        <GlassFormLabel>输入字段名后按回车添加</GlassFormLabel>
        <GlassTagInput
          value={groupBy}
          suggestions={fieldCompletions}
          onChange={(next) =>
            updateConfig((cfg) => ({
              ...cfg,
              groupBy: next.length > 0 ? next : undefined,
            }))
          }
          placeholder="输入字段名后按回车添加..."
        />
        <p className="mt-1 text-[10px] text-text-muted">留空则全表聚合 (aggregate all)。</p>
      </GlassFormSection>

      <GlassFormSection title="聚合指标 (metrics)">
        <GlassListEditor
          items={metrics}
          renderRow={(item, _index, onChange) => (
            <div className="grid gap-1.5">
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <GlassFormLabel>聚合函数</GlassFormLabel>
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
                  <GlassFormLabel required>别名 (as)</GlassFormLabel>
                  <GlassFormTextInput
                    value={item.alias}
                    onChange={(value) => onChange({ ...item, alias: value })}
                    placeholder="如 total_revenue"
                    className="h-7"
                  />
                </div>
              </div>
              <div>
                <GlassFormLabel>表达式（聚合参数）</GlassFormLabel>
                <GlassFormTextInput
                  value={item.expression}
                  onChange={(value) => onChange({ ...item, expression: value })}
                  placeholder={'如 [revenue] 或 *'}
                  className="h-7"
                />
              </div>
            </div>
          )}
          createDefault={createDefault}
          onChange={handleMetricsChange}
          addLabel="添加指标"
          emptyText="暂无聚合指标"
        />
      </GlassFormSection>
    </div>
  );
}
