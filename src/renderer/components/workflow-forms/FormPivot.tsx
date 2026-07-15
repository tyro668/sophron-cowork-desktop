import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, X } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { GlassExpressionInput } from './shared/GlassExpressionInput';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassFieldSelector } from './shared/GlassFieldSelector';
import { GlassOperatorSelect } from './shared/GlassOperatorSelect';
import { GlassValueSelector } from './shared/GlassValueSelector';
import { useWorkflowNodeColumnValues } from '../../hooks/useWorkflowNodeColumnValues';

const PIVOT_FUNCTIONS = ['sum', 'avg', 'min', 'max', 'count', 'count_distinct'];

interface PivotMetric {
  function: string;
  expression: string;
  alias?: string;
}

function createDefaultMetric(): PivotMetric {
  return { function: 'sum', expression: '' };
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

  const onFields = useMemo(() => (node.config.on as string[]) ?? [], [node.config?.on]);
  const values = useMemo(() => (node.config.values as string[]) ?? [], [node.config?.values]);
  const rawUsing = useMemo(() => (node.config.using as PivotMetric[]) ?? [], [node.config?.using]);
  const using = useMemo(
    () => (rawUsing.length > 0 ? rawUsing : [createDefaultMetric()]),
    [rawUsing]
  );
  const groupBy = useMemo(() => (node.config.groupBy as string[]) ?? [], [node.config?.groupBy]);

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

  const distinctValues = useWorkflowNodeColumnValues({
    taskId,
    sourceNode,
    column: onFields[0],
  });

  // ── 多指标管理 ──

  const handleUsingChange = useCallback(
    (items: PivotMetric[]) => {
      updateConfig((cfg) => ({
        ...cfg,
        using: items.length > 0 ? items : undefined,
      }));
    },
    [updateConfig]
  );

  function updateMetric(index: number, patch: Partial<PivotMetric>) {
    handleUsingChange(using.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function addMetricAfter(index: number) {
    const hasEmpty = using.some((m) => !m.expression);
    if (hasEmpty) return;
    const entry = createDefaultMetric();
    handleUsingChange([...using.slice(0, index + 1), entry, ...using.slice(index + 1)]);
  }

  function removeMetric(index: number) {
    let next = using.filter((_, i) => i !== index);
    const firstEmpty = next.findIndex((m) => !m.expression);
    if (firstEmpty >= 0) {
      next = next.filter((m, i) => i === firstEmpty || m.expression);
    }
    handleUsingChange(next);
  }

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
            <span className="text-[12px] text-text-muted italic">
              {tr('noFieldsSelected', '暂未选择字段')}
            </span>
          )}
          <div className="flex flex-1 flex-wrap gap-1">
            {items.map((col) => (
              <span
                key={col}
                className="inline-flex items-center gap-1 rounded bg-accent/10 px-1.5 py-0.5 text-[12px] font-medium text-accent"
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
            className="inline-flex flex-shrink-0 items-center justify-center rounded px-1.5 py-0.5 text-[12px] text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          >
            {open ? '收起 ▲' : '展开 ▼'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2.5">
      {/* ═══ 左列: 列与分组 ═══ */}
      <div className="flex-[4] rounded-lg border border-border-muted bg-background/42 content-start">
        <div className="flex items-end gap-3 px-3 pt-2.5 pb-1.5">
          <span className="h-8 w-8 rounded-full bg-accent/20 text-[14px] font-bold text-accent flex items-center justify-center leading-none">
            1
          </span>
          <div className="grid">
            <span className="text-[13px] font-semibold text-text-primary">
              {tr('pivotAxes', '列与分组')}
            </span>
            <span className="text-[10px] text-text-muted">
              {tr('pivotSourcesHint', '选择待转化列、值列表与分组字段')}
            </span>
          </div>
        </div>
        <div className="px-3 pb-3 grid gap-3 content-start">
          <div className="grid gap-1.5 content-start">
            <GlassFormLabel>{tr('pivotOnLabel', '待转化的列')}</GlassFormLabel>
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
          <div className="grid gap-1">
            <GlassFormLabel>
              {tr('pivotInLabel', '值列表')}
              <span className="text-[10px] text-text-muted ml-1">(可选)</span>
            </GlassFormLabel>
            <GlassValueSelector
              values={distinctValues}
              selected={values}
              onChange={handleValuesChange}
              placeholder={tr('pivotInPlaceholder', '选择透视列的值，按Enter确认')}
            />
          </div>
          <div className="grid gap-1.5 content-start">
            <GlassFormLabel>
              {tr('pivotGroupByLabel', '分组字段')}
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
      <div className="flex-[6] rounded-lg border border-border-muted bg-background/42 content-start">
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
          {/* 多指标列表 */}
          <div className="flex items-center gap-1.5 px-0.5 pb-0.5 text-[12px] font-medium text-text-muted">
            <span className="flex flex-[1.5] items-center justify-center min-w-0">
              {tr('aggregateFunction', '聚合函数')}
            </span>
            <span className="flex flex-[2] items-center justify-center min-w-0">
              {tr('expressionLabel', '表达式')}
            </span>
            <span className="flex flex-[1.5] items-center justify-center min-w-0">
              {tr('aggregateAlias', '别名 (as)')}
            </span>
            <span className="flex w-[3.25rem] flex-shrink-0 justify-center" />
          </div>
          {using.map((metric, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 rounded px-0.5 py-0.5 transition-colors hover:bg-surface-hover/40"
            >
              {/* Function */}
              <div className="flex-[1.5] min-w-0">
                <GlassOperatorSelect
                  value={metric.function}
                  groups={fnGroups}
                  onChange={(v) => updateMetric(i, { function: v })}
                  className="h-7 text-[12px] [&>span]:text-left w-full"
                />
              </div>
              {/* Expression */}
              <div className="flex-[2] min-w-0">
                <GlassExpressionInput
                  value={metric.expression}
                  onChange={(v) => updateMetric(i, { expression: v })}
                  fieldCompletions={fieldCompletions}
                  columnTypes={columnTypes}
                  placeholder={tr('pivotExpressionPlaceholder', '请输入表达式')}
                />
              </div>
              {/* Alias */}
              <div className="flex-[1.5] min-w-0">
                <GlassFormTextInput
                  value={metric.alias ?? ''}
                  onChange={(v) => updateMetric(i, { alias: v || undefined })}
                  placeholder={tr('pivotAliasPlaceholder', '请输入后缀')}
                  className="h-7 px-1.5 text-[12px] w-full"
                />
              </div>
              {/* Actions */}
              <div className="flex items-center gap-0.5 flex-shrink-0 w-[3.25rem] justify-center">
                <button
                  type="button"
                  onClick={() => addMetricAfter(i)}
                  className="inline-flex h-6 w-6 flex-shrink-0 cursor-pointer items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-hover hover:text-accent"
                  title={tr('pivotAddMetric', '添加指标')}
                  aria-label={tr('pivotAddMetric', '添加指标')}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => removeMetric(i)}
                  className="inline-flex h-6 w-6 flex-shrink-0 cursor-pointer items-center justify-center rounded text-text-muted transition-colors hover:text-error hover:bg-error/10"
                  title={tr('pivotRemoveMetric', '删除指标')}
                  aria-label={tr('pivotRemoveMetric', '删除指标')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
