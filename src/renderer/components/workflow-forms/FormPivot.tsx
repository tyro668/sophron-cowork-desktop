import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, X } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { GlassExpressionInput } from './shared/GlassExpressionInput';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassFieldSelector } from './shared/GlassFieldSelector';
import { GlassOperatorSelect } from './shared/GlassOperatorSelect';
import { GlassTagInput } from './shared/GlassTagInput';

const PIVOT_FUNCTIONS = ['sum', 'avg', 'min', 'max', 'count', 'count_distinct'];

interface PivotMetric {
  function: string;
  expression: string;
  alias?: string;
}

export default function FormPivot({
  node,
  taskId,
  fieldCompletions,
  sourceNode,
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
      .then((types) => {
        const map: Record<string, string> = {};
        for (const t of types) map[t.name] = t.type;
        setColumnTypes(map);
      })
      .catch(() => setColumnTypes({}));
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

  const removeOn = useCallback(
    (col: string) => handleOnChange(onFields.filter((c) => c !== col)),
    [handleOnChange, onFields]
  );

  const clearOn = useCallback(() => handleOnChange([]), [handleOnChange]);

  const removeGroupBy = useCallback(
    (col: string) => handleGroupByChange(groupBy.filter((c) => c !== col)),
    [handleGroupByChange, groupBy]
  );

  const clearGroupBy = useCallback(() => handleGroupByChange([]), [handleGroupByChange]);

  const [onOpen, setOnOpen] = useState(false);
  const [groupByOpen, setGroupByOpen] = useState(false);

  const singleMetricRef = useRef(singleMetric);
  singleMetricRef.current = singleMetric;

  const handleMetricChange = useCallback(
    (patch: Partial<PivotMetric>) => {
      const merged = { ...singleMetricRef.current, ...patch };
      updateConfig((cfg) => ({ ...cfg, using: [merged] }));
    },
    [updateConfig]
  );

  const fnGroups = useMemo(
    () => [
      {
        key: 'fn',
        items: PIVOT_FUNCTIONS.map((f) => ({
          value: f,
          label: tr(`aggregateFn_${f}`, f),
        })),
      },
    ],
    [tr]
  );

  function TagBar({
    items,
    onRemove,
    onClear,
    open,
    onToggle,
  }: {
    items: string[];
    onRemove: (col: string) => void;
    onClear: () => void;
    open: boolean;
    onToggle: () => void;
  }) {
    return (
      <div className="rounded border border-border-muted bg-background/60 px-2 py-1 overflow-hidden">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onClear}
            className="inline-flex flex-shrink-0 items-center justify-center rounded px-1 text-text-muted hover:text-error hover:bg-error/10 transition-colors"
            title={tr('clearAll', '清空字段')}
            aria-label={tr('clearAll', '清空字段')}
          >
            <Trash2 className="h-3 w-3" />
          </button>
          {items.length === 0 && (
            <span className="text-[11px] text-text-muted italic">
              {tr('noFieldsSelected', '暂未选择字段')}
            </span>
          )}
          <div className="flex flex-1 flex-wrap gap-1">
            {items.map((col) => (
              <span
                key={col}
                className="inline-flex items-center gap-1 rounded bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent"
              >
                {col}
                <button
                  type="button"
                  onClick={() => onRemove(col)}
                  className="inline-flex h-3 w-3 items-center justify-center rounded-full hover:bg-accent/20 transition-colors"
                  aria-label={tr('removeField', '移除字段')}
                >
                  <X className="h-2 w-2" />
                </button>
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex flex-shrink-0 items-center justify-center rounded px-1.5 py-0.5 text-[11px] text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          >
            {open ? '收起 ▲' : '展开 ▼'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2.5">
      {/* ═══ 左列: 行列字段选择 ═══ */}
      <div className="flex-1 rounded-lg border border-border-muted bg-background/42 content-start">
        <div className="flex items-end gap-3 px-3 pt-2.5 pb-1.5">
          <span className="h-8 w-8 rounded-full bg-accent/20 text-[14px] font-bold text-accent flex items-center justify-center leading-none">
            1
          </span>
          <div className="grid">
            <span className="text-[13px] font-semibold text-text-primary">
              {tr('pivotAxes', '行列字段选择')}
            </span>
            <span className="text-[10px] text-text-muted">
              {tr('pivotSourcesHint', '选择透视列与行标识')}
            </span>
          </div>
        </div>
        <div className="px-3 pb-3 grid gap-3 content-start">
          <div className="grid gap-1.5 content-start">
            <GlassFormLabel>{tr('pivotOnLabel', '透视列')}</GlassFormLabel>
            <TagBar
              items={onFields}
              onRemove={removeOn}
              onClear={clearOn}
              open={onOpen}
              onToggle={() => setOnOpen((v) => !v)}
            />
            {onOpen && (
              <GlassFieldSelector
                columns={fieldCompletions}
                selected={onFields}
                onChange={handleOnChange}
                columnTypes={columnTypes}
                maxHeight="180px"
              />
            )}
          </div>
          <div className="grid gap-1.5 content-start">
            <GlassFormLabel>
              {tr('pivotGroupByLabel', '行标识')}
              <span className="text-[10px] text-text-muted ml-1">(可选)</span>
            </GlassFormLabel>
            <TagBar
              items={groupBy}
              onRemove={removeGroupBy}
              onClear={clearGroupBy}
              open={groupByOpen}
              onToggle={() => setGroupByOpen((v) => !v)}
            />
            {groupByOpen && (
              <GlassFieldSelector
                columns={fieldCompletions}
                selected={groupBy}
                onChange={handleGroupByChange}
                columnTypes={columnTypes}
                maxHeight="180px"
              />
            )}
          </div>
        </div>
      </div>

      {/* ═══ 右列: 聚合指标 ═══ */}
      <div className="flex-[1] rounded-lg border border-border-muted bg-background/42 content-start">
        <div className="flex items-end gap-3 px-3 pt-2.5 pb-1.5">
          <span className="h-8 w-8 rounded-full bg-accent/20 text-[14px] font-bold text-accent flex items-center justify-center leading-none">
            2
          </span>
          <div className="grid">
            <span className="text-[13px] font-semibold text-text-primary">
              {tr('pivotUsing', '聚合指标')}
            </span>
            <span className="text-[10px] text-text-muted">
              {tr('pivotAggHint', '选择聚合函数与表达式')}
            </span>
          </div>
        </div>
        <div className="px-3 pb-3 grid gap-3 content-start">
          <div className="flex gap-3">
            <div className="grid gap-1 flex-1 min-w-0">
              <GlassFormLabel>{tr('aggregateFunction', '聚合函数')}</GlassFormLabel>
              <GlassOperatorSelect
                value={singleMetric.function}
                groups={fnGroups}
                onChange={(v) => handleMetricChange({ function: v })}
                className="h-7 text-[12px] [&>span]:text-left w-full"
              />
            </div>
            <div className="grid gap-1 flex-1 min-w-0">
              <GlassFormLabel>
                {tr('aggregateExpression', '聚合表达式')}
                <span className="text-[10px] text-text-muted ml-1">(可选)</span>
              </GlassFormLabel>
              <GlassExpressionInput
                value={singleMetric.expression}
                onChange={(v) => handleMetricChange({ expression: v })}
                fieldCompletions={fieldCompletions}
                columnTypes={columnTypes}
                placeholder={tr('pivotExpressionPlaceholder', '* 或 [revenue]')}
              />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="grid gap-1 flex-1 min-w-0">
              <GlassFormLabel>
                {tr('aggregateAlias', '别名')}
                <span className="text-[10px] text-text-muted ml-1">(可选)</span>
              </GlassFormLabel>
              <GlassFormTextInput
                value={singleMetric.alias ?? ''}
                onChange={(v) => handleMetricChange({ alias: v || undefined })}
                placeholder={tr('aggregateAliasPlaceholder', '如 total_revenue')}
                className="w-full"
                style={{ height: '1.75rem' }}
              />
            </div>
            <div className="grid gap-1 flex-1 min-w-0">
              <GlassFormLabel>
                {tr('pivotInLabel', '固定值域')}
                <span className="text-[10px] text-text-muted ml-1">(可选)</span>
              </GlassFormLabel>
              <GlassTagInput
                value={values}
                onChange={handleValuesChange}
                placeholder={tr('pivotInPlaceholder', '2024, 2025, 2026')}
                style={{ height: '1.75rem' }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
