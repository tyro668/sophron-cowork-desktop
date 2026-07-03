import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, LockOpen, X } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassRadioSelect } from './shared/GlassRadioSelect';
import { GlassOperatorSelect } from './shared/GlassOperatorSelect';
import { GlassExpressionInput } from './shared/GlassExpressionInput';
import { GlassFieldSelector } from './shared/GlassFieldSelector';
import { GlassRowList, type GlassRowListColumn } from './shared/GlassRowList';
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
  const [cachedFields, setCachedFields] = useState<string[]>([]);

  const fetchColumns = useCallback(
    (tid: string, nid: string, ntype: string, nconfig: Record<string, unknown>) => {
      const api = window.electronAPI?.data;
      if (!api?.getWorkflowNodeColumnTypes) return Promise.resolve([]);
      return api
        .getWorkflowNodeColumnTypes({
          taskId: tid,
          nodeId: nid,
          nodeType: ntype as never,
          nodeConfig: nconfig,
        })
        .then((types: Array<{ name: string; type: string }>) => types)
        .catch(() => []);
    },
    []
  );

  useEffect(() => {
    if (!taskId || !sourceNode?.id) return;
    fetchColumns(
      taskId,
      sourceNode.id,
      sourceNode.type,
      (sourceNode.config ?? {}) as Record<string, unknown>
    ).then((types) => {
      const map: Record<string, string> = {};
      for (const t of types) map[t.name] = t.type;
      setColumnTypes(map);
    });
  }, [taskId, sourceNode?.id, sourceNode?.type, sourceNode?.config, fetchColumns]);

  // Fetch this node's cached output columns for field completion & auto-lock
  useEffect(() => {
    if (!taskId || !node.id) return;
    fetchColumns(taskId, node.id, node.type, (node.config ?? {}) as Record<string, unknown>).then(
      (types) => {
        const fields = types.map((t) => t.name);
        setCachedFields(fields);
        setColumnTypes((prev) => {
          const merged = { ...prev };
          for (const t of types) merged[t.name] ??= t.type;
          return merged;
        });
        // Auto-lock rows whose field matches a cached column
        const fieldSet = new Set(fields);
        let changed = false;
        const next = items.map((item) => {
          if (fieldSet.has(item.field) && !item.locked) {
            changed = true;
            return { ...item, locked: true };
          }
          return item;
        });
        if (changed) {
          storeCalculations(normalizeCalculationEntries(next));
        }
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, node.id, node.type, node.config, fetchColumns]);

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
    return filtered.length > 0
      ? filtered
      : [{ ...createCalculationRow(), type: activeMode, locked: false }];
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

  function isLocked(item: CalculationRow): boolean {
    return item.locked === true;
  }

  function toggleLock(visibleIndex: number) {
    const bi = toBackingIndex(visibleIndex);
    if (bi === -1) return;
    const item = items[bi];
    updateItem(visibleIndex, { locked: !item.locked });
  }

  function updateItem(visibleIndex: number, patch: Partial<CalculationRow>) {
    const bi = toBackingIndex(visibleIndex);
    if (bi === -1) {
      const entry = { ...createCalculationRow(), type: activeMode, ...patch };
      if (entry.type !== 'row') entry.expression = exprFromParts(entry);
      handleChange([...items, entry]);
      return;
    }
    // Locked rows cannot be modified (except toggling the lock itself)
    if (isLocked(items[bi]) && !('locked' in patch)) return;
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
    const entry = { ...createCalculationRow(), type: activeMode, locked: false };
    if (bi === -1) {
      handleChange([...items, entry]);
      return;
    }
    handleChange([...items.slice(0, bi + 1), entry, ...items.slice(bi + 1)]);
  }

  function removeItem(visibleIndex: number) {
    const bi = toBackingIndex(visibleIndex);
    if (bi === -1) return;
    if (isLocked(items[bi])) return;
    handleChange(items.filter((_, i) => i !== bi));
  }

  const [partitionOpen, setPartitionOpen] = useState<Record<number, boolean>>({});
  const [orderOpen, setOrderOpen] = useState<Record<number, boolean>>({});

  const mergedFieldCompletions = useMemo(
    () => [...new Set([...fieldCompletions, ...cachedFields])],
    [fieldCompletions, cachedFields]
  );

  const fnGroups = useMemo(
    () => [
      { key: 'agg', items: AGG_FUNCTIONS.map((f) => ({ value: f, label: f })) },
      { key: 'window', items: WINDOW_FUNCTIONS.map((f) => ({ value: f, label: f })) },
    ],
    []
  );

  function rowColumns(mode: 'row' | 'agg' | 'window') {
    const base: GlassRowListColumn<CalculationRow>[] = [
      {
        flex: 'flex-[0.5]',
        header: '',
        render: (item: CalculationRow, index: number) => {
          const locked = isLocked(item);
          return (
            <button
              type="button"
              onClick={() => toggleLock(index)}
              className="flex h-6 w-full cursor-pointer items-center justify-center rounded text-text-muted transition-colors hover:text-accent"
              title={locked ? '已锁定，点击解锁编辑' : '点击锁定'}
              aria-label={locked ? '解锁' : '锁定'}
            >
              {locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
            </button>
          );
        },
      },
      {
        flex: 'flex-[1.5]',
        header: tr('calcFieldTargetField', '目标字段'),
        render: (item: CalculationRow, index: number) => {
          const locked = isLocked(item);
          return (
            <input
              type="text"
              value={item.field}
              onChange={(e) => updateItem(index, { field: e.target.value })}
              placeholder={tr('calcFieldTargetPlaceholder', '如 margin')}
              disabled={locked}
              className={`h-7 w-full rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent disabled:cursor-not-allowed disabled:opacity-40 ${
                !item.field.trim() ? '!border-warning/60' : ''
              }`}
            />
          );
        },
      },
    ];
    if (mode === 'row') {
      base.push({
        flex: 'flex-[5]',
        header: tr('calcFieldExpressionLabel', '表达式'),
        render: (item: CalculationRow, index: number) => {
          const locked = isLocked(item);
          if (locked) {
            return (
              <div className="flex h-7 w-full items-center rounded-md border border-border-muted bg-background/20 px-1.5 text-[12px] text-text-muted opacity-40">
                <span className="truncate">
                  {item.expression || tr('calcFieldExpressionPlaceholder', '如 [revenue] - [cost]')}
                </span>
              </div>
            );
          }
          return (
            <GlassExpressionInput
              value={item.expression}
              onChange={(v) =>
                updateItem(index, {
                  expression: v,
                  ...(v && item.type === 'row' ? { type: 'row' as const } : {}),
                })
              }
              fieldCompletions={mergedFieldCompletions}
              columnTypes={columnTypes}
              placeholder={tr('calcFieldExpressionPlaceholder', '如 [revenue] - [cost]')}
              excludeFunctionCategories={EXCLUDE_ROW_FUNCTIONS}
            />
          );
        },
      });
      return base;
    }
    base.push({
      flex: 'flex-[1]',
      header: tr('calcFieldFunction', '函数'),
      render: (item: CalculationRow, index: number) => {
        const locked = isLocked(item);
        if (locked) {
          return (
            <div className="flex h-7 w-full items-center rounded-md border border-border-muted bg-background/20 px-1.5 text-[12px] text-text-muted opacity-40">
              <span className="truncate">{item.fn || 'sum'}</span>
            </div>
          );
        }
        return (
          <GlassOperatorSelect
            value={item.fn || 'sum'}
            groups={fnGroups}
            onChange={(v) => updateItem(index, { fn: v })}
            className="h-7 text-[12px] [&>span]:text-left w-full"
          />
        );
      },
    });
    base.push({
      flex: 'flex-[1.5]',
      header: tr('calcFieldFnArg', '字段'),
      render: (item: CalculationRow, index: number) => {
        const locked = isLocked(item);
        return (
          <input
            type="text"
            value={item.fnArg ?? ''}
            onChange={(e) => updateItem(index, { fnArg: e.target.value })}
            placeholder={tr('calcFieldFnArgPlaceholder', '[amount]')}
            disabled={locked}
            className="h-7 w-full rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent disabled:cursor-not-allowed disabled:opacity-40"
          />
        );
      },
    });
    base.push({
      flex: 'flex-[1.5]',
      header: tr('calcFieldPartitionBy', '分区字段'),
      render: (item: CalculationRow, index: number) => {
        const locked = isLocked(item);
        return (
          <div className="flex items-center gap-1">
            {item.partitionBy?.map((col) => (
              <span
                key={col}
                className="inline-flex items-center gap-1 rounded bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent"
              >
                {col}
                {!locked && (
                  <button
                    type="button"
                    onClick={() =>
                      updateItem(index, { partitionBy: item.partitionBy?.filter((c) => c !== col) })
                    }
                    className="h-3 w-3 flex items-center justify-center rounded-full hover:bg-accent/20"
                  >
                    <X className="h-2 w-2" />
                  </button>
                )}
              </span>
            ))}
            {!locked && (
              <button
                type="button"
                onClick={() => setPartitionOpen((o) => ({ ...o, [index]: !o[index] }))}
                className="shrink-0 flex items-center justify-center rounded px-1.5 py-0.5 text-[11px] text-text-muted hover:text-text-primary transition-colors"
              >
                {partitionOpen[index] ? '收起 ▲' : '展开 ▼'}
              </button>
            )}
            {partitionOpen[index] && !locked && (
              <div
                className="absolute z-10 mt-1 rounded border bg-background/95 shadow-md"
                style={{ top: '100%', left: 0 }}
              >
                <GlassFieldSelector
                  columns={mergedFieldCompletions}
                  selected={item.partitionBy ?? []}
                  onChange={(v) => updateItem(index, { partitionBy: v.length > 0 ? v : undefined })}
                  columnTypes={columnTypes}
                  maxHeight="160px"
                />
              </div>
            )}
          </div>
        );
      },
    });
    base.push({
      flex: 'flex-[1.5]',
      header: tr('calcFieldOrderBy', '排序字段'),
      render: (item: CalculationRow, index: number) => {
        const locked = isLocked(item);
        return (
          <div className="flex items-center gap-1">
            {item.orderBy?.map((o) => (
              <span
                key={o.field}
                className="inline-flex items-center gap-1 rounded bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent"
              >
                {o.field}
                {!locked && (
                  <button
                    type="button"
                    onClick={() =>
                      updateItem(index, {
                        orderBy: item.orderBy?.filter((x) => x.field !== o.field),
                      })
                    }
                    className="h-3 w-3 flex items-center justify-center rounded-full hover:bg-accent/20"
                  >
                    <X className="h-2 w-2" />
                  </button>
                )}
              </span>
            ))}
            {!locked && (
              <button
                type="button"
                onClick={() => setOrderOpen((o) => ({ ...o, [index]: !o[index] }))}
                className="shrink-0 flex items-center justify-center rounded px-1.5 py-0.5 text-[11px] text-text-muted hover:text-text-primary transition-colors"
              >
                {orderOpen[index] ? '收起 ▲' : '展开 ▼'}
              </button>
            )}
            {orderOpen[index] && !locked && (
              <div
                className="absolute z-10 mt-1 rounded border bg-background/95 shadow-md"
                style={{ top: '100%', left: 0 }}
              >
                <GlassFieldSelector
                  columns={mergedFieldCompletions}
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
        );
      },
    });
    if (mode === 'window') {
      base.push({
        flex: 'flex-[2]',
        header: tr('calcFieldFrame', '行范围'),
        render: (item: CalculationRow, index: number) => {
          const locked = isLocked(item);
          return (
            <div className="flex items-center gap-1">
              <select
                value={item.frameStart ?? 'unbounded preceding'}
                onChange={(e) => updateItem(index, { frameStart: e.target.value })}
                disabled={locked}
                className="h-6 w-[100px] rounded border border-border-muted bg-background/42 px-1 text-[11px] text-text-primary outline-none disabled:cursor-not-allowed disabled:opacity-40"
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
                disabled={locked}
                className="h-6 w-[100px] rounded border border-border-muted bg-background/42 px-1 text-[11px] text-text-primary outline-none disabled:cursor-not-allowed disabled:opacity-40"
              >
                {FRAME_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          );
        },
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
            canDelete={(item) => !isLocked(item)}
          />
        </div>
      </div>
    </div>
  );
}
