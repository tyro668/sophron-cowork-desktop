import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Trash2, X } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassRadioSelect } from './shared/GlassRadioSelect';
import { GlassOperatorSelect } from './shared/GlassOperatorSelect';
import { GlassExpressionInput } from './shared/GlassExpressionInput';
import { GlassFieldCombo } from './shared/GlassFieldCombo';
import { GlassColumnSelector } from './shared/GlassColumnSelector';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
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

const FRAME_PRESETS = [
  {
    value: 'unbounded preceding|current row',
    label: '累计到当前行',
    key: 'calcFieldFrameCumulative',
  },
  {
    value: 'current row|unbounded following',
    label: '从当前行累计',
    key: 'calcFieldFrameRemaining',
  },
  { value: 'unbounded preceding|unbounded following', label: '整个分区', key: 'calcFieldFrameAll' },
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
  const [localItems, setLocalItems] = useState<CalculationRow[]>(() =>
    normalizeCalculationEntries(rawCalculations)
  );
  const needsNormalization = useMemo(
    () => needsCalculationIdNormalization(rawCalculations),
    [rawCalculations]
  );

  // Sync from config when it changes externally (skip initial)
  const initialRef = useRef(true);
  useEffect(() => {
    if (initialRef.current) {
      initialRef.current = false;
      return;
    }
    setLocalItems(normalizeCalculationEntries(rawCalculations));
  }, [rawCalculations]);

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
    const filtered = localItems.filter((i) => i.type === activeMode);
    return filtered.length > 0 ? filtered : [{ ...createCalculationRow(), type: activeMode }];
  }, [localItems, activeMode]);

  function toBackingIndex(visibleIndex: number): number {
    let count = 0;
    for (let i = 0; i < localItems.length; i++) {
      if (localItems[i].type === activeMode) {
        if (count === visibleIndex) return i;
        count++;
      }
    }
    return -1;
  }

  function handleChange(next: CalculationRow[]) {
    const normalized = normalizeCalculationEntries(next);
    setLocalItems(normalized);
    storeCalculations(normalized);
  }

  function updateItem(visibleIndex: number, patch: Partial<CalculationRow>) {
    const bi = toBackingIndex(visibleIndex);
    if (bi === -1) {
      const entry = { ...createCalculationRow(), type: activeMode, ...patch };
      if (entry.type !== 'row') entry.expression = exprFromParts(entry);
      handleChange([...localItems, entry]);
      return;
    }
    handleChange(
      localItems.map((item, i) => {
        if (i !== bi) return item;
        const updated = { ...item, ...patch };
        if (updated.type !== 'row') updated.expression = exprFromParts(updated);
        return updated;
      })
    );
  }

  function addAfter(visibleIndex: number) {
    console.log(
      '[+] addAfter: visibleIdx',
      visibleIndex,
      'localItems',
      localItems.length,
      'type',
      activeMode
    );
    const bi = toBackingIndex(visibleIndex);
    if (bi === -1) {
      handleChange([...localItems, { ...createCalculationRow(), type: activeMode }]);
      return;
    }
    const entry = { ...createCalculationRow(), type: activeMode };
    handleChange([...localItems.slice(0, bi + 1), entry, ...localItems.slice(bi + 1)]);
  }

  function removeItem(visibleIndex: number) {
    const bi = toBackingIndex(visibleIndex);
    if (bi === -1) return;
    handleChange(localItems.filter((_, i) => i !== bi));
  }

  const [partitionOpen, setPartitionOpen] = useState<Record<number, boolean>>({});
  const [orderOpen, setOrderOpen] = useState<Record<number, boolean>>({});

  const fnGroups = useMemo(
    () => ({
      agg: [
        {
          key: 'agg' as const,
          items: AGG_FUNCTIONS.map((f) => ({ value: f, label: tr('calcFieldFn_' + f, f) })),
        },
      ],
      window: [
        {
          key: 'window' as const,
          items: WINDOW_FUNCTIONS.map((f) => ({ value: f, label: tr('calcFieldFn_' + f, f) })),
        },
      ],
    }),
    [tr]
  );

  function rowColumns(mode: 'row' | 'agg' | 'window') {
    const actionOptions = [
      { value: 'add', label: tr('calcFieldActionAdd', '新增字段') },
      { value: 'replace', label: tr('calcFieldActionReplace', '替换字段') },
    ];

    const insertModeCol: GlassRowListColumn<CalculationRow> = {
      flex: mode === 'window' ? 'flex-[0.5]' : 'flex-[1]',
      header: '',
      render: (item: CalculationRow, index: number) => (
        <GlassOperatorSelect
          value={item.action || 'add'}
          groups={[{ key: 'action', items: actionOptions }]}
          onChange={(v) => updateItem(index, { action: v as 'add' | 'replace' })}
          className="h-7 text-[12px] [&>span]:text-left w-full"
        />
      ),
    };
    const targetFieldCol: GlassRowListColumn<CalculationRow> = {
      flex: 'flex-[1]',
      header: '',
      render: (item: CalculationRow, index: number) =>
        item.action === 'replace' ? (
          <GlassFieldCombo
            value={fieldCompletions.includes(item.field) ? item.field : ''}
            options={fieldCompletions}
            columnTypes={columnTypes}
            onChange={(v) => updateItem(index, { field: v })}
            placeholder={tr('calcFieldSelectPlaceholder', '选择字段')}
            className="h-7 w-full text-[12px]"
          />
        ) : (
          <GlassFormTextInput
            value={item.field}
            onChange={(v) => updateItem(index, { field: v })}
            placeholder={tr('calcFieldTargetPlaceholder', '如 margin')}
            className="!h-7 w-full rounded-md px-1.5 text-[12px] shadow-none focus:ring-0"
          />
        ),
    };

    if (mode === 'row') {
      return [
        { ...insertModeCol, header: tr('calcFieldActionHeader', '插入模式') },
        { ...targetFieldCol, header: tr('calcFieldTargetField', '目标字段') },
        {
          flex: 'flex-[4]',
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
        },
      ];
    }

    // Agg/window layout
    const fnCol: GlassRowListColumn<CalculationRow> = {
      flex: mode === 'window' ? 'flex-[0.5]' : 'flex-[1]',
      header: '',
      render: (item: CalculationRow, index: number) => (
        <GlassOperatorSelect
          value={item.fn || (mode === 'agg' ? 'sum' : 'row_number')}
          groups={fnGroups[mode === 'agg' ? 'agg' : 'window']}
          onChange={(v) => updateItem(index, { fn: v })}
          className="h-7 text-[12px] [&>span]:text-left w-full"
        />
      ),
    };
    const fnArgCol: GlassRowListColumn<CalculationRow> = {
      flex: mode === 'agg' ? 'flex-[1.5]' : 'flex-[1]',
      header: '',
      render: (item: CalculationRow, index: number) => (
        <GlassFieldCombo
          value={item.fnArg ?? ''}
          options={fieldCompletions}
          columnTypes={columnTypes}
          onChange={(v) => updateItem(index, { fnArg: v })}
          placeholder={tr('calcFieldFnArgPlaceholder', '[amount]')}
          className="h-7 w-full text-[12px]"
        />
      ),
    };
    const partitionByCol: GlassRowListColumn<CalculationRow> = {
      flex: mode === 'agg' ? 'flex-[2.5]' : 'flex-[2]',
      header: '',
      render: (item: CalculationRow, index: number) => {
        const open = partitionOpen[index];
        return (
          <div className="relative w-full">
            <div className="flex min-h-7 items-center rounded-md border border-border-muted bg-background/42 focus-within:border-accent">
              {item.partitionBy?.length ? (
                <button
                  type="button"
                  onClick={() => updateItem(index, { partitionBy: undefined })}
                  className="ml-1 inline-flex flex-shrink-0 items-center justify-center self-stretch rounded px-1 text-text-muted hover:text-error hover:bg-error/10 transition-colors"
                  title={tr('clearAll', '清空')}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              ) : null}
              <div className="flex flex-1 items-center gap-1 px-1.5 min-w-0 overflow-x-auto">
                {item.partitionBy?.map((col) => (
                  <span
                    key={col}
                    className="inline-flex shrink-0 items-center gap-0.5 rounded bg-accent/10 px-1.5 py-0.5 text-[12px] font-medium text-accent"
                  >
                    {col}
                    <button
                      type="button"
                      onClick={() =>
                        updateItem(index, {
                          partitionBy: item.partitionBy?.filter((c) => c !== col),
                        })
                      }
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
                    !item.partitionBy?.length
                      ? tr('calcFieldPartitionPlaceholder', '选择分区字段')
                      : ''
                  }
                  onFocus={() => setPartitionOpen((o) => ({ ...o, [index]: true }))}
                  onBlur={() =>
                    setTimeout(() => setPartitionOpen((o) => ({ ...o, [index]: false })), 150)
                  }
                  className="h-5 min-w-0 flex-1 bg-transparent text-[12px] text-text-primary outline-none placeholder:text-text-muted cursor-pointer"
                />
              </div>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setPartitionOpen((o) => ({ ...o, [index]: !open }))}
                className="flex w-7 flex-shrink-0 items-center justify-center self-stretch border-l border-border-muted text-text-muted hover:text-text-secondary transition-colors rounded-r-md"
              >
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
                />
              </button>
            </div>
            {open && (
              <div className="absolute z-10 left-0 right-0 mt-0.5">
                <GlassColumnSelector
                  columns={fieldCompletions}
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
    };

    if (mode === 'agg') {
      return [
        insertModeCol,
        targetFieldCol,
        { flex: 'flex-[2]', header: '', render: () => null },
        fnCol,
        fnArgCol,
        partitionByCol,
      ];
    }

    // window mode
    const orderByCol: GlassRowListColumn<CalculationRow> = {
      flex: 'flex-[2]',
      header: '',
      render: (item: CalculationRow, index: number) => {
        const open = orderOpen[index];
        return (
          <div className="relative w-full">
            <div className="flex min-h-7 items-center rounded-md border border-border-muted bg-background/42 focus-within:border-accent">
              {item.orderBy?.length ? (
                <button
                  type="button"
                  onClick={() => updateItem(index, { orderBy: undefined })}
                  className="ml-1 inline-flex flex-shrink-0 items-center justify-center self-stretch rounded px-1 text-text-muted hover:text-error hover:bg-error/10 transition-colors"
                  title={tr('clearAll', '清空')}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              ) : null}
              <div className="flex flex-1 items-center gap-1 px-1.5 min-w-0 overflow-x-auto">
                {item.orderBy?.map((o) => (
                  <span
                    key={o.field}
                    className="inline-flex shrink-0 items-center gap-0.5 rounded bg-accent/10 px-1.5 py-0.5 text-[12px] font-medium text-accent"
                  >
                    {o.field}
                    <button
                      type="button"
                      onClick={() =>
                        updateItem(index, {
                          orderBy: item.orderBy?.map((x) =>
                            x.field === o.field
                              ? {
                                  ...x,
                                  direction:
                                    x.direction === 'desc' ? ('asc' as const) : ('desc' as const),
                                }
                              : x
                          ),
                        })
                      }
                      className="text-[11px] leading-none px-0.5 hover:text-text-primary rounded"
                      title={o.direction === 'asc' ? tr('asc', '升序') : tr('desc', '降序')}
                    >
                      {o.direction === 'asc' ? '↑' : '↓'}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        updateItem(index, {
                          orderBy: item.orderBy?.filter((x) => x.field !== o.field),
                        })
                      }
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
                    !item.orderBy?.length ? tr('calcFieldOrderPlaceholder', '选择排序字段') : ''
                  }
                  onFocus={() => setOrderOpen((o) => ({ ...o, [index]: true }))}
                  onBlur={() =>
                    setTimeout(() => setOrderOpen((o) => ({ ...o, [index]: false })), 150)
                  }
                  className="h-5 min-w-0 flex-1 bg-transparent text-[12px] text-text-primary outline-none placeholder:text-text-muted cursor-pointer"
                />
              </div>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setOrderOpen((o) => ({ ...o, [index]: !open }))}
                className="flex w-7 flex-shrink-0 items-center justify-center self-stretch border-l border-border-muted text-text-muted hover:text-text-secondary transition-colors rounded-r-md"
              >
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
                />
              </button>
            </div>
            {open && (
              <div className="absolute z-10 left-0 right-0 mt-0.5">
                <GlassColumnSelector
                  columns={fieldCompletions}
                  selected={item.orderBy?.map((o) => o.field) ?? []}
                  onChange={(v) =>
                    updateItem(index, {
                      orderBy:
                        v.length > 0
                          ? v.map((f) => {
                              const existing = item.orderBy?.find((x) => x.field === f);
                              return {
                                field: f,
                                direction: existing?.direction ?? ('asc' as const),
                              };
                            })
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
    };

    const frameCol: GlassRowListColumn<CalculationRow> = {
      flex: 'flex-[1]',
      header: '',
      render: (item: CalculationRow, index: number) => {
        const currentKey = `${item.frameStart ?? 'unbounded preceding'}|${item.frameEnd ?? 'unbounded following'}`;
        const presets = FRAME_PRESETS.map((p) => ({
          value: p.value,
          label: tr(p.key, p.label),
        }));
        return (
          <GlassOperatorSelect
            value={currentKey}
            groups={[{ key: 'frame', items: presets }]}
            onChange={(v) => {
              const [frameStart, frameEnd] = v.split('|');
              updateItem(index, { frameStart, frameEnd });
            }}
            className="h-7 text-[12px] [&>span]:text-left w-full"
          />
        );
      },
    };

    return [
      insertModeCol,
      targetFieldCol,
      fnCol,
      fnArgCol,
      partitionByCol,
      orderByCol,
      frameCol,
    ] as GlassRowListColumn<CalculationRow>[];
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
                  ? tr('calcFieldConfigHintAgg', '选择聚合/排名函数、参数字段和分区字段')
                  : tr('calcFieldConfigHintWindow', '选择窗口函数、参数字段、分区、排序和行范围')}
            </span>
          </div>
        </div>
        <div className="px-3 pb-3 overflow-y-auto flex-1 min-h-0">
          {(() => {
            console.log(
              '[render] visibleItems:',
              visibleItems.length,
              'localItems:',
              localItems.length,
              'mode:',
              activeMode
            );
            const cols = rowColumns(activeMode);
            if (activeMode === 'row') {
              return (
                <GlassRowList
                  items={visibleItems}
                  columns={cols as GlassRowListColumn<CalculationRow>[]}
                  onAdd={addAfter}
                  onRemove={removeItem}
                  addTitle={tr('calcFieldAddRule', '添加规则')}
                  removeTitle={tr('calcFieldRemove', '删除规则')}
                />
              );
            }
            const breakAtValue = activeMode === 'agg' ? 3 : 4;
            return (
              <GlassRowList
                items={visibleItems}
                columns={cols as GlassRowListColumn<CalculationRow>[]}
                onAdd={addAfter}
                onRemove={removeItem}
                addTitle={tr('calcFieldAddRule', '添加规则')}
                removeTitle={tr('calcFieldRemove', '删除规则')}
                breakAt={breakAtValue}
                inlineActions
                hideHeader
              />
            );
          })()}
        </div>
      </div>
    </div>
  );
}
