import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassTagInput } from './shared/GlassTagInput';

const PIVOT_FUNCTIONS = ['sum', 'avg', 'min', 'max', 'count', 'count_distinct'];

interface PivotMetric {
  function: string;
  expression: string;
  alias?: string;
}

export default function FormPivot({ node, fieldCompletions, onNodeChange }: OperatorFormProps) {
  const { t } = useTranslation();
  const tr = useCallback(
    (key: string, fallback: string) => t(`formLabels.${key}`, { defaultValue: fallback }),
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

  const onFields: string[] = (node.config.on as string[]) ?? [];
  const values: string[] = (node.config.values as string[]) ?? [];
  const using: PivotMetric[] = (node.config.using as PivotMetric[]) ?? [];
  const groupBy: string[] = (node.config.groupBy as string[]) ?? [];
  const singleMetric = using[0] ?? { function: 'sum', expression: '' };

  function handleMetricChange(patch: Partial<PivotMetric>) {
    const merged = {
      ...singleMetric,
      ...patch,
      expression: patch.expression ?? singleMetric.expression,
    };
    updateConfig((cfg) => ({
      ...cfg,
      using: merged.expression ? [merged] : undefined,
    }));
  }

  return (
    <div className="grid content-start gap-2.5">
      <GlassFormSection title={tr('pivotOn', '透视列 (on)')}>
        <GlassFormLabel required>{tr('pivotOnLabel', '按哪些字段透视')}</GlassFormLabel>
        <GlassTagInput
          value={onFields}
          suggestions={fieldCompletions}
          onChange={(next) =>
            updateConfig((cfg) => ({ ...cfg, on: next.length > 0 ? next : undefined }))
          }
          placeholder={tr('pivotOnPlaceholder', '输入字段名后按回车添加...')}
        />
      </GlassFormSection>

      <GlassFormSection title={tr('pivotIn', '固定值域 (in) — 可选')}>
        <GlassFormLabel>{tr('pivotInLabel', '限制透视值（留空则动态生成）')}</GlassFormLabel>
        <GlassTagInput
          value={values}
          onChange={(next) =>
            updateConfig((cfg) => ({ ...cfg, values: next.length > 0 ? next : undefined }))
          }
          placeholder={tr('pivotInPlaceholder', '如 2024, 2025, 2026')}
        />
        <p className="mt-1 text-[10px] text-text-muted">
          {tr('pivotInHint', '显式指定 in 值可固定输出 schema，避免列随数据变化。')}
        </p>
      </GlassFormSection>

      <GlassFormSection title={tr('pivotUsing', '聚合指标 (using)')}>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <GlassFormLabel>{tr('aggregateFunction', '聚合函数')}</GlassFormLabel>
            <select
              value={singleMetric.function}
              onChange={(e) => handleMetricChange({ function: e.target.value })}
              className="h-7 w-full rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-secondary outline-none focus:border-accent"
            >
              {PIVOT_FUNCTIONS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <div>
            <GlassFormLabel>{tr('expressionLabel', '表达式')}</GlassFormLabel>
            <GlassFormTextInput
              value={singleMetric.expression}
              onChange={(value) => handleMetricChange({ expression: value })}
              placeholder={tr('aggregateAliasPlaceholder', '如 total_revenue')}
              className="h-7"
            />
          </div>
        </div>
      </GlassFormSection>

      <GlassFormSection title={tr('pivotGroupBy', '分组字段 (group by)')}>
        <GlassFormLabel>{tr('pivotGroupByLabel', '保留哪些列作为行标识')}</GlassFormLabel>
        <GlassTagInput
          value={groupBy}
          suggestions={fieldCompletions}
          onChange={(next) =>
            updateConfig((cfg) => ({
              ...cfg,
              groupBy: next.length > 0 ? next : undefined,
            }))
          }
          placeholder={tr('pivotGroupByPlaceholder', '如 region')}
        />
      </GlassFormSection>
    </div>
  );
}
