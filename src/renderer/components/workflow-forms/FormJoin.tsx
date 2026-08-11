import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Plus, Settings, Trash2 } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import { GlassRowList, type RowAction } from './shared/GlassRowList';
import { toggleSelectAll } from './shared/join-dialog';
import { isTemporalDataFieldType } from '@/shared/data-field-types';
import { parseFieldRef } from '@/shared/prep-dsl/parser';
import { parseDuration, normalizeDuration } from '@/shared/operator-schemas/join';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';

export interface ConditionEntry {
  left: string;
  operator: string;
  right: string;
}

const DEFAULT_CONDITION: ConditionEntry = { left: '', operator: '=', right: '' };

const OPERATOR_KEYS = [
  { value: '=', key: 'operatorEq' },
  { value: '<', key: 'operatorLt' },
  { value: '<=', key: 'operatorLte' },
  { value: '>', key: 'operatorGt' },
  { value: '>=', key: 'operatorGte' },
];

function isLeftField(source: string, leftAlias: string): boolean {
  const ref = parseFieldRef(source);
  if (ref?.source) return ref.source.toLowerCase() === leftAlias.toLowerCase();
  return source.toLowerCase().startsWith(`${leftAlias}.`.toLowerCase());
}

function isRightField(source: string, rightAlias: string): boolean {
  const ref = parseFieldRef(source);
  if (ref?.source) return ref.source.toLowerCase() === rightAlias.toLowerCase();
  return source.toLowerCase().startsWith(`${rightAlias}.`.toLowerCase());
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
  const tr = useFormTranslation();
  const updateConfig = useUpdateConfig(onNodeChange);

  // Initialize default conflict config (only for non-semi/anti joins)
  useEffect(() => {
    const jt = (node.config.joinType as string) ?? 'left';
    if (jt !== 'semi' && jt !== 'anti' && !node.config.conflict) {
      updateConfig((cfg) => ({
        ...cfg,
        conflict: { strategy: 'suffix', leftSuffix: '_left', rightSuffix: '_right' },
      }));
    }
  }, []);

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
  const rightPrefix = useMemo(() => {
    const raw = (conflict.rightPrefix as string) ?? '';
    return conflictStrategy === 'right_prefix' ? raw || 'right_' : raw;
  }, [conflict, conflictStrategy]);
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
  const isSemiAnti = joinType === 'semi' || joinType === 'anti';

  const toleranceVal = (asof.tolerance as string) ?? '';
  const durationParts = useMemo(() => parseDuration(toleranceVal), [toleranceVal]);
  const showToleranceError = asofOperator === 'nearest' && !toleranceVal;

  function handleDurationChange(part: keyof ReturnType<typeof parseDuration>, val: number) {
    const next = { ...durationParts, [part]: val };
    const totalMs =
      next.d * 86_400_000 + next.h * 3_600_000 + next.m * 60_000 + next.s * 1_000 + next.ms;
    const str = normalizeDuration(String(totalMs));
    updateConfig((cfg) => ({
      ...cfg,
      asof: {
        ...((cfg.asof as Record<string, unknown>) ?? {}),
        tolerance: str || undefined,
      },
    }));
  }

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
        label: tr('joinInner'),
        tip: tr('joinInnerTip'),
      },
      {
        value: 'left',
        label: tr('joinLeft'),
        tip: tr('joinLeftTip'),
      },
      {
        value: 'right',
        label: tr('joinRight'),
        tip: tr('joinRightTip'),
      },
      {
        value: 'full',
        label: tr('joinFull'),
        tip: tr('joinFullTip'),
      },
      {
        value: 'cross',
        label: tr('joinCross'),
        tip: tr('joinCrossTip'),
      },
      {
        value: 'semi',
        label: tr('joinSemi'),
        tip: tr('joinSemiTip'),
      },
      {
        value: 'anti',
        label: tr('joinAnti'),
        tip: tr('joinAntiTip'),
      },
      {
        value: 'asof',
        label: tr('joinAsof'),
        tip: tr('joinAsofTip'),
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

  async function handleJoinTypeChange(value: string) {
    updateConfig((cfg) => ({
      ...cfg,
      joinType: value,
      conditions: value === 'cross' ? undefined : cfg.conditions,
      asof: value === 'asof' ? (cfg.asof ?? {}) : undefined,
      keep: value === 'semi' || value === 'anti' ? undefined : cfg.keep,
      conflict:
        value === 'semi' || value === 'anti'
          ? undefined
          : (cfg.conflict ?? { strategy: 'suffix', leftSuffix: '_left', rightSuffix: '_right' }),
    }));
  }

  function handleKeepChange(items: Array<Record<string, unknown>>) {
    updateConfig((cfg) => ({ ...cfg, keep: items.length > 0 ? items : undefined }));
  }

  // ── Keep field modal state ──
  const [keepDialogOpen, setKeepDialogOpen] = useState(false);
  const [draftLeftWildcard, setDraftLeftWildcard] = useState(false);
  const [draftRightWildcard, setDraftRightWildcard] = useState(false);
  const [draftLeftSel, setDraftLeftSel] = useState(new Set<string>());
  const [draftRightSel, setDraftRightSel] = useState(new Set<string>());
  const [draftLeftAliases, setDraftLeftAliases] = useState(new Map<string, string>());
  const [draftRightAliases, setDraftRightAliases] = useState(new Map<string, string>());

  function openKeepDialog() {
    const hasLeftWildcard = keepItems.some((i) => i.side === 'left' && i.wildcard);
    const hasRightWildcard = keepItems.some((i) => i.side === 'right' && i.wildcard);
    const isEmpty = keepItems.length === 0;

    setDraftLeftWildcard(hasLeftWildcard || isEmpty);
    setDraftRightWildcard(hasRightWildcard || isEmpty);

    const leftSel = new Set<string>();
    const rightSel = new Set<string>();
    const leftAliases = new Map<string, string>();
    const rightAliases = new Map<string, string>();

    if (isEmpty) {
      fieldCompletions.forEach((f) => leftSel.add(`[${leftAlias}].[${f}]`));
      rightRawColumns.forEach((f) => rightSel.add(`[${rightAlias}].[${f}]`));
    } else {
      for (const item of keepItems) {
        if (item.wildcard) {
          if (item.side === 'left') {
            fieldCompletions.forEach((f) => leftSel.add(`[${leftAlias}].[${f}]`));
          } else if (item.side === 'right') {
            rightRawColumns.forEach((f) => rightSel.add(`[${rightAlias}].[${f}]`));
          }
          continue;
        }
        if (typeof item.source !== 'string') continue;
        const isLeft =
          typeof item.side === 'string'
            ? item.side === 'left'
            : isLeftField(item.source, leftAlias);
        const isRight =
          typeof item.side === 'string'
            ? item.side === 'right'
            : isRightField(item.source, rightAlias);
        if (isLeft) {
          leftSel.add(item.source);
          if (typeof item.alias === 'string') leftAliases.set(item.source, item.alias);
        } else if (isRight) {
          rightSel.add(item.source);
          if (typeof item.alias === 'string') rightAliases.set(item.source, item.alias);
        }
      }
    }

    setDraftLeftSel(leftSel);
    setDraftRightSel(rightSel);
    setDraftLeftAliases(leftAliases);
    setDraftRightAliases(rightAliases);
    setKeepDialogOpen(true);
  }

  function confirmKeep() {
    const items: Array<Record<string, unknown>> = [];
    const emitSide = (
      side: 'left' | 'right',
      sel: Set<string>,
      aliases: Map<string, string>,
      wildcard: boolean,
      total: number
    ) => {
      if (wildcard && sel.size === total) {
        items.push({ side, wildcard: true });
        return;
      }
      for (const f of sel) {
        const alias = aliases.get(f);
        items.push({ side, source: f, ...(alias ? { alias } : {}) });
      }
    };
    emitSide('left', draftLeftSel, draftLeftAliases, draftLeftWildcard, fieldCompletions.length);
    emitSide('right', draftRightSel, draftRightAliases, draftRightWildcard, rightRawColumns.length);
    handleKeepChange(items);
    setKeepDialogOpen(false);
  }

  function cancelKeep() {
    setKeepDialogOpen(false);
  }

  function toggleDraftLeftField(field: string) {
    setDraftLeftWildcard(false);
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
    setDraftRightWildcard(false);
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
    setDraftLeftWildcard(false);
    const allFields = fieldCompletions.map((f) => `[${leftAlias}].[${f}]`);
    setDraftLeftSel((prev) => toggleSelectAll(prev, allFields));
  }

  function toggleDraftRightAll() {
    setDraftRightWildcard(false);
    const allFields = rightRawColumns.map((f) => `[${rightAlias}].[${f}]`);
    setDraftRightSel((prev) => toggleSelectAll(prev, allFields));
  }

  function updateLeftAlias(field: string, alias: string) {
    setDraftLeftWildcard(false);
    setDraftLeftAliases((prev) => {
      const next = new Map(prev);
      if (alias) next.set(field, alias);
      else next.delete(field);
      return next;
    });
  }

  function updateRightAlias(field: string, alias: string) {
    setDraftRightWildcard(false);
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
    if (wildcardItem || keepItems.length === 0) return fieldCompletions.length;
    return keepItems.filter(
      (i) =>
        !i.wildcard &&
        (typeof i.side === 'string'
          ? i.side === 'left'
          : isLeftField(String(i.source ?? ''), leftAlias))
    ).length;
  }, [keepItems, fieldCompletions, leftAlias]);
  const rightKeepCount = useMemo(() => {
    const wildcardItem = keepItems.find((i) => i.side === 'right' && i.wildcard);
    if (wildcardItem || keepItems.length === 0) return rightRawColumns.length;
    return keepItems.filter(
      (i) =>
        !i.wildcard &&
        (typeof i.side === 'string'
          ? i.side === 'right'
          : isRightField(String(i.source ?? ''), rightAlias))
    ).length;
  }, [keepItems, rightRawColumns, rightAlias]);

  const leftRenameCount = useMemo(() => {
    return keepItems.filter(
      (i) =>
        !i.wildcard &&
        (typeof i.side === 'string'
          ? i.side === 'left'
          : isLeftField(String(i.source ?? ''), leftAlias)) &&
        typeof i.alias === 'string' &&
        i.alias
    ).length;
  }, [keepItems, leftAlias]);

  const rightRenameCount = useMemo(() => {
    return keepItems.filter(
      (i) =>
        !i.wildcard &&
        (typeof i.side === 'string'
          ? i.side === 'right'
          : isRightField(String(i.source ?? ''), rightAlias)) &&
        typeof i.alias === 'string' &&
        i.alias
    ).length;
  }, [keepItems, rightAlias]);

  // ── Inline condition handlers ──
  const [asofPending, setAsofPending] = useState<ConditionEntry>({ ...DEFAULT_CONDITION });

  const conditionOperatorItems = useMemo(
    () => OPERATOR_KEYS.map((op) => ({ value: op.value, label: tr(op.key) })),
    [tr]
  );

  function condHandleChange(
    isEmpty: boolean,
    pending: ConditionEntry,
    setPending: (v: ConditionEntry) => void,
    onChange: (next: ConditionEntry[]) => void,
    index: number,
    sourceConditions: ConditionEntry[],
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
      onChange(sourceConditions.map((c, i) => (i === index ? { ...c, ...patch } : c)));
    }
  }

  function condHandleRemove(
    isEmpty: boolean,
    setPending: (v: ConditionEntry) => void,
    onChange: (next: ConditionEntry[]) => void,
    index: number,
    sourceConditions: ConditionEntry[]
  ) {
    if (isEmpty) {
      setPending({ ...DEFAULT_CONDITION });
    } else {
      onChange(sourceConditions.filter((_, i) => i !== index));
    }
  }

  function condHandleAdd(
    isEmpty: boolean,
    pending: ConditionEntry,
    setPending: (v: ConditionEntry) => void,
    onChange: (next: ConditionEntry[]) => void,
    index: number,
    sourceConditions: ConditionEntry[]
  ) {
    if (isEmpty) {
      if (!pending.left && !pending.right) return;
      onChange([pending, { ...DEFAULT_CONDITION }]);
      setPending({ ...DEFAULT_CONDITION });
    } else {
      const next = [...sourceConditions];
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
    sourceConditions: ConditionEntry[],
    leftLabel: string,
    rightLabel: string,
    hideOperator?: boolean
  ) {
    return (
      <div key={i} className="flex items-center gap-1">
        <GlassFieldSingleSelect
          value={cond.left}
          options={leftFieldCompletions}
          onChange={(v) =>
            condHandleChange(isEmpty, pending, setPending, onChange, i, sourceConditions, {
              left: v,
            })
          }
          placeholder={leftLabel}
          className="h-7 w-0 flex-[1_1_0] min-w-[100px] text-[12px]"
        />
        {hideOperator ? (
          <span className="flex h-7 w-[72px] shrink-0 items-center justify-center text-[12px] text-text-secondary [&>span]:text-center">
            {tr('operatorEq')}
          </span>
        ) : (
          <GlassOptionSingleSelect
            value={cond.operator}
            groups={[{ key: 'op', items: conditionOperatorItems }]}
            onChange={(v) =>
              condHandleChange(isEmpty, pending, setPending, onChange, i, sourceConditions, {
                operator: v,
              })
            }
            className="h-7 w-[72px] shrink-0 text-[12px] [&>span]:text-center"
          />
        )}
        <GlassFieldSingleSelect
          value={cond.right}
          options={rightFieldCompletions}
          onChange={(v) =>
            condHandleChange(isEmpty, pending, setPending, onChange, i, sourceConditions, {
              right: v,
            })
          }
          placeholder={rightLabel}
          className="h-7 w-0 flex-[1_1_0] min-w-[100px] text-[12px]"
        />
        <button
          type="button"
          onClick={() => condHandleAdd(isEmpty, pending, setPending, onChange, i, sourceConditions)}
          className="h-6 w-6 flex shrink-0 items-center justify-center rounded text-text-muted/40 hover:text-accent transition-colors"
          title={tr('addCondition')}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => condHandleRemove(isEmpty, setPending, onChange, i, sourceConditions)}
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
    const next = conditions.filter((_, j) => j !== index);
    if (next.length === 0 || next.every((c) => !c.left && !c.right)) {
      handleConditionsChange([]);
    } else {
      handleConditionsChange(next);
    }
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
      { value: 'right_prefix', label: tr('conflictPrefix') },
      { value: 'suffix', label: tr('conflictSuffix') },
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
                    {tr('joinSourcesHeader')}
                  </span>
                  <span className="text-[10px] text-text-muted">{tr('joinSourcesHint')}</span>
                </div>
              </div>

              <div className="flex gap-2">
                <div className="flex-1 flex items-center gap-2">
                  <span className="shrink-0 text-[11px] font-medium text-text-secondary">
                    {tr('leftInput')}
                  </span>
                  <div className="flex-1 flex items-center rounded-md border border-border-muted/70 bg-background/28 px-2 h-7 min-w-0">
                    <span className="text-[12px] text-text-primary truncate">
                      {leftSourceLabel || tr('noLeftSource')}
                    </span>
                  </div>
                </div>
                <div className="flex-1 flex items-center gap-2">
                  <span className="shrink-0 text-[11px] font-medium text-text-secondary">
                    {tr('rightInput')}
                  </span>
                  <div className="flex-1 flex items-center rounded-md border border-border-muted/70 bg-background/28 px-2 h-7 min-w-0">
                    <span className="text-[12px] text-text-primary truncate">
                      {rightSourceLabel || tr('noRightSource')}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid gap-1 text-center">
                <span className="mb-1 block text-[12px] font-medium text-text-secondary">
                  {tr('joinType')}
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
                    {tr('joinConditionsHeader')}
                  </span>
                  <span className="text-[10px] text-text-muted">{tr('joinConditionsHint')}</span>
                </div>
              </div>

              {rightSourceLabel && rightColumnsError && !isAsof && (
                <div className="text-[11px] text-warning px-0.5">{tr('rightColumnsFailed')}</div>
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
                      placeholder={tr('leftTimeCol')}
                      className="h-7 w-0 flex-[1_1_0] min-w-[100px] text-[12px]"
                    />
                    <GlassOptionSingleSelect
                      value={asofOperator}
                      groups={[
                        {
                          key: 'op',
                          items: [
                            { value: '>=', label: tr('asofOpBackward') },
                            { value: '<=', label: tr('asofOpForward') },
                            { value: 'nearest', label: tr('asofOpNearest') },
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
                      placeholder={tr('rightTimeCol')}
                      className="h-7 w-0 flex-[1_1_0] min-w-[100px] text-[12px]"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    {(
                      [
                        { key: 'd', label: tr('toleranceDay'), max: 365 },
                        { key: 'h', label: tr('toleranceHour'), max: 23 },
                        { key: 'm', label: tr('toleranceMin'), max: 59 },
                        { key: 's', label: tr('toleranceSec'), max: 59 },
                        { key: 'ms', label: tr('toleranceMs'), max: 999 },
                      ] as const
                    ).map(({ key, label, max }) => (
                      <div key={key} className="flex items-center gap-0.5">
                        <GlassFormTextInput
                          type="number"
                          min={0}
                          max={max}
                          value={String(durationParts[key])}
                          onChange={(v) => {
                            const n = parseInt(v, 10);
                            handleDurationChange(key, Number.isNaN(n) ? 0 : Math.max(0, n));
                          }}
                          textCenter
                          className={`h-7 w-[46px] !px-1.5 text-[12px] ${showToleranceError ? 'border-error ring-error/20 ring-2' : ''}`}
                        />
                        <span className="text-[10px] text-text-muted w-[28px]">{label}</span>
                      </div>
                    ))}
                  </div>
                  {showToleranceError && (
                    <div className="text-[11px] text-warning px-0.5">{tr('toleranceRequired')}</div>
                  )}
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
                            asofBy,
                            tr('leftField'),
                            tr('rightField'),
                            true
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
                            placeholder={tr('leftField')}
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
                            placeholder={tr('rightField')}
                            className="h-7 w-full text-[12px]"
                          />
                        ),
                      },
                    ]}
                    onAdd={handleCondAdd}
                    onRemove={handleCondRemove}
                    addTitle={tr('addCondition')}
                    canAct={(action: RowAction) =>
                      action === 'add' ? !conditions.some((c) => !c.left && !c.right) : true
                    }
                    hideHeader
                  />
                </div>
              ) : (
                <div className="text-[12px] text-text-secondary px-0.5">
                  {tr('noConditionsNeeded')}
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
                    {tr('joinConfigHeader')}
                  </span>
                  <span className="text-[10px] text-text-muted">{tr('joinConfigHint')}</span>
                </div>
              </div>

              {/* Keep fields */}
              {!isSemiAnti && (
                <div className="flex gap-4 px-0.5">
                  <div className="flex-1 flex items-center justify-between">
                    <span className="text-[12px] text-text-primary">
                      {tr('keepFieldStatsLeft')}
                    </span>
                    <div className="flex items-center gap-1">
                      <span className="text-[12px] text-text-muted tabular-nums">
                        {leftKeepCount}/{leftRenameCount}/{fieldCompletions.length}
                      </span>
                      <button
                        type="button"
                        onClick={openKeepDialog}
                        className="flex h-6 w-6 items-center justify-center rounded text-text-muted/50 hover:text-accent transition-colors"
                        title={tr('adjustKeepFields')}
                      >
                        <Settings className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 flex items-center justify-between">
                    <span className="text-[12px] text-text-primary">
                      {tr('keepFieldStatsRight')}
                    </span>
                    <div className="flex items-center gap-1">
                      <span className="text-[12px] text-text-muted tabular-nums">
                        {rightKeepCount}/{rightRenameCount}/{rightRawColumns.length}
                      </span>
                      <button
                        type="button"
                        onClick={openKeepDialog}
                        className="flex h-6 w-6 items-center justify-center rounded text-text-muted/50 hover:text-accent transition-colors"
                        title={tr('adjustKeepFields')}
                      >
                        <Settings className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Conflict */}
              {!isSemiAnti && (
                <div className="flex items-center gap-2 px-0.5">
                  <span className="shrink-0 text-[11px] font-medium text-text-secondary">
                    {tr('conflict')}
                  </span>
                  <GlassOptionSingleSelect
                    value={conflictStrategy}
                    groups={conflictGroups}
                    onChange={(v) =>
                      updateConfig((cfg) => {
                        const current = (cfg.conflict as Record<string, unknown>) ?? {};
                        return {
                          ...cfg,
                          conflict: {
                            ...current,
                            strategy: v,
                            ...(v === 'right_prefix' && !current.rightPrefix
                              ? { rightPrefix: 'right_' }
                              : {}),
                          },
                        };
                      })
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
                          rightPrefix: v.trim() || 'right_',
                        },
                      }))
                    }
                    placeholder={tr('prefix')}
                    className={`h-7 text-[13px] flex-1 min-w-0 ${conflictStrategy !== 'right_prefix' ? 'invisible' : ''}`}
                  />
                </div>
              )}

              {/* Semi/Anti: no extra config needed */}
              {isSemiAnti && (
                <div className="px-0.5 text-[12px] text-text-muted">
                  {tr('semiAntiConfigHint', {
                    model: joinType === 'semi' ? tr('joinSemi') : tr('joinAnti'),
                  })}
                </div>
              )}
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
                {tr('selectKeepFields')}
              </h3>
            </div>
            <div className="flex gap-4 overflow-y-auto p-4">
              {/* Left table fields */}
              <div className="flex-1 border-r border-border-muted/50 pr-4">
                <h4 className="mb-1 text-[12px] font-medium text-text-secondary">
                  {leftSourceLabel || tr('leftInput')}
                </h4>
                <p className="mb-2 text-[10px] text-text-muted">{tr('joinKeepAliasPrompt')}</p>
                <label className="flex cursor-pointer items-center gap-1.5 mb-1.5 text-[12px] text-text-secondary font-medium">
                  <input
                    type="checkbox"
                    checked={draftLeftAllChecked}
                    onChange={toggleDraftLeftAll}
                    className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
                  />
                  {tr('selectAllFields')}
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
                  {rightSourceLabel || tr('rightInput')}
                </h4>
                <p className="mb-2 text-[10px] text-text-muted">{tr('joinKeepAliasPrompt')}</p>
                <label className="flex cursor-pointer items-center gap-1.5 mb-1.5 text-[12px] text-text-secondary font-medium">
                  <input
                    type="checkbox"
                    checked={draftRightAllChecked}
                    onChange={toggleDraftRightAll}
                    className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
                  />
                  {tr('selectAllFields')}
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
                {tr('cancel')}
              </button>
              <button
                type="button"
                onClick={confirmKeep}
                className="rounded-md bg-accent px-3 py-1 text-[12px] text-white hover:bg-accent/90 transition-colors"
              >
                {tr('confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
