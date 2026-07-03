import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassRadioSelect } from './shared/GlassRadioSelect';
import { GlassOperatorSelect } from './shared/GlassOperatorSelect';
import { GlassExpressionInput } from './shared/GlassExpressionInput';
import { GlassFieldCombo } from './shared/GlassFieldCombo';
import { GlassFieldSelector } from './shared/GlassFieldSelector';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassRowList } from './shared/GlassRowList';
import {
  createCalculationRow,
  exprFromParts,
  needsCalculationIdNormalization,
  normalizeCalculationEntries,
  type CalculationConfigEntry,
  type CalculationRow,
} from './shared/calculate-field';

const AGG_FUNCTIONS = ['sum', 'avg', 'min', 'max', 'count', 'count_distinct'];
const WINDOW_FUNCTIONS = [
  'row_number',
  'rank',
  'dense_rank',
  'ntile',
  'lag',
  'lead',
  'first_value',
  'last_value',
];
const EXCLUDE_ROW_FUNCTIONS = ['calcFieldCategoryWindow', 'calcFieldCategoryAggregate'];

const FRAME_OPTIONS = [
  { value: 'unbounded preceding', label: '前无限行' },
  { value: 'unbounded following', label: '后无限行' },
  { value: 'current row', label: '当前行' },
];

