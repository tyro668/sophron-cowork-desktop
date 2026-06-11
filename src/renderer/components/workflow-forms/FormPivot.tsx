import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ArrowLeftRight, ArrowDownUp } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';
import { GlassMultiSelect } from './shared/GlassMultiSelect';
import { GlassTagInput } from './shared/GlassTagInput';

const PIVOT_FUNCTIONS = ['sum', 'avg', 'min', 'max', 'count', 'count_distinct'];
const INPUT_CLASS =
  'h-7 w-full rounded-md border border-border-muted bg-background/42 px-2 text-[12px] text-text-primary outline-none focus:border-accent';

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
      }));
    },
    [onNodeChange]
  );

  const onFields: string[] = (node.config.on as string[]) ?? [];
  const values: string[] = (node.config.values as string[]) ?? [];
  const using: PivotMetric[] = (node.config.using as PivotMetric[]) ?? [];
  const groupBy: string[] = (node.config.groupBy as string[]) ?? [];
  const singleMetric = using[0] ?? { function: 'sum', expression: '*' };

  const makeArrayHandler = useCallback(
    (key: string) => (next: string[]) =>
      updateConfig((cfg) => ({ ...cfg, [key]: next.length > 0 ? next : undefined })),
    [updateConfig]
  );

  const handleOnChange = useMemo(() => makeArrayHandler('on'), [makeArrayHandler]);
  const handleGroupByChange = useMemo(() => makeArrayHandler('groupBy'), [makeArrayHandler]);
  const handleValuesChange = useMemo(() => makeArrayHandler('values'), [makeArrayHandler]);

  const [showAdvanced, setShowAdvanced] = useState(false);

  const columnPreview = useMemo(() => {
    const onPart = onFields.length > 0 ? onFields.join('_') : '?';
    const alias = singleMetric.alias || singleMetric.function;
    const valPart = values.length > 0 ? `{${values.slice(0, 3).join('|')}}` : '{value}';
    return `${onPart}_${valPart}_${alias}`;
  }, [onFields, values, singleMetric]);

  const singleMetricRef = useRef(singleMetric);
  singleMetricRef.current = singleMetric;

  const handleMetricChange = useCallback(
    (patch: Partial<PivotMetric>) => {
      const merged = { ...singleMetricRef.current, ...patch };
      updateConfig((cfg) => ({ ...cfg, using: [merged] }));
    },
    [updateConfig]
  );

  return (
    <div className="grid content-start gap-2.5">
      {/* Axes: pivot-on + group-by side by side */}
      <GlassFormSection title={tr('pivotAxes', '行列配置')}>
        <div className="grid grid-cols-1 gap-2.5">
          {/* → 列（透视字段） */}
          <div className="grid gap-1">
            <span className="flex items-center gap-1 text-[11px] font-medium text-text-secondary">
              <ArrowLeftRight className="h-3 w-3" />
              {tr('pivotOnLabel', '透视列')}
              <span className="text-text-muted font-normal">
                {tr('pivotOnHint', '（值 → 列头）')}
              </span>
            </span>
            <GlassMultiSelect
              value={onFields}
              suggestions={fieldCompletions}
              onChange={handleOnChange}
              placeholder={tr('pivotOnPlaceholder', '选择字段...')}
              scrollKey={`${node.id}:pivot:on`}
            />
          </div>

          {/* ↓ 行（分组字段） */}
          <div className="grid gap-1">
            <span className="flex items-center gap-1 text-[11px] font-medium text-text-secondary">
              <ArrowDownUp className="h-3 w-3" />
              {tr('pivotGroupByLabel', '行标识')}
              <span className="text-text-muted font-normal">
                {tr('pivotGroupByHint', '（保留为行）')}
              </span>
            </span>
            <GlassMultiSelect
              value={groupBy}
              suggestions={fieldCompletions}
              onChange={handleGroupByChange}
              placeholder={tr('pivotGroupByPlaceholder', '选择字段...')}
              scrollKey={`${node.id}:pivot:groupBy`}
            />
          </div>
        </div>
      </GlassFormSection>

      {/* Aggregation */}
      <GlassFormSection title={tr('pivotUsing', '聚合指标')}>
        <div className="grid gap-2">
          <div className="flex items-center gap-2">
            <select
              value={singleMetric.function}
              onChange={(e) => handleMetricChange({ function: e.target.value })}
              className="h-7 w-24 shrink-0 rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-secondary outline-none focus:border-accent"
            >
              {PIVOT_FUNCTIONS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <span className="text-[12px] text-text-muted">(</span>
            <input
              type="text"
              value={singleMetric.expression}
              onChange={(e) => handleMetricChange({ expression: e.target.value })}
              placeholder={tr('pivotExpressionPlaceholder', '* 或 [revenue]')}
              className={INPUT_CLASS + ' flex-1'}
            />
            <span className="text-[12px] text-text-muted">)</span>
          </div>

          {/* Column preview */}
          <div className="text-[10px] text-text-muted leading-relaxed">
            {tr('pivotColumnPreview', '列名预览')}：
            <code className="ml-1 rounded bg-background/42 px-1 py-0.5 font-mono text-[10px]">
              {columnPreview}
            </code>
          </div>
        </div>
      </GlassFormSection>

      {/* Advanced: in values + alias */}
      <div className="rounded-lg border border-border-muted/70 bg-background/18">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-text-muted hover:text-text-secondary transition-colors"
        >
          <ChevronDown
            className={`h-3 w-3 transition-transform ${showAdvanced ? '' : '-rotate-90'}`}
          />
          {tr('pivotIn', '高级选项')}
        </button>
        {showAdvanced && (
          <div className="grid gap-2 border-t border-border-muted/50 px-3 pb-2.5 pt-2">
            {/* Alias */}
            <label className="grid gap-1">
              <span className="text-[11px] font-medium text-text-secondary">
                {tr('aggregateAlias', '列名后缀 (as)')}
              </span>
              <input
                type="text"
                value={singleMetric.alias ?? ''}
                onChange={(e) => handleMetricChange({ alias: e.target.value || undefined })}
                placeholder={tr('aggregateAliasPlaceholder', '如 total')}
                className={INPUT_CLASS}
              />
            </label>

            {/* Fixed values */}
            <label className="grid gap-1">
              <span className="text-[11px] font-medium text-text-secondary">
                {tr('pivotInLabel', '固定值域 (in)')}
              </span>
              <GlassTagInput
                value={values}
                onChange={handleValuesChange}
                placeholder={tr('pivotInPlaceholder', '如 2024, 2025, 2026')}
              />
            </label>
            <p className="text-[10px] text-text-muted">
              {tr('pivotInHint', '显式指定 in 值可固定输出 schema，避免列随数据变化。')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
