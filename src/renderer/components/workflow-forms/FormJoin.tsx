import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Settings, Trash2 } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import { GlassRowList, type RowAction } from './shared/GlassRowList';
import { isTemporalDataFieldType } from '@/shared/data-field-types';
import { parseFieldRef } from '@/shared/prep-dsl/parser';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';

export interface ConditionEntry {
  left: string;
  operator: string;
  right: string;
}

const DEFAULT_CONDITION: ConditionEntry = { left: '', operator: '=', right: '' };

const OPERATOR_KEYS = [
  { value: '=', key: 'operatorEq', fallback: '等于' },
  { value: '!=', key: 'operatorNeq', fallback: '不等于' },
  { value: '<', key: 'operatorLt', fallback: '小于' },
  { value: '<=', key: 'operatorLte', fallback: '小于等于' },
  { value: '>', key: 'operatorGt', fallback: '大于' },
  { value: '>=', key: 'operatorGte', fallback: '大于等于' },
];

function isLeftField(source: string, leftAlias: string): boolean {
  const ref = parseFieldRef(source);
  if (ref?.source) return ref.source === leftAlias;
  return source.startsWith(`${leftAlias}.`);
}

function isRightField(source: string, rightAlias: string): boolean {
  const ref = parseFieldRef(source);
  if (ref?.source) return ref.source === rightAlias;
  return source.startsWith(`${rightAlias}.`);
}

// ── Venn-diagram SVG for each join type ──
function JoinVennSVG({ type, selected }: { type: string; selected: boolean }) {
  const id = useId();
  const op = selected ? '0.55' : '0.2';
  const strokeOp = '0.3';

  if (type === 'cross') {
    return (
      <svg viewBox="0 0 48 32" className="h-6 w-auto shrink-0">
        <line
          x1="14"
          y1="10"
          x2="34"
          y2="22"
          stroke="currentColor"
          strokeWidth="1.3"
          opacity={op}
        />
        <line
          x1="34"
          y1="10"
          x2="14"
          y2="22"
          stroke="currentColor"
          strokeWidth="1.3"
          opacity={op}
        />
      </svg>
    );
  }
  if (type === 'asof') {
    return (
      <svg viewBox="0 0 48 32" className="h-6 w-auto shrink-0">
        <line x1="6" y1="16" x2="42" y2="16" stroke="currentColor" strokeWidth="1" opacity="0.4" />
        <circle cx="14" cy="16" r="2.5" fill="currentColor" opacity={op} />
        <circle cx="24" cy="16" r="2.5" fill="currentColor" opacity={op} />
        <circle cx="34" cy="16" r="2.5" fill="currentColor" opacity={op} />
        <polygon points="42,16 38,13 38,19" fill="currentColor" opacity={op} />
      </svg>
    );
  }
  // Venn types (inner, left, right, full, semi, anti)
  const clipId = `clip-${id}`;
  const maskId = `mask-${id}`;
  return (
    <svg viewBox="0 0 48 32" className="h-6 w-auto shrink-0">
      <defs>
        <clipPath id={clipId}>
          <circle cx="32" cy="16" r="11" />
        </clipPath>
        <mask id={maskId}>
          <rect x="0" y="0" width="48" height="32" fill="white" />
          <circle cx="32" cy="16" r="11" fill="black" />
        </mask>
      </defs>
      {/* Left circle fill variants */}
      {(type === 'left' || type === 'full') && (
        <circle cx="16" cy="16" r="11" fill="currentColor" opacity={op} />
      )}
      {type === 'inner' && (
        <circle
          cx="16"
          cy="16"
          r="11"
          fill="currentColor"
          opacity={op}
          clipPath={`url(#${clipId})`}
        />
      )}
      {type === 'semi' && (
        <circle
          cx="16"
          cy="16"
          r="11"
          fill="currentColor"
          opacity={op}
          clipPath={`url(#${clipId})`}
        />
      )}
      {type === 'anti' && (
        <circle cx="16" cy="16" r="11" fill="currentColor" opacity={op} mask={`url(#${maskId})`} />
      )}
      {/* Right circle fill variants */}
      {(type === 'right' || type === 'full') && (
        <circle cx="32" cy="16" r="11" fill="currentColor" opacity={op} />
      )}
      {/* Outlines */}
      <circle
        cx="16"
        cy="16"
        r="11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        opacity={strokeOp}
      />
      <circle
        cx="32"
        cy="16"
        r="11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        opacity={strokeOp}
      />
    </svg>
  );
}