export default function FormCalculateField({
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
      .catch(() => {});
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

  const rawCalculations = useMemo(
    () => (node.config.calculations as CalculationConfigEntry[] | undefined) ?? [],
    [node.config.calculations]
  );
  const items = useMemo(() => {
    const normalized = normalizeCalculationEntries(rawCalculations);
    return normalized.length > 0 ? normalized : [createCalculationRow()];
  }, [rawCalculations]);
  const needsNormalization = useMemo(
    () => needsCalculationIdNormalization(rawCalculations),
    [rawCalculations]
  );

  const storeCalculations = useCallback(
    (next: CalculationRow[]) => {
      updateConfig((cfg) => ({
        ...cfg,
        calculations: next.length > 0 ? next : undefined,
      }));
    },
    [updateConfig]
  );

  useEffect(() => {
    if (!needsNormalization) return;
    const persisted = normalizeCalculationEntries(rawCalculations);
    if (persisted.length > 0) storeCalculations(persisted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsNormalization]);

  const [activeMode, setActiveMode] = useState<'row' | 'agg' | 'window'>('row');

  const visibleItems = useMemo(() => {
    const filtered = items.filter((i) => i.type === activeMode);
    return filtered.length > 0 ? filtered : [{ ...createCalculationRow(), type: activeMode }];
  }, [items, activeMode]);

  function toBackingIndex(visibleIndex: number): number {
    let count = 0;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type === activeMode) {
        if (count === visibleIndex) return i;
        count++;
      }
    }
    return -1;
  }

  function handleChange(next: CalculationRow[]) {
    storeCalculations(normalizeCalculationEntries(next));
  }

  function updateItem(visibleIndex: number, patch: Partial<CalculationRow>) {
    const bi = toBackingIndex(visibleIndex);
    if (bi === -1) {
      const entry = { ...createCalculationRow(), type: activeMode, ...patch };
      if (entry.type !== 'row') entry.expression = exprFromParts(entry);
      handleChange([...items, entry]);
      return;
    }
    handleChange(
      items.map((item, i) => {
        if (i !== bi) return item;
        const updated = { ...item, ...patch };
        if (updated.type !== 'row') updated.expression = exprFromParts(updated);
        return updated;
      })
    );
  }

  function addAfter(visibleIndex: number) {
    const bi = toBackingIndex(visibleIndex);
    if (bi === -1) {
      handleChange([...items, { ...createCalculationRow(), type: activeMode }]);
      return;
    }
    const entry = { ...createCalculationRow(), type: activeMode };
    handleChange([...items.slice(0, bi + 1), entry, ...items.slice(bi + 1)]);
  }

  function removeItem(visibleIndex: number) {
    const bi = toBackingIndex(visibleIndex);
    if (bi === -1) return;
    handleChange(items.filter((_, i) => i !== bi));
  }

  const [partitionOpen, setPartitionOpen] = useState<Record<number, boolean>>({});
  const [orderOpen, setOrderOpen] = useState<Record<number, boolean>>({});

  const fnGroups = useMemo(
    () => [
      { key: 'agg', items: AGG_FUNCTIONS.map((f) => ({ value: f, label: f })) },
      { key: 'window', items: WINDOW_FUNCTIONS.map((f) => ({ value: f, label: f })) },
    ],
    []
  );

  function rowColumns(mode: 'row' | 'agg' | 'window') {
    const actionOptions = [
      { value: 'add', label: tr('calcFieldActionAdd', '新增字段') },
      { value: 'replace', label: tr('calcFieldActionReplace', '替换字段') },
    ];
    const base = [
      {
        flex: 'flex-[0.8]',
        header: tr('calcFieldActionHeader', '插入模式'),
        render: (item: CalculationRow, index: number) => (
          <GlassOperatorSelect
            value={item.action || 'add'}
            groups={[{ key: 'action', items: actionOptions }]}
            onChange={(v) => updateItem(index, { action: v as 'add' | 'replace' })}
            className="h-7 text-[12px] [&>span]:text-left w-full"
          />
        ),
      },
      {
        flex: 'flex-[1.5]',
        header: tr('calcFieldTargetField', '目标字段'),
        render: (item: CalculationRow, index: number) =>
          item.action === 'replace' ? (
            <GlassFieldCombo
              value={fieldCompletions.includes(item.field) ? item.field : ''}
              options={fieldCompletions}
              columnTypes={columnTypes}
              onChange={(v) => updateItem(index, { field: v })}
              placeholder={tr('calcFieldSelectPlaceholder', '选择字段')}
              className="h-7 text-[12px]"
            />
          ) : (
            <GlassFormTextInput
              value={item.field}
              onChange={(v) => updateItem(index, { field: v })}
              placeholder={tr('calcFieldTargetPlaceholder', '如 margin')}
              className="h-7 text-[12px] shadow-none focus:ring-0"
            />
          ),
      },
    ];
    if (mode === 'row') {
      base.push({
        flex: 'flex-[5]',
        header: tr('calcFieldExpressionLabel', '表达式'),
        render: (item: CalculationRow, index: number) => (
          <GlassExpressionInput
            value={item.expression}
            onChange={(v) =>
              updateItem(index, {
                expression: v,
                ...(v && item.type === 'row' ? { type: 'row' as const } : {}),
              })
            }
            fieldCompletions={fieldCompletions}
            columnTypes={columnTypes}
            placeholder={tr('calcFieldExpressionPlaceholder', '如 [revenue] - [cost]')}
            excludeFunctionCategories={EXCLUDE_ROW_FUNCTIONS}
          />
        ),
      });
      return base;
    }
    base.push({
      flex: 'flex-[1]',
      header: tr('calcFieldFunction', '函数'),
      render: (item: CalculationRow, index: number) => (
        <GlassOperatorSelect
          value={item.fn || 'sum'}
          groups={fnGroups}
          onChange={(v) => updateItem(index, { fn: v })}
          className="h-7 text-[12px] [&>span]:text-left w-full"
        />
      ),
    });
    base.push({
      flex: 'flex-[1.5]',
      header: tr('calcFieldFnArg', '字段'),
      render: (item: CalculationRow, index: number) => (
        <input
          type="text"
          value={item.fnArg ?? ''}
          onChange={(e) => updateItem(index, { fnArg: e.target.value })}
          placeholder={tr('calcFieldFnArgPlaceholder', '[amount]')}
          className="h-7 w-full rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
        />
      ),
    });
    base.push({
      flex: 'flex-[1.5]',
      header: tr('calcFieldPartitionBy', '分区字段'),
      render: (item: CalculationRow, index: number) => (
        <div className="flex items-center gap-1">
          {item.partitionBy?.map((col) => (
            <span
              key={col}
              className="inline-flex items-center gap-1 rounded bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent"
            >
              {col}
              <button
                type="button"
                onClick={() =>
                  updateItem(index, { partitionBy: item.partitionBy?.filter((c) => c !== col) })
                }
                className="h-3 w-3 flex items-center justify-center rounded-full hover:bg-accent/20"
              >
                <X className="h-2 w-2" />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => setPartitionOpen((o) => ({ ...o, [index]: !o[index] }))}
            className="shrink-0 flex items-center justify-center rounded px-1.5 py-0.5 text-[11px] text-text-muted hover:text-text-primary transition-colors"
          >
            {partitionOpen[index] ? '收起 ▲' : '展开 ▼'}
          </button>
          {partitionOpen[index] && (
            <div
              className="absolute z-10 mt-1 rounded border bg-background/95 shadow-md"
              style={{ top: '100%', left: 0 }}
            >
              <GlassFieldSelector
                columns={fieldCompletions}
                selected={item.partitionBy ?? []}
                onChange={(v) => updateItem(index, { partitionBy: v.length > 0 ? v : undefined })}
                columnTypes={columnTypes}
                maxHeight="160px"
              />
            </div>
          )}
        </div>
      ),
    });
    base.push({
      flex: 'flex-[1.5]',
      header: tr('calcFieldOrderBy', '排序字段'),
      render: (item: CalculationRow, index: number) => (
        <div className="flex items-center gap-1">
          {item.orderBy?.map((o) => (
            <span
              key={o.field}
              className="inline-flex items-center gap-1 rounded bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent"
            >
              {o.field}
              <button
                type="button"
                onClick={() =>
                  updateItem(index, { orderBy: item.orderBy?.filter((x) => x.field !== o.field) })
                }
                className="h-3 w-3 flex items-center justify-center rounded-full hover:bg-accent/20"
              >
                <X className="h-2 w-2" />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => setOrderOpen((o) => ({ ...o, [index]: !o[index] }))}
            className="shrink-0 flex items-center justify-center rounded px-1.5 py-0.5 text-[11px] text-text-muted hover:text-text-primary transition-colors"
          >
            {orderOpen[index] ? '收起 ▲' : '展开 ▼'}
          </button>
          {orderOpen[index] && (
            <div
              className="absolute z-10 mt-1 rounded border bg-background/95 shadow-md"
              style={{ top: '100%', left: 0 }}
            >
              <GlassFieldSelector
                columns={fieldCompletions}
                selected={item.orderBy?.map((o) => o.field) ?? []}
                onChange={(v) =>
                  updateItem(index, {
                    orderBy:
                      v.length > 0
                        ? v.map((f) => ({ field: f, direction: 'asc' as const }))
                        : undefined,
                  })
                }
                columnTypes={columnTypes}
                maxHeight="160px"
              />
            </div>
          )}
        </div>
      ),
    });
    if (mode === 'window') {
      base.push({
        flex: 'flex-[2]',
        header: tr('calcFieldFrame', '行范围'),
        render: (item: CalculationRow, index: number) => (
          <div className="flex items-center gap-1">
            <select
              value={item.frameStart ?? 'unbounded preceding'}
              onChange={(e) => updateItem(index, { frameStart: e.target.value })}
              className="h-6 w-[100px] rounded border border-border-muted bg-background/42 px-1 text-[11px] text-text-primary outline-none"
            >
              {FRAME_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <span className="text-[10px] text-text-muted">→</span>
            <select
              value={item.frameEnd ?? 'current row'}
              onChange={(e) => updateItem(index, { frameEnd: e.target.value })}
              className="h-6 w-[100px] rounded border border-border-muted bg-background/42 px-1 text-[11px] text-text-primary outline-none"
            >
              {FRAME_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        ),
      });
    }
    return base;
  }

  return (
    <div className="flex gap-2.5 h-full min-h-0">
      {/* Left panel — mode selection */}
      <div className="flex-[2] rounded-lg border border-border-muted bg-background/42 content-start">
        <div className="flex items-end gap-3 px-3 pt-2.5 pb-1.5">
          <span className="h-8 w-8 rounded-full bg-accent/20 text-[14px] font-bold text-accent flex items-center justify-center leading-none">
            1
          </span>
          <div className="grid">
            <span className="text-[13px] font-semibold text-text-primary">
              {tr('calcFieldModeHeader', '计算模式')}
            </span>
            <span className="text-[10px] text-text-muted">
              {tr('calcFieldModeHint', '选择计算方式')}
            </span>
          </div>
        </div>
        <div className="px-3 pb-3">
          <GlassRadioSelect
            value={activeMode}
            options={[
              {
                value: 'row',
                label: tr('calcFieldModeRow', '逐行计算'),
                tip: tr('calcFieldModeRowTip', '基于当前行的字段做运算，不依赖其他行'),
              },
              {
                value: 'agg',
                label: tr('calcFieldModeAgg', '跨行计算'),
                tip: tr('calcFieldModeAggTip', '按分区汇总、排名、前后行对比'),
              },
              {
                value: 'window',
                label: tr('calcFieldModeWindow', '窗口计算'),
                tip: tr('calcFieldModeWindowTip', '累计、移动平均等需指定行范围的计算'),
              },
            ]}
            onChange={(v) => setActiveMode(v as 'row' | 'agg' | 'window')}
            label={tr('calcFieldMode', '模式')}
          />
        </div>
      </div>

      {/* Right panel — expression list */}
      <div className="flex-[6] rounded-lg border border-border-muted bg-background/42 content-start overflow-hidden flex flex-col">
        <div className="flex items-end gap-3 px-3 pt-2.5 pb-1.5 shrink-0">
          <span className="h-8 w-8 rounded-full bg-accent/20 text-[14px] font-bold text-accent flex items-center justify-center leading-none">
            2
          </span>
          <div className="grid">
            <span className="text-[13px] font-semibold text-text-primary">
              {tr('calcFieldConfigHeader', '计算配置')}
            </span>
            <span className="text-[10px] text-text-muted">
              {activeMode === 'row'
                ? tr('calcFieldConfigHintRow', '定义新字段及其计算表达式')
                : activeMode === 'agg'
                  ? tr('calcFieldConfigHintAgg', '选择聚合/排名函数、分区和排序字段')
                  : tr('calcFieldConfigHintWindow', '选择窗口函数、分区、排序和行范围')}
            </span>
          </div>
        </div>
        <div className="px-3 pb-3 overflow-y-auto flex-1 min-h-0">
          <GlassRowList
            items={visibleItems}
            columns={rowColumns(activeMode)}
            onAdd={addAfter}
            onRemove={removeItem}
            addTitle={tr('calcFieldAddRule', '添加规则')}
            removeTitle={tr('calcFieldRemove', '删除规则')}
          />
        </div>
      </div>
    </div>
  );
}
