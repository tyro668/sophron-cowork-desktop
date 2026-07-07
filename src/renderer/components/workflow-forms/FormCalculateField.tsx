import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, RotateCcw, Trash2, X } from 'lucide-react';
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

const AGG_FUNCTIONS = [
  'sum',
  'avg',
  'min',
  'max',
  'count',
  'count_distinct',
  'median',
  'stddev',
  'var',
];
const WINDOW_FUNCTIONS = [
  'row_number',
  'rank',
  'dense_rank',
  'ntile',
  'lag',
  'lead',
  'first_value',
  'last_value',
  'percent_rank',
  'cume_dist',
  'nth_value',
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
  { value: 'custom', label: '自定义', key: 'calcFieldFrameCustom' },
];

const SCENARIO_OPTIONS = [
  {
    value: 'group',
    key: 'calcFieldScenarioGroup',
    label: '分组统计',
    tip: '分区聚合、中位数、占比',
  },
  {
    value: 'sorted',
    key: 'calcFieldScenarioSorted',
    label: '排序计算',
    tip: '累计、移动平均、自定义滑动窗口、前后行值',
  },
  { value: 'rank', key: 'calcFieldScenarioRank', label: '排序编号', tip: '行号、排名、分桶' },
  { value: 'period', key: 'calcFieldScenarioPeriod', label: '周期对比', tip: '同比/环比' },
];

const SCENARIO_FUNCTIONS: Record<string, string[]> = {
  group: [
    'sum',
    'avg',
    'min',
    'max',
    'count',
    'count_distinct',
    'median',
    'stddev',
    'var',
    'mode',
    'quantile_cont',
    'first_value',
    'last_value',
    'nth_value',
    'percentage',
  ],
  sorted: [
    'sum',
    'avg',
    'min',
    'max',
    'count',
    'count_distinct',
    'median',
    'stddev',
    'var',
    'mode',
    'quantile_cont',
    'product',
    'first_value',
    'last_value',
    'nth_value',
    'lag',
    'lead',
  ],
  rank: ['row_number', 'rank', 'dense_rank', 'ntile', 'percent_rank', 'cume_dist'],
  period: ['period_yoy_value', 'period_yoy_rate', 'period_mom_value', 'period_mom_rate'],
};

function parseFrameN(frameStart: string | undefined): number {
  if (!frameStart || frameStart === 'unbounded preceding') return -1;
  const m = frameStart.match(/^(\d+) preceding$/);
  return m ? parseInt(m[1], 10) : 0;
}