export default function FormJoin({
  node,
  taskId,
  fieldCompletions,
  otherNodes,
  sourceNode,
  rightSourceNode,
  onNodeChange,
}: OperatorFormProps) {
  const { t } = useTranslation();
  const tr = useCallback(
    (key: string, fallback: string) =>
      t(`data.workflow.formLabels.${key}`, { defaultValue: fallback }),
    [t]
  );

  const updateConfig = useUpdateConfig(onNodeChange);

  const joinType = (node.config.joinType as string) ?? 'left';
  const conditions = useMemo(
    () => (node.config.conditions as ConditionEntry[]) ?? [DEFAULT_CONDITION],
    [node.config.conditions]
  );
  const conflict = useMemo(
    () => (node.config.conflict as Record<string, unknown>) ?? {},
    [node.config.conflict]
  );
  const conflictStrategy = (conflict.strategy as string) ?? 'suffix';
  const rightPrefix = (conflict.rightPrefix as string) ?? '';
  const keepItems = useMemo(
    () => (node.config.keep as Array<Record<string, unknown>>) ?? [],
    [node.config.keep]
  );

  // ASOF
  const asof = (node.config.asof as Record<string, unknown>) ?? {};
  const asofLeftTime = (asof.leftTime as string) ?? '';
  const asofOperator = (asof.operator as string) ?? '>=';
  const asofRightTime = (asof.rightTime as string) ?? '';

  const isAsof = joinType === 'asof';
  const needsConditions = joinType !== 'cross';

  const resolveNodeLabel = useCallback(
    (nodeRef: { id: string; config?: Record<string, unknown> } | undefined): string => {
      if (!nodeRef) return '';
      const full = otherNodes.find((n) => n.id === nodeRef.id);
      if (full) return full.label || (full.config?.alias as string) || '';
      return (nodeRef.config?.alias as string) || nodeRef.id;
    },
    [otherNodes]
  );

  const leftSourceLabel = useMemo(
    () => resolveNodeLabel(sourceNode),
    [sourceNode, resolveNodeLabel]
  );
  const rightSourceLabel = useMemo(
    () => resolveNodeLabel(rightSourceNode),
    [rightSourceNode, resolveNodeLabel]
  );

  const leftAlias = leftSourceLabel || 'left';
  const rightAlias = rightSourceLabel || 'right_source';

  // Column types for both tables
  // Right table column names (fetched via IPC, same as before)
  const [rightRawColumns, setRightRawColumns] = useState<string[]>([]);
  const [rightColumnsError, setRightColumnsError] = useState(false);
  // Optional column type info for ASOF time field filtering
  const leftColumnTypes = useWorkflowNodeColumnTypes({ taskId, sourceNode });
  const rightColumnTypes = useWorkflowNodeColumnTypes({ taskId, sourceNode: rightSourceNode });

  useEffect(() => {
    setRightRawColumns([]);
    setRightColumnsError(false);
    if (!rightSourceNode || typeof taskId !== 'string') return;
    const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;
    if (!isElectron) return;
    void window
      .electronAPI!.data.getWorkflowNodeColumns({
        taskId,
        nodeId: rightSourceNode.id,
        nodeType: rightSourceNode.type as never,
        nodeConfig: rightSourceNode.config,
      })
      .then((cols: string[]) => {
        setRightRawColumns(cols);
        setRightColumnsError(false);
      })
      .catch(() => {
        setRightRawColumns([]);
        setRightColumnsError(true);
      });
  }, [rightSourceNode, taskId]);

  const joinTypes = useMemo(
    () => [
      {
        value: 'inner',
        label: tr('joinInner', '内连接'),
        tip: tr('joinInnerTip', '仅保留两表匹配的记录'),
      },
      {
        value: 'left',
        label: tr('joinLeft', '左连接'),
        tip: tr('joinLeftTip', '保留左表全部记录，右表仅保留匹配的'),
      },
      {
        value: 'right',
        label: tr('joinRight', '右连接'),
        tip: tr('joinRightTip', '保留右表全部记录，左表仅保留匹配的'),
      },
      {
        value: 'full',
        label: tr('joinFull', '全连接'),
        tip: tr('joinFullTip', '保留两表全部记录，不匹配的字段为空'),
      },
      {
        value: 'cross',
        label: tr('joinCross', '交叉'),
        tip: tr('joinCrossTip', '返回两表的笛卡尔积'),
      },
      {
        value: 'semi',
        label: tr('joinSemi', '半连接'),
        tip: tr('joinSemiTip', '仅返回左表中与右表匹配的记录'),
      },
      {
        value: 'anti',
        label: tr('joinAnti', '反连接'),
        tip: tr('joinAntiTip', '返回左表中与右表不匹配的记录'),
      },
      {
        value: 'asof',
        label: tr('joinAsof', '时间近邻'),
        tip: tr('joinAsofTip', '基于最近时间戳匹配两表记录'),
      },
    ],
    [tr]
  );

  const rightFieldCompletions = useMemo(() => {
    if (!rightSourceLabel || rightRawColumns.length === 0) return [] as string[];
    return rightRawColumns.map((c) => `[${rightAlias}].[${c}]`);
  }, [rightAlias, rightRawColumns, rightSourceLabel]);

  const leftFieldCompletions = useMemo(
    () => fieldCompletions.map((c) => `[${leftAlias}].[${c}]`),
    [fieldCompletions, leftAlias]
  );

  const hasLeftTypes = Object.keys(leftColumnTypes).length > 0;
  const hasRightTypes = Object.keys(rightColumnTypes).length > 0;
  const leftColumnTypesQualified = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [name, type] of Object.entries(leftColumnTypes)) {
      map[`[${leftAlias}].[${name}]`] = type;
    }
    return map;
  }, [leftColumnTypes, leftAlias]);
  const asofLeftTimeOptions = useMemo(() => {
    const filtered = hasLeftTypes
      ? fieldCompletions.filter((c) => isTemporalDataFieldType(leftColumnTypes[c]))
      : fieldCompletions;
    return filtered.map((c) => `[${leftAlias}].[${c}]`);
  }, [fieldCompletions, leftColumnTypes, hasLeftTypes, leftAlias]);
  const rightColumnTypesQualified = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [name, type] of Object.entries(rightColumnTypes)) {
      map[`[${rightAlias}].[${name}]`] = type;
    }
    return map;
  }, [rightColumnTypes, rightAlias]);
  const asofRightTimeOptions = useMemo(
    () =>
      hasRightTypes
        ? rightFieldCompletions.filter((opt) => {
            const m = opt.match(/\[.*?\]\.\[(.+?)\]/);
            return m ? isTemporalDataFieldType(rightColumnTypes[m[1]]) : false;
          })
        : rightFieldCompletions,
    [rightFieldCompletions, rightColumnTypes, hasRightTypes]
  );

  function handleJoinTypeChange(value: string) {
    updateConfig((cfg) => ({
      ...cfg,
      joinType: value,
      conditions: value === 'cross' ? undefined : cfg.conditions,
      asof: value === 'asof' ? (cfg.asof ?? {}) : undefined,
    }));
  }

  function handleKeepChange(items: Array<Record<string, unknown>>) {
    updateConfig((cfg) => ({ ...cfg, keep: items.length > 0 ? items : undefined }));
  }

  // ── Keep field modal state ──
  const [keepDialogOpen, setKeepDialogOpen] = useState(false);
  const [draftKeepAll, setDraftKeepAll] = useState(true);
  const [draftLeftSel, setDraftLeftSel] = useState(new Set<string>());
  const [draftRightSel, setDraftRightSel] = useState(new Set<string>());
  const [draftLeftAliases, setDraftLeftAliases] = useState(new Map<string, string>());
  const [draftRightAliases, setDraftRightAliases] = useState(new Map<string, string>());

  function openKeepDialog() {
    const hasWildcards = keepItems.some((i) => i.wildcard);
    const specific = keepItems.filter((i) => !i.wildcard);
    setDraftKeepAll(hasWildcards);

    const leftAliases = new Map<string, string>();
    setDraftLeftSel(
      new Set(
        specific
          .filter((i) => isLeftField(String(i.source), leftAlias))
          .map((i) => {
            if (typeof i.alias === 'string') {
              leftAliases.set(String(i.source), i.alias);
            }
            return String(i.source);
          })
      )
    );
    setDraftLeftAliases(leftAliases);

    const rightAliases = new Map<string, string>();
    setDraftRightSel(
      new Set(
        specific
          .filter((i) => isRightField(String(i.source), rightAlias))
          .map((i) => {
            if (typeof i.alias === 'string') {
              rightAliases.set(String(i.source), i.alias);
            }
            return String(i.source);
          })
      )
    );
    setDraftRightAliases(rightAliases);

    setKeepDialogOpen(true);
  }

  function confirmKeep() {
    const items: Array<Record<string, unknown>> = [];
    if (draftKeepAll) {
      items.push({ side: 'left', wildcard: true }, { side: 'right', wildcard: true });
    } else {
      for (const f of draftLeftSel) {
        const alias = draftLeftAliases.get(f);
        items.push(alias ? { source: f, alias } : { source: f });
      }
      for (const f of draftRightSel) {
        const alias = draftRightAliases.get(f);
        items.push(alias ? { source: f, alias } : { source: f });
      }
    }
    handleKeepChange(items);
    setKeepDialogOpen(false);
  }

  function cancelKeep() {
    setKeepDialogOpen(false);
  }

  function toggleDraftLeftField(field: string) {
    setDraftLeftSel((prev) => {
      const next = new Set(prev);
      if (next.has(field)) {
        next.delete(field);
        setDraftLeftAliases((a) => {
          const m = new Map(a);
          m.delete(field);
          return m;
        });
      } else {
        next.add(field);
      }
      return next;
    });
  }

  function toggleDraftRightField(field: string) {
    setDraftRightSel((prev) => {
      const next = new Set(prev);
      if (next.has(field)) {
        next.delete(field);
        setDraftRightAliases((a) => {
          const m = new Map(a);
          m.delete(field);
          return m;
        });
      } else {
        next.add(field);
      }
      return next;
    });
  }

  function toggleDraftLeftAll() {
    const allFields = fieldCompletions.map((f) => `[${leftAlias}].[${f}]`);
    setDraftLeftSel((prev) => (prev.size > 0 ? new Set() : new Set(allFields)));
  }

  function toggleDraftRightAll() {
    const allFields = rightRawColumns.map((f) => `[${rightAlias}].[${f}]`);
    setDraftRightSel((prev) => (prev.size > 0 ? new Set() : new Set(allFields)));
  }

  function updateLeftAlias(field: string, alias: string) {
    setDraftLeftAliases((prev) => {
      const next = new Map(prev);
      if (alias) next.set(field, alias);
      else next.delete(field);
      return next;
    });
  }

  function updateRightAlias(field: string, alias: string) {
    setDraftRightAliases((prev) => {
      const next = new Map(prev);
      if (alias) next.set(field, alias);
      else next.delete(field);
      return next;
    });
  }

  const draftLeftAllChecked = useMemo(
    () => draftLeftSel.size === fieldCompletions.length,
    [draftLeftSel, fieldCompletions]
  );
  const draftRightAllChecked = useMemo(
    () => draftRightSel.size === rightRawColumns.length,
    [draftRightSel, rightRawColumns]
  );

  const leftKeepCount = useMemo(() => {
    const wildcardItem = keepItems.find((i) => i.side === 'left' && i.wildcard);
    if (wildcardItem) return fieldCompletions.length;
    return keepItems.filter((i) => !i.wildcard && isLeftField(String(i.source ?? ''), leftAlias))
      .length;
  }, [keepItems, fieldCompletions, leftAlias]);
  const rightKeepCount = useMemo(() => {
    const wildcardItem = keepItems.find((i) => i.side === 'right' && i.wildcard);
    if (wildcardItem) return rightRawColumns.length;
    return keepItems.filter((i) => !i.wildcard && isRightField(String(i.source ?? ''), rightAlias))
      .length;
  }, [keepItems, rightRawColumns, rightAlias]);

  const leftRenameCount = useMemo(() => {
    return keepItems.filter(
      (i) =>
        !i.wildcard &&
        isLeftField(String(i.source ?? ''), leftAlias) &&
        typeof i.alias === 'string' &&
        i.alias
    ).length;
  }, [keepItems, leftAlias]);

  const rightRenameCount = useMemo(() => {
    return keepItems.filter(
      (i) =>
        !i.wildcard &&
        isRightField(String(i.source ?? ''), rightAlias) &&
        typeof i.alias === 'string' &&
        i.alias
    ).length;
  }, [keepItems, rightAlias]);

  // ── Inline condition handlers ──
  const [asofPending, setAsofPending] = useState<ConditionEntry>({ ...DEFAULT_CONDITION });

  const conditionOperatorItems = useMemo(
    () => OPERATOR_KEYS.map((op) => ({ value: op.value, label: tr(op.key, op.fallback) })),
    [tr]
  );

  function condHandleChange(
    isEmpty: boolean,
    pending: ConditionEntry,
    setPending: (v: ConditionEntry) => void,
    onChange: (next: ConditionEntry[]) => void,
    index: number,
    patch: Partial<ConditionEntry>
  ) {
    if (isEmpty) {
      const next = { ...pending, ...patch };
      setPending(next);
      if (next.left || next.right) {
        setPending({ ...DEFAULT_CONDITION });
        onChange([next]);
      }
    } else {
      const conditions =
        index === 0
          ? ((node.config.conditions as ConditionEntry[]) ?? [])
          : (((node.config.asof as Record<string, unknown>)?.by as ConditionEntry[]) ?? []);
      onChange(conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)));
    }
  }

  function condHandleRemove(
    isEmpty: boolean,
    setPending: (v: ConditionEntry) => void,
    onChange: (next: ConditionEntry[]) => void,
    index: number
  ) {
    if (isEmpty) {
      setPending({ ...DEFAULT_CONDITION });
    } else {
      const conditions =
        index === 0
          ? ((node.config.conditions as ConditionEntry[]) ?? [])
          : (((node.config.asof as Record<string, unknown>)?.by as ConditionEntry[]) ?? []);
      onChange(conditions.filter((_, i) => i !== index));
    }
  }

  function condHandleAdd(
    isEmpty: boolean,
    pending: ConditionEntry,
    setPending: (v: ConditionEntry) => void,
    onChange: (next: ConditionEntry[]) => void,
    index: number
  ) {
    if (isEmpty) {
      if (!pending.left && !pending.right) return;
      onChange([pending, { ...DEFAULT_CONDITION }]);
      setPending({ ...DEFAULT_CONDITION });
    } else {
      const conditions =
        index === 0
          ? ((node.config.conditions as ConditionEntry[]) ?? [])
          : (((node.config.asof as Record<string, unknown>)?.by as ConditionEntry[]) ?? []);
      const next = [...conditions];
      next.splice(index + 1, 0, { ...DEFAULT_CONDITION });
      onChange(next);
    }
  }

  function renderConditionRow(
    cond: ConditionEntry,
    i: number,
    isEmpty: boolean,
    pending: ConditionEntry,
    setPending: (v: ConditionEntry) => void,
    onChange: (next: ConditionEntry[]) => void,
    leftLabel: string,
    rightLabel: string
  ) {
    return (
      <div key={i} className="flex items-center gap-1">
        <GlassFieldSingleSelect
          value={cond.left}
          options={leftFieldCompletions}
          onChange={(v) => condHandleChange(isEmpty, pending, setPending, onChange, i, { left: v })}
          placeholder={leftLabel}
          className="h-7 w-0 flex-[1_1_0] min-w-[100px] text-[12px]"
        />
        <GlassOptionSingleSelect
          value={cond.operator}
          groups={[{ key: 'op', items: conditionOperatorItems }]}
          onChange={(v) =>
            condHandleChange(isEmpty, pending, setPending, onChange, i, { operator: v })
          }
          className="h-7 w-[72px] shrink-0 text-[12px] [&>span]:text-center"
        />
        <GlassFieldSingleSelect
          value={cond.right}
          options={rightFieldCompletions}
          onChange={(v) =>
            condHandleChange(isEmpty, pending, setPending, onChange, i, { right: v })
          }
          placeholder={rightLabel}
          className="h-7 w-0 flex-[1_1_0] min-w-[100px] text-[12px]"
        />
        <button
          type="button"
          onClick={() => condHandleAdd(isEmpty, pending, setPending, onChange, i)}
          className="h-6 w-6 flex shrink-0 items-center justify-center rounded text-text-muted/40 hover:text-accent transition-colors"
          title={tr('addCondition', '添加条件')}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => condHandleRemove(isEmpty, setPending, onChange, i)}
          className="h-6 w-6 flex shrink-0 items-center justify-center rounded text-text-muted/40 hover:text-error transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  function handleConditionsChange(next: ConditionEntry[]) {
    updateConfig((cfg) => ({ ...cfg, conditions: next.length > 0 ? next : undefined }));
  }

  function handleCondAdd(index: number) {
    const next = [...conditions];
    next.splice(index + 1, 0, { ...DEFAULT_CONDITION });
    handleConditionsChange(next);
  }

  function handleCondRemove(index: number) {
    let next = conditions.filter((_, j) => j !== index);
    if (next.length === 0) next = [{ ...DEFAULT_CONDITION }];
    handleConditionsChange(next);
  }

  function handleAsofByChange(next: ConditionEntry[]) {
    updateConfig((cfg) => ({
      ...cfg,
      asof: {
        ...((cfg.asof as Record<string, unknown>) ?? {}),
        by: next.length > 0 ? next : undefined,
      },
    }));
  }

  const conflictOptions = useMemo(
    () => [
      { value: 'right_prefix', label: tr('conflictPrefix', '右表字段加前缀') },
      { value: 'suffix', label: tr('conflictSuffix', '按表名加后缀') },
    ],
    [tr]
  );
  const conflictGroups = useMemo(
    () => [{ key: 'conflict', items: conflictOptions }],
    [conflictOptions]
  );

  return (
    <div className="grid content-start gap-2.5">
      {/* ═══ Big card: 1:1 two-column layout ═══ */}
      <div className="rounded-lg border border-border-muted bg-background/42">
        <div className="flex">
          {/* ── Left column (flex-1): only Step 1 ── */}
          <div className="flex-[4] border-r border-border-muted/50">
            {/* Data source section */}
            <div className="p-3 grid gap-2.5">
              <div className="flex items-end gap-3 px-0.5">
                <span className="h-8 w-8 rounded-full bg-accent/20 text-[14px] font-bold text-accent flex items-center justify-center leading-none">
                  1
                </span>
                <div className="grid">
                  <span className="text-[13px] font-semibold text-text-primary">
                    {tr('joinSourcesHeader', '数据源')}
                  </span>
                  <span className="text-[10px] text-text-muted">
                    {tr('joinSourcesHint', '选择连接类型与数据源')}
                  </span>
                </div>
              </div>

              <div className="flex gap-2">
                <div className="flex-1 flex items-center gap-2">
                  <span className="shrink-0 text-[11px] font-medium text-text-secondary">
                    {tr('leftInput', '左表数据源')}
                  </span>
                  <div className="flex-1 flex items-center rounded-md border border-border-muted/70 bg-background/28 px-2 h-7 min-w-0">
                    <span className="text-[12px] text-text-primary truncate">
                      {leftSourceLabel || tr('noLeftSource', '上游节点')}
                    </span>
                  </div>
                </div>
                <div className="flex-1 flex items-center gap-2">
                  <span className="shrink-0 text-[11px] font-medium text-text-secondary">
                    {tr('rightInput', '右表数据源')}
                  </span>
                  <div className="flex-1 flex items-center rounded-md border border-border-muted/70 bg-background/28 px-2 h-7 min-w-0">
                    <span className="text-[12px] text-text-primary truncate">
                      {rightSourceLabel || tr('noRightSource', '未连接右表')}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid gap-1 text-center">
                <span className="mb-1 block text-[12px] font-medium text-text-secondary">
                  {tr('joinType', '连接类型')}
                </span>
                <div className="grid grid-cols-4 gap-1">
                  {joinTypes.map((jt) => (
                    <button
                      key={jt.value}
                      type="button"
                      onClick={() => handleJoinTypeChange(jt.value)}
                      title={jt.tip}
                      className={`flex flex-col items-center gap-0.5 rounded-lg border py-1.5 px-0.5 transition-colors ${
                        joinType === jt.value
                          ? 'border-accent bg-accent/5'
                          : 'border-border-muted bg-background/28 hover:border-border-muted/80'
                      }`}
                    >
                      <JoinVennSVG type={jt.value} selected={joinType === jt.value} />
                      <span
                        className={`text-[10px] leading-tight ${joinType === jt.value ? 'text-accent font-medium' : 'text-text-muted'}`}
                      >
                        {jt.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── Right column (flex-[6]): Steps 2 + 3 stacked ── */}
          <div className="flex-[6] flex flex-col">
            {/* Step 2: Condition section */}
            <div className="p-3 grid gap-2">
              <div className="flex items-end gap-3 px-0.5">
                <span className="h-8 w-8 rounded-full bg-accent/20 text-[14px] font-bold text-accent flex items-center justify-center leading-none">
                  2
                </span>
                <div className="grid">
                  <span className="text-[13px] font-semibold text-text-primary">
                    {tr('joinConditionsHeader', '连接条件')}
                  </span>
                  <span className="text-[10px] text-text-muted">
                    {tr('joinConditionsHint', '配置字段匹配条件，多条条件之间为「且」关系')}
                  </span>
                </div>
              </div>

              {rightSourceLabel && rightColumnsError && !isAsof && (
                <div className="text-[11px] text-warning px-0.5">
                  {tr('rightColumnsFailed', '无法获取右表字段，请手动输入')}
                </div>
              )}

              {isAsof ? (
                <div className="grid gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <GlassFieldSingleSelect
                      value={asofLeftTime}
                      options={asofLeftTimeOptions}
                      columnTypes={leftColumnTypesQualified}
                      showType
                      onChange={(v) =>
                        updateConfig((cfg) => ({
                          ...cfg,
                          asof: {
                            ...((cfg.asof as Record<string, unknown>) ?? {}),
                            leftTime: v || undefined,
                          },
                        }))
                      }
                      placeholder={tr('leftTimeCol', '左表时间')}
                      className="h-7 w-0 flex-[1_1_0] min-w-[100px] text-[12px]"
                    />
                    <GlassOptionSingleSelect
                      value={asofOperator}
                      groups={[
                        {
                          key: 'op',
                          items: [
                            { value: '>=', label: tr('asofOpBackward', '之前最近') },
                            { value: '<=', label: tr('asofOpForward', '之后最近') },
                            { value: 'nearest', label: tr('asofOpNearest', '最接近') },
                          ],
                        },
                      ]}
                      onChange={(v) =>
                        updateConfig((cfg) => ({
                          ...cfg,
                          asof: { ...((cfg.asof as Record<string, unknown>) ?? {}), operator: v },
                        }))
                      }
                      className="h-7 w-[84px] shrink-0 text-[12px] [&>span]:text-center"
                    />
                    <GlassFieldSingleSelect
                      value={asofRightTime}
                      options={asofRightTimeOptions}
                      columnTypes={rightColumnTypesQualified}
                      showType
                      onChange={(v) =>
                        updateConfig((cfg) => ({
                          ...cfg,
                          asof: {
                            ...((cfg.asof as Record<string, unknown>) ?? {}),
                            rightTime: v || undefined,
                          },
                        }))
                      }
                      placeholder={tr('rightTimeCol', '右表时间')}
                      className="h-7 w-0 flex-[1_1_0] min-w-[100px] text-[12px]"
                    />
                    <GlassFormTextInput
                      value={(asof.tolerance as string) ?? ''}
                      onChange={(v) =>
                        updateConfig((cfg) => ({
                          ...cfg,
                          asof: {
                            ...((cfg.asof as Record<string, unknown>) ?? {}),
                            tolerance: v || undefined,
                          },
                        }))
                      }
                      placeholder={tr('tolerance', '时间差')}
                      className="h-7 text-[13px] w-[72px] shrink-0"
                    />
                    <GlassOptionSingleSelect
                      value={(asof.direction as string) ?? ''}
                      groups={[
                        {
                          key: 'dir',
                          items: [
                            { value: '', label: tr('directionDefault', '默认') },
                            { value: 'backward', label: tr('directionBackward', '向后') },
                            { value: 'forward', label: tr('directionForward', '向前') },
                            { value: 'nearest', label: tr('directionNearest', '最接近') },
                          ],
                        },
                      ]}
                      onChange={(v) =>
                        updateConfig((cfg) => ({
                          ...cfg,
                          asof: {
                            ...((cfg.asof as Record<string, unknown>) ?? {}),
                            direction: v || undefined,
                          },
                        }))
                      }
                      className="h-7 w-[68px] shrink-0 text-[12px] [&>span]:text-center"
                    />
                  </div>
                  <div className="max-h-[180px] overflow-y-auto">
                    <div className="space-y-1">
                      {(() => {
                        const asofBy = (asof.by as ConditionEntry[]) ?? [];
                        const isEmpty = asofBy.length === 0;
                        const display = isEmpty ? [asofPending] : asofBy;
                        return display.map((cond, i) =>
                          renderConditionRow(
                            cond,
                            i,
                            isEmpty,
                            asofPending,
                            setAsofPending,
                            handleAsofByChange,
                            tr('leftField', '[左表字段]'),
                            tr('rightField', '[右表字段]')
                          )
                        );
                      })()}
                    </div>
                  </div>
                </div>
              ) : needsConditions ? (
                <div className="max-h-[280px] overflow-y-auto">
                  <GlassRowList
                    items={conditions}
                    columns={[
                      {
                        flex: 'flex-[1]',
                        header: '',
                        render: (cond: ConditionEntry, i: number) => (
                          <GlassFieldSingleSelect
                            value={cond.left}
                            options={leftFieldCompletions}
                            onChange={(v) =>
                              handleConditionsChange(
                                conditions.map((c, j) => (j === i ? { ...c, left: v } : c))
                              )
                            }
                            placeholder={tr('leftField', '[左表字段]')}
                            className="h-7 w-full text-[12px]"
                          />
                        ),
                      },
                      {
                        flex: 'flex-[0.6]',
                        header: '',
                        render: (cond: ConditionEntry, i: number) => (
                          <GlassOptionSingleSelect
                            value={cond.operator}
                            groups={[{ key: 'op', items: conditionOperatorItems }]}
                            onChange={(v) =>
                              handleConditionsChange(
                                conditions.map((c, j) => (j === i ? { ...c, operator: v } : c))
                              )
                            }
                            className="h-7 w-full text-[12px] [&>span]:text-center"
                          />
                        ),
                      },
                      {
                        flex: 'flex-[1]',
                        header: '',
                        render: (cond: ConditionEntry, i: number) => (
                          <GlassFieldSingleSelect
                            value={cond.right}
                            options={rightFieldCompletions}
                            onChange={(v) =>
                              handleConditionsChange(
                                conditions.map((c, j) => (j === i ? { ...c, right: v } : c))
                              )
                            }
                            placeholder={tr('rightField', '[右表字段]')}
                            className="h-7 w-full text-[12px]"
                          />
                        ),
                      },
                    ]}
                    onAdd={handleCondAdd}
                    onRemove={handleCondRemove}
                    addTitle={tr('addCondition', '添加条件')}
                    canAct={(action: RowAction) =>
                      action === 'add' ? !conditions.some((c) => !c.left && !c.right) : true
                    }
                    hideHeader
                  />
                </div>
              ) : (
                <div className="text-[12px] text-text-secondary px-0.5">
                  {tr('noConditionsNeeded', '无需连接条件')}
                </div>
              )}
            </div>

            {/* ── Separator ── */}
            <div className="border-t border-border-muted/50" />

            {/* Step 3: Config section */}
            <div className="p-3 grid gap-3 content-start">
              <div className="flex items-end gap-3 px-0.5">
                <span className="h-8 w-8 rounded-full bg-accent/20 text-[14px] font-bold text-accent flex items-center justify-center leading-none">
                  3
                </span>
                <div className="grid">
                  <span className="text-[13px] font-semibold text-text-primary">
                    {tr('joinConfigHeader', '配置')}
                  </span>
                  <span className="text-[10px] text-text-muted">
                    {tr('joinConfigHint', '配置保留字段、基数与冲突规则')}
                  </span>
                </div>
              </div>

              {/* Keep fields */}
              <div className="flex gap-4 px-0.5">
                <div className="flex-1 flex items-center justify-between">
                  <span className="text-[12px] text-text-primary">
                    {tr('keepFieldStatsLeft', '左表保留/重命名/全字段数')}
                  </span>
                  <div className="flex items-center gap-1">
                    <span className="text-[12px] text-text-muted tabular-nums">
                      {leftKeepCount}/{leftRenameCount}/{fieldCompletions.length}
                    </span>
                    <button
                      type="button"
                      onClick={openKeepDialog}
                      className="flex h-6 w-6 items-center justify-center rounded text-text-muted/50 hover:text-accent transition-colors"
                      title={tr('adjustKeepFields', '调整选择')}
                    >
                      <Settings className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="flex-1 flex items-center justify-between">
                  <span className="text-[12px] text-text-primary">
                    {tr('keepFieldStatsRight', '右表保留/重命名/全字段数')}
                  </span>
                  <div className="flex items-center gap-1">
                    <span className="text-[12px] text-text-muted tabular-nums">
                      {rightKeepCount}/{rightRenameCount}/{rightRawColumns.length}
                    </span>
                    <button
                      type="button"
                      onClick={openKeepDialog}
                      className="flex h-6 w-6 items-center justify-center rounded text-text-muted/50 hover:text-accent transition-colors"
                      title={tr('adjustKeepFields', '调整选择')}
                    >
                      <Settings className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Conflict */}
              <div className="flex items-center gap-2 px-0.5">
                <span className="shrink-0 text-[11px] font-medium text-text-secondary">
                  {tr('conflict', '同名字段冲突')}
                </span>
                <GlassOptionSingleSelect
                  value={conflictStrategy}
                  groups={conflictGroups}
                  onChange={(v) =>
                    updateConfig((cfg) => ({
                      ...cfg,
                      conflict: {
                        ...((cfg.conflict as Record<string, unknown>) ?? {}),
                        strategy: v,
                      },
                    }))
                  }
                  className="h-7 text-[12px] [&>span]:text-left flex-1 min-w-0"
                />
                <GlassFormTextInput
                  value={rightPrefix}
                  onChange={(v) =>
                    updateConfig((cfg) => ({
                      ...cfg,
                      conflict: {
                        ...((cfg.conflict as Record<string, unknown>) ?? {}),
                        rightPrefix: v || undefined,
                      },
                    }))
                  }
                  placeholder={tr('prefix', '前缀，如 customers_')}
                  className={`h-7 text-[13px] flex-1 min-w-0 ${conflictStrategy !== 'right_prefix' ? 'invisible' : ''}`}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Keep field dialog ═══ */}
      {keepDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/28 px-4 py-6"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) cancelKeep();
          }}
        >
          <div className="flex max-h-full w-[680px] flex-col rounded-xl border border-border-subtle bg-[var(--glass-card-strong)] shadow-card backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-border-muted/50 px-4 py-3">
              <h3 className="text-[13px] font-semibold text-text-primary">
                {tr('selectKeepFields', '选择保留字段')}
              </h3>
            </div>
            <div className="flex gap-4 overflow-y-auto p-4">
              {/* Left table fields */}
              <div className="flex-1 border-r border-border-muted/50 pr-4">
                <h4 className="mb-1 text-[12px] font-medium text-text-secondary">
                  {leftSourceLabel || tr('leftInput', '左表')}
                </h4>
                <p className="mb-2 text-[10px] text-text-muted">勾选字段后可输入别名</p>
                <label className="flex cursor-pointer items-center gap-1.5 mb-1.5 text-[12px] text-text-secondary font-medium">
                  <input
                    type="checkbox"
                    checked={draftLeftAllChecked}
                    onChange={toggleDraftLeftAll}
                    className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
                  />
                  {tr('selectAllFields', '全部')}
                </label>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {fieldCompletions.map((f) => {
                    const qualified = `[${leftAlias}].[${f}]`;
                    const isChecked = draftLeftSel.has(qualified);
                    const alias = draftLeftAliases.get(qualified) ?? '';
                    return (
                      <div
                        key={f}
                        className="flex items-center gap-1.5 text-[12px] text-text-primary"
                      >
                        <label className="flex cursor-pointer items-center gap-1.5 flex-1 min-w-0">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleDraftLeftField(qualified)}
                            className="h-3.5 w-3.5 shrink-0 rounded border-border-muted accent-accent"
                          />
                          <span className="truncate">{f}</span>
                        </label>
                        {isChecked && (
                          <input
                            type="text"
                            value={alias}
                            onChange={(e) => updateLeftAlias(qualified, e.target.value)}
                            placeholder={f}
                            className="h-5 w-28 shrink-0 rounded border border-border-muted/50 bg-background/30 px-1.5 text-[11px] text-text-primary outline-none focus:border-accent placeholder:text-text-muted/50"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* Right table fields */}
              <div className="flex-1 pl-4">
                <h4 className="mb-1 text-[12px] font-medium text-text-secondary">
                  {rightSourceLabel || tr('rightInput', '右表')}
                </h4>
                <p className="mb-2 text-[10px] text-text-muted">勾选字段后可输入别名</p>
                <label className="flex cursor-pointer items-center gap-1.5 mb-1.5 text-[12px] text-text-secondary font-medium">
                  <input
                    type="checkbox"
                    checked={draftRightAllChecked}
                    onChange={toggleDraftRightAll}
                    className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
                  />
                  {tr('selectAllFields', '全部')}
                </label>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {rightRawColumns.map((f) => {
                    const qualified = `[${rightAlias}].[${f}]`;
                    const isChecked = draftRightSel.has(qualified);
                    const alias = draftRightAliases.get(qualified) ?? '';
                    return (
                      <div
                        key={f}
                        className="flex items-center gap-1.5 text-[12px] text-text-primary"
                      >
                        <label className="flex cursor-pointer items-center gap-1.5 flex-1 min-w-0">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleDraftRightField(qualified)}
                            className="h-3.5 w-3.5 shrink-0 rounded border-border-muted accent-accent"
                          />
                          <span className="truncate">{f}</span>
                        </label>
                        {isChecked && (
                          <input
                            type="text"
                            value={alias}
                            onChange={(e) => updateRightAlias(qualified, e.target.value)}
                            placeholder={f}
                            className="h-5 w-28 shrink-0 rounded border border-border-muted/50 bg-background/30 px-1.5 text-[11px] text-text-primary outline-none focus:border-accent placeholder:text-text-muted/50"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border-muted/50 px-4 py-3">
              <button
                type="button"
                onClick={cancelKeep}
                className="rounded-md border border-border-muted bg-background/42 px-3 py-1 text-[12px] text-text-secondary hover:border-accent/30 hover:text-accent transition-colors"
              >
                {tr('cancel', '取消')}
              </button>
              <button
                type="button"
                onClick={confirmKeep}
                className="rounded-md bg-accent px-3 py-1 text-[12px] text-white hover:bg-accent/90 transition-colors"
              >
                {tr('confirm', '确定')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