function parseFrameM(frameEnd: string | undefined): number {
  if (!frameEnd || frameEnd === 'unbounded following') return -1;
  if (frameEnd === 'current row') return 0;
  const m = frameEnd.match(/^(\d+) following$/);
  return m ? parseInt(m[1], 10) : 0;
}

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

  const [activeMode, setActiveMode] = useState<'row' | 'cross'>('row');
  const [activeScenario, setActiveScenario] = useState<string>('group');

  const visibleItems = useMemo(() => {
    const filtered = localItems.filter((i) =>
      activeMode === 'row' ? i.type === 'row' : i.type !== 'row'
    );
    if (filtered.length > 0) return [filtered[0]];
    if (activeMode === 'row') return [createCalculationRow()];
    return [{ ...createCalculationRow(), type: 'cross' as const }] as CalculationRow[];
  }, [localItems, activeMode]);

  function toBackingIndex(visibleIndex: number): number {
    let count = 0;
    for (let i = 0; i < localItems.length; i++) {
      const match =
        activeMode === 'row' ? localItems[i].type === 'row' : localItems[i].type !== 'row';
      if (match) {
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

  function resetItem(visibleIndex: number) {
    const bi = toBackingIndex(visibleIndex);
    if (bi === -1) return;
    handleChange(
      localItems.map((it, i) =>
        i !== bi ? it : { ...createCalculationRow(), type: it.type, action: it.action }
      )
    );
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

  function rowColumns(mode: 'row' | 'agg' | 'window' | 'cross') {
    const scenarioDefaults: Record<string, string> = {
      group: 'sum',
      sorted: 'sum',
      rank: 'row_number',
      period: 'period_yoy_value',
    };
    const currentFnGroups =
      mode === 'cross'
        ? [
            {
              key: 'scenario',
              items: SCENARIO_FUNCTIONS[activeScenario].map((f) => ({
                value: f,
                label: tr('calcFieldFn_' + f, f),
              })),
            },
          ]
        : fnGroups[mode === 'agg' ? 'agg' : 'window'];
    const defaultFn =
      mode === 'cross' ? scenarioDefaults[activeScenario] : mode === 'agg' ? 'sum' : 'row_number';
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
            placeholder={tr('calcFieldTargetPlaceholder', '请输入字段名')}
            className="!h-7 w-full rounded-md px-1.5 text-[12px] shadow-none focus:ring-0"
          />
        ),
    };

    if (mode === 'row') {
      return [
        { ...insertModeCol, flex: 'flex-[1]', header: tr('calcFieldActionHeader', '插入模式') },
        { ...targetFieldCol, flex: 'flex-[2]', header: tr('calcFieldTargetField', '目标字段') },
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
              placeholder={tr('calcFieldExpressionPlaceholder', '请输入表达式')}
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
          value={item.fn || defaultFn}
          groups={currentFnGroups}
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
          placeholder={tr('calcFieldFnArgPlaceholder', '选择字段')}
          className="h-7 w-full text-[12px]"
        />
      ),
    };
    const partitionByCol: GlassRowListColumn<CalculationRow> = {
      flex: mode === 'agg' ? 'flex-[2.5]' : 'flex-[1]',
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
      flex: 'flex-[1]',
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
        const isCustom = !FRAME_PRESETS.filter((p) => p.value !== 'custom').some(
          (p) => p.value === currentKey
        );
        const presets = FRAME_PRESETS.map((p) => ({
          value: p.value,
          label: tr(p.key, p.label),
        }));
        const n = isCustom ? parseFrameN(item.frameStart) : 0;
        const m = isCustom ? parseFrameM(item.frameEnd) : 0;

        return (
          <div className="flex flex-row items-center gap-1 w-full">
            <GlassOperatorSelect
              value={isCustom ? 'custom' : currentKey}
              groups={[{ key: 'frame', items: presets }]}
              onChange={(v) => {
                if (v === 'custom') {
                  updateItem(index, { frameStart: '1 preceding', frameEnd: 'current row' });
                  return;
                }
                const [frameStart, frameEnd] = v.split('|');
                updateItem(index, { frameStart, frameEnd });
              }}
              className={`h-7 text-[12px] [&>span]:text-left ${isCustom ? 'flex-1 min-w-0' : 'w-full'}`}
            />
            {isCustom && (
              <div className="flex-1 min-w-0 flex items-center gap-1 text-[12px] text-text-muted">
                <span className="shrink-0">前</span>
                <input
                  type="number"
                  min={0}
                  value={n < 0 ? '' : n}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (isNaN(val) || val < 0) return;
                    updateItem(index, { frameStart: val > 0 ? `${val} preceding` : 'current row' });
                  }}
                  placeholder="∞"
                  className="h-6 w-12 rounded border border-border-muted bg-background/42 px-1 text-center text-[12px] text-text-primary outline-none"
                />
                <span className="shrink-0">行 → 后</span>
                <input
                  type="number"
                  min={0}
                  value={m < 0 ? '' : m}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (isNaN(val) || val < 0) return;
                    updateItem(index, { frameEnd: val > 0 ? `${val} following` : 'current row' });
                  }}
                  placeholder="∞"
                  className="h-6 w-12 rounded border border-border-muted bg-background/42 px-1 text-center text-[12px] text-text-primary outline-none"
                />
                <span className="shrink-0">行</span>
              </div>
            )}
          </div>
        );
      },
    };

    if (mode === 'cross') {
      if (activeScenario === 'sorted') {
        return [
          insertModeCol,
          targetFieldCol,
          fnCol,
          fnArgCol,
          orderByCol,
          partitionByCol,
          { flex: 'w-full h-0', header: '', render: () => null },
          frameCol,
        ] as GlassRowListColumn<CalculationRow>[];
      }
      if (activeScenario === 'group') {
        return [
          insertModeCol,
          targetFieldCol,
          fnCol,
          fnArgCol,
          partitionByCol,
        ] as GlassRowListColumn<CalculationRow>[];
      }
      // rank, period: no frame, with orderBy
      return [
        insertModeCol,
        targetFieldCol,
        fnCol,
        fnArgCol,
        orderByCol,
        partitionByCol,
      ] as GlassRowListColumn<CalculationRow>[];
    }

    return [
      insertModeCol,
      targetFieldCol,
      fnCol,
      fnArgCol,
      orderByCol,
      partitionByCol,
      { flex: 'w-full h-0', header: '', render: () => null },
      frameCol,
    ] as GlassRowListColumn<CalculationRow>[];
  }

  return (
    <div className="flex gap-2.5 h-full min-h-0">
      {/* Left panel — mode selection */}
      <div className="flex-[1] rounded-lg border border-border-muted bg-background/42 content-start">
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
        <div className="px-3 pb-3 flex flex-col gap-1.5">
          <GlassRadioSelect
            value={activeMode}
            options={[
              {
                value: 'row',
                label: tr('calcFieldModeRow', '逐行计算'),
                tip: tr('calcFieldModeRowTip', '基于当前行的字段做运算，不依赖其他行'),
              },
              {
                value: 'cross',
                label: tr('calcFieldModeCross', '跨行计算'),
                tip: tr('calcFieldModeCrossTip', '按分区汇总、排名、滑动窗口、周期对比等'),
              },
            ]}
            onChange={(v) => setActiveMode(v as 'row' | 'cross')}
            label={tr('calcFieldModeHeader', '计算模式')}
          />
        </div>
      </div>

      {/* Right panel — expression list */}
      <div className="flex-[4] rounded-lg border border-border-muted bg-background/42 content-start overflow-hidden flex flex-col">
        <div className="flex items-end gap-3 px-3 pt-2.5 pb-1.5 shrink-0">
          <span className="h-8 w-8 rounded-full bg-accent/20 text-[14px] font-bold text-accent flex items-center justify-center leading-none">
            2
          </span>
          <div className="flex items-start gap-2 min-w-0 flex-1">
            <div className="grid min-w-0 flex-1">
              <span className="text-[13px] font-semibold text-text-primary">
                {tr('calcFieldConfigHeader', '计算配置')}
              </span>
              {activeMode === 'row' && (
                <span className="text-[10px] text-text-muted">
                  {tr('calcFieldConfigHintRow', '定义新字段及其计算表达式')}
                </span>
              )}
              {activeMode === 'cross' && (
                <span className="text-[10px] text-text-muted">
                  {tr('calcFieldConfigHintCross', '选择模式并进行配置')}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => resetItem(0)}
              className="mt-0.5 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:text-accent"
              title={tr('calcFieldReset', '重置配置')}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {activeMode === 'cross' && (
          <div className="px-3 pb-2 flex flex-row flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium text-text-muted whitespace-nowrap">
              {tr('calcFieldScenarioLabel', '请选择计算类别')}
            </span>
            <div className="w-1/4 min-w-[120px]">
              <GlassOperatorSelect
                value={activeScenario}
                groups={[
                  {
                    key: 'scenario',
                    items: SCENARIO_OPTIONS.map((s) => ({
                      value: s.value,
                      label: tr(s.key, s.label),
                    })),
                  },
                ]}
                onChange={(v) => setActiveScenario(v)}
                className="h-7 text-[12px] w-full"
              />
            </div>
            <span className="text-[10px] text-text-muted">
              {tr(
                activeScenario + 'Hint',
                SCENARIO_OPTIONS.find((s) => s.value === activeScenario)?.tip || ''
              )}
            </span>
          </div>
        )}
        <div className="px-3 pb-3 overflow-y-auto flex-1 min-h-0">
          {(() => {
            if (activeMode === 'row') {
              return (
                <GlassRowList
                  items={visibleItems as CalculationRow[]}
                  columns={rowColumns('row')}
                  onAdd={() => {}}
                  onRemove={() => {}}
                  addTitle=""
                  removeTitle=""
                  hideActions
                />
              );
            }
            return (
              <GlassRowList
                key={activeScenario}
                items={visibleItems as CalculationRow[]}
                columns={rowColumns('cross')}
                onAdd={() => {}}
                onRemove={() => {}}
                addTitle=""
                removeTitle=""
                hideActions
                breakAt={activeScenario === 'group' ? 3 : 4}
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
