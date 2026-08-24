import { useEffect, useId, useMemo, useState } from 'react';
import { Settings } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import { GlassRowList, type RowAction } from './shared/GlassRowList';
import { toggleSelectAll } from '../../../shared/collections/selection';
import { isTemporalDataFieldType } from '@/shared/data-field-types';
import { parseDuration } from '@/shared/operator-schemas/join';
import type { DurationParts, JoinCondition, KeepItem } from '@/shared/operator-schemas';
import {
  createJoinKeepDraft,
  qualifyJoinField,
  serializeJoinKeepDraft,
  summarizeJoinKeep,
  updateJoinDurationPart,
} from '@/shared/operator-config';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';

export type ConditionEntry = JoinCondition;

const DEFAULT_CONDITION: ConditionEntry = { left: '', operator: '=', right: '' };
const DEFAULT_JOIN_CONFLICT = {
  strategy: 'suffix',
  leftSuffix: '_left',
  rightSuffix: '_right',
} as const;

const OPERATOR_KEYS = [
  { value: '=', key: 'operatorEq' },
  { value: '<', key: 'operatorLt' },
  { value: '<=', key: 'operatorLte' },
  { value: '>', key: 'operatorGt' },
  { value: '>=', key: 'operatorGte' },
];

function insertCondition(conditions: ConditionEntry[], index: number): ConditionEntry[] {
  const next = [...conditions];
  next.splice(index + 1, 0, { ...DEFAULT_CONDITION });
  return next;
}

function removeCondition(conditions: ConditionEntry[], index: number): ConditionEntry[] {
  const next = conditions.filter((_, conditionIndex) => conditionIndex !== index);
  return next.length === 0 || next.every((condition) => !condition.left && !condition.right)
    ? []
    : next;
}

// Shared geometry keeps the selected regions comparable across join types.
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

interface JoinKeepFieldColumnProps {
  side: 'left' | 'right';
  title: string;
  fields: string[];
  alias: string;
  selected: ReadonlySet<string>;
  aliases: ReadonlyMap<string, string>;
  allChecked: boolean;
  onToggleAll: () => void;
  onToggleField: (field: string) => void;
  onAliasChange: (field: string, alias: string) => void;
}

function JoinKeepFieldColumn({
  side,
  title,
  fields,
  alias,
  selected,
  aliases,
  allChecked,
  onToggleAll,
  onToggleField,
  onAliasChange,
}: JoinKeepFieldColumnProps) {
  const tr = useFormTranslation();

  return (
    <div
      className={side === 'left' ? 'flex-1 border-r border-border-muted/50 pr-4' : 'flex-1 pl-4'}
    >
      <h4 className="mb-1 text-[12px] font-medium text-text-secondary">{title}</h4>
      <p className="mb-2 text-[10px] text-text-muted">{tr('joinKeepAliasPrompt')}</p>
      <label className="mb-1.5 flex cursor-pointer items-center gap-1.5 text-[12px] font-medium text-text-secondary">
        <input
          type="checkbox"
          checked={allChecked}
          onChange={onToggleAll}
          className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
        />
        {tr('selectAllFields')}
      </label>
      <div className="max-h-48 space-y-1 overflow-y-auto">
        {fields.map((field) => {
          const qualifiedField = qualifyJoinField(alias, field);
          const isChecked = selected.has(qualifiedField);
          const fieldAlias = aliases.get(qualifiedField) ?? '';
          return (
            <div key={field} className="flex items-center gap-1.5 text-[12px] text-text-primary">
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => onToggleField(qualifiedField)}
                  className="h-3.5 w-3.5 shrink-0 rounded border-border-muted accent-accent"
                />
                <span className="truncate">{field}</span>
              </label>
              {isChecked && (
                <input
                  type="text"
                  value={fieldAlias}
                  onChange={(event) => onAliasChange(qualifiedField, event.target.value)}
                  placeholder={field}
                  className="h-5 w-28 shrink-0 rounded border border-border-muted/50 bg-background/30 px-1.5 text-[11px] text-text-primary outline-none placeholder:text-text-muted/50 focus:border-accent"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
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
        conflict: { ...DEFAULT_JOIN_CONFLICT },
      }));
    }
  }, [node.config.conflict, node.config.joinType, updateConfig]);

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
  const keepItems = useMemo(() => (node.config.keep as KeepItem[]) ?? [], [node.config.keep]);

  // ASOF
  const asof = (node.config.asof as Record<string, unknown>) ?? {};
  const asofLeftTime = (asof.leftTime as string) ?? '';
  const asofOperator = (asof.operator as string) ?? '>=';
  const asofRightTime = (asof.rightTime as string) ?? '';
  const asofBy = useMemo(() => (asof.by as ConditionEntry[]) ?? [], [asof.by]);
  const displayedAsofBy = useMemo(
    () => (asofBy.length > 0 ? asofBy : [DEFAULT_CONDITION]),
    [asofBy]
  );

  const isAsof = joinType === 'asof';
  const needsConditions = joinType !== 'cross';
  const isSemiAnti = joinType === 'semi' || joinType === 'anti';

  const toleranceVal = (asof.tolerance as string) ?? '';
  const durationParts = useMemo(() => parseDuration(toleranceVal), [toleranceVal]);

  function handleDurationChange(part: keyof DurationParts, val: number) {
    updateConfig((cfg) => ({
      ...cfg,
      asof: {
        ...((cfg.asof as Record<string, unknown>) ?? {}),
        tolerance: updateJoinDurationPart(toleranceVal, part, val),
      },
    }));
  }

  function resolveNodeLabel(
    nodeRef: { id: string; config?: Record<string, unknown> } | undefined
  ): string {
    if (!nodeRef) return '';
    const fullNode = otherNodes.find((candidate) => candidate.id === nodeRef.id);
    if (fullNode) return fullNode.label || (fullNode.config?.alias as string) || '';
    return (nodeRef.config?.alias as string) || nodeRef.id;
  }

  const leftSourceLabel = resolveNodeLabel(sourceNode);
  const rightSourceLabel = resolveNodeLabel(rightSourceNode);

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
        value: 'left',
        label: tr('joinLeft'),
        tip: tr('joinLeftTip'),
      },
      {
        value: 'inner',
        label: tr('joinInner'),
        tip: tr('joinInnerTip'),
      },
      {
        value: 'full',
        label: tr('joinFull'),
        tip: tr('joinFullTip'),
      },
      {
        value: 'right',
        label: tr('joinRight'),
        tip: tr('joinRightTip'),
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
    return rightRawColumns.map((field) => qualifyJoinField(rightAlias, field));
  }, [rightAlias, rightRawColumns, rightSourceLabel]);

  const leftFieldCompletions = useMemo(
    () => fieldCompletions.map((field) => qualifyJoinField(leftAlias, field)),
    [fieldCompletions, leftAlias]
  );

  const hasLeftTypes = Object.keys(leftColumnTypes).length > 0;
  const hasRightTypes = Object.keys(rightColumnTypes).length > 0;
  const leftColumnTypesQualified = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [name, type] of Object.entries(leftColumnTypes)) {
      map[qualifyJoinField(leftAlias, name)] = type;
    }
    return map;
  }, [leftColumnTypes, leftAlias]);
  const asofLeftTimeOptions = useMemo(() => {
    const filtered = hasLeftTypes
      ? fieldCompletions.filter((c) => isTemporalDataFieldType(leftColumnTypes[c]))
      : fieldCompletions;
    return filtered.map((field) => qualifyJoinField(leftAlias, field));
  }, [fieldCompletions, leftColumnTypes, hasLeftTypes, leftAlias]);
  const rightColumnTypesQualified = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [name, type] of Object.entries(rightColumnTypes)) {
      map[qualifyJoinField(rightAlias, name)] = type;
    }
    return map;
  }, [rightColumnTypes, rightAlias]);
  const asofRightTimeOptions = useMemo(() => {
    const filtered = hasRightTypes
      ? rightRawColumns.filter((field) => isTemporalDataFieldType(rightColumnTypes[field]))
      : rightRawColumns;
    return filtered.map((field) => qualifyJoinField(rightAlias, field));
  }, [hasRightTypes, rightAlias, rightColumnTypes, rightRawColumns]);

  function handleJoinTypeChange(value: string) {
    updateConfig((cfg) => ({
      ...cfg,
      joinType: value,
      conditions: value === 'cross' ? undefined : cfg.conditions,
      asof: value === 'asof' ? (cfg.asof ?? {}) : undefined,
      keep: value === 'semi' || value === 'anti' ? undefined : cfg.keep,
      conflict:
        value === 'semi' || value === 'anti'
          ? undefined
          : (cfg.conflict ?? { ...DEFAULT_JOIN_CONFLICT }),
    }));
  }

  function handleKeepChange(items: KeepItem[]) {
    updateConfig((cfg) => ({ ...cfg, keep: items.length > 0 ? items : undefined }));
  }

  // Keep-field edits stay local until the user confirms the dialog.
  const [keepDialogOpen, setKeepDialogOpen] = useState(false);
  const [draftLeftWildcard, setDraftLeftWildcard] = useState(false);
  const [draftRightWildcard, setDraftRightWildcard] = useState(false);
  const [draftLeftSel, setDraftLeftSel] = useState(new Set<string>());
  const [draftRightSel, setDraftRightSel] = useState(new Set<string>());
  const [draftLeftAliases, setDraftLeftAliases] = useState(new Map<string, string>());
  const [draftRightAliases, setDraftRightAliases] = useState(new Map<string, string>());

  function openKeepDialog() {
    const draft = createJoinKeepDraft(
      keepItems,
      fieldCompletions,
      rightRawColumns,
      leftAlias,
      rightAlias
    );
    setDraftLeftWildcard(draft.leftWildcard);
    setDraftRightWildcard(draft.rightWildcard);
    setDraftLeftSel(draft.leftSelected);
    setDraftRightSel(draft.rightSelected);
    setDraftLeftAliases(draft.leftAliases);
    setDraftRightAliases(draft.rightAliases);
    setKeepDialogOpen(true);
  }

  function confirmKeep() {
    handleKeepChange(
      serializeJoinKeepDraft({
        leftTotal: fieldCompletions.length,
        rightTotal: rightRawColumns.length,
        leftWildcard: draftLeftWildcard,
        rightWildcard: draftRightWildcard,
        leftSelected: draftLeftSel,
        rightSelected: draftRightSel,
        leftAliases: draftLeftAliases,
        rightAliases: draftRightAliases,
      })
    );
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
    const allFields = fieldCompletions.map((field) => qualifyJoinField(leftAlias, field));
    setDraftLeftSel((prev) => toggleSelectAll(prev, allFields));
  }

  function toggleDraftRightAll() {
    setDraftRightWildcard(false);
    const allFields = rightRawColumns.map((field) => qualifyJoinField(rightAlias, field));
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

  const leftKeepSummary = useMemo(
    () => summarizeJoinKeep(keepItems, 'left', leftAlias, fieldCompletions.length),
    [keepItems, leftAlias, fieldCompletions.length]
  );
  const rightKeepSummary = useMemo(
    () => summarizeJoinKeep(keepItems, 'right', rightAlias, rightRawColumns.length),
    [keepItems, rightAlias, rightRawColumns.length]
  );
  const hasOutputFieldConflict = useMemo(() => {
    if (!rightSourceLabel || rightRawColumns.length === 0) return false;
    const draft = createJoinKeepDraft(
      keepItems,
      fieldCompletions,
      rightRawColumns,
      leftAlias,
      rightAlias
    );
    const leftOutputNames = new Set(
      fieldCompletions
        .map((field) => {
          const qualified = qualifyJoinField(leftAlias, field);
          if (!draft.leftSelected.has(qualified)) return null;
          return (draft.leftAliases.get(qualified) || field).toLowerCase();
        })
        .filter((field): field is string => field !== null)
    );
    return rightRawColumns.some((field) => {
      const qualified = qualifyJoinField(rightAlias, field);
      if (!draft.rightSelected.has(qualified)) return false;
      const outputName = (draft.rightAliases.get(qualified) || field).toLowerCase();
      return leftOutputNames.has(outputName);
    });
  }, [fieldCompletions, keepItems, leftAlias, rightAlias, rightRawColumns, rightSourceLabel]);

  const conditionOperatorItems = useMemo(
    () => OPERATOR_KEYS.map((op) => ({ value: op.value, label: tr(op.key) })),
    [tr]
  );

  function handleConditionsChange(next: ConditionEntry[]) {
    updateConfig((cfg) => ({ ...cfg, conditions: next.length > 0 ? next : undefined }));
  }

  function handleCondAdd(index: number) {
    handleConditionsChange(insertCondition(conditions, index));
  }

  function handleCondRemove(index: number) {
    handleConditionsChange(removeCondition(conditions, index));
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

  function handleAsofByAdd(index: number) {
    handleAsofByChange(insertCondition(asofBy, index));
  }

  function handleAsofByRemove(index: number) {
    handleAsofByChange(removeCondition(asofBy, index));
  }

  const conflictGroups = useMemo(
    () => [
      {
        key: 'conflict',
        items: [
          { value: 'right_prefix', label: tr('conflictPrefix') },
          { value: 'suffix', label: tr('conflictSuffix') },
        ],
      },
    ],
    [tr]
  );

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* Fixed mode rail with a flexible configuration area. */}
      <section className="flex h-full min-h-0 w-full overflow-hidden">
        <div className="flex h-full min-h-0 w-full">
          {/* Join mode rail */}
          <div className="scrollbar-hover w-[180px] shrink-0 overflow-y-auto border-r border-border-muted bg-surface/40 p-3.5">
            {/* Data source section */}
            <div className="grid gap-2.5">
              <div className="grid gap-1">
                <span className="mb-1 block text-[12px] font-medium text-text-secondary">
                  {tr('joinType')}
                </span>
                <div className="grid grid-cols-1 gap-1">
                  {joinTypes.map((jt) => (
                    <button
                      key={jt.value}
                      type="button"
                      onClick={() => handleJoinTypeChange(jt.value)}
                      title={jt.tip}
                      className={`flex min-h-8 items-center gap-2 rounded-md px-2 text-left transition-colors ${
                        joinType === jt.value
                          ? 'bg-accent/10 text-accent'
                          : 'text-text-secondary hover:bg-surface-hover'
                      }`}
                    >
                      <JoinVennSVG type={jt.value} selected={joinType === jt.value} />
                      <span
                        className={`text-[13px] leading-tight ${joinType === jt.value ? 'font-medium text-accent' : 'text-text-secondary'}`}
                      >
                        {jt.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Join configuration */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
            <div className="order-1 p-4">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-20 shrink-0 text-[13px] text-text-secondary">
                    {tr('leftInput')}
                  </span>
                  <div className="flex h-7 w-48 min-w-0 items-center rounded-md border border-border-muted/70 bg-background/28 px-2">
                    <span className="truncate text-[12px] text-text-primary">
                      {leftSourceLabel || tr('noLeftSource')}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-20 shrink-0 text-[13px] text-text-secondary">
                    {tr('rightInput')}
                  </span>
                  <div className="flex h-7 w-48 min-w-0 items-center rounded-md border border-border-muted/70 bg-background/28 px-2">
                    <span className="truncate text-[12px] text-text-primary">
                      {rightSourceLabel || tr('noRightSource')}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {isAsof && (
              <div className="order-2 px-4 pb-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-20 shrink-0 whitespace-nowrap text-[13px] text-text-secondary">
                    {tr('tolerance')}
                  </span>
                  {(
                    [
                      { key: 'd', label: tr('toleranceDay'), max: 365 },
                      { key: 'h', label: tr('toleranceHour'), max: 23 },
                      { key: 'm', label: tr('toleranceMin'), max: 59 },
                      { key: 's', label: tr('toleranceSec'), max: 59 },
                      { key: 'ms', label: tr('toleranceMs'), max: 999 },
                    ] as const
                  ).map(({ key, label, max }) => (
                    <div key={key} className="flex items-center gap-1">
                      <GlassFormTextInput
                        type="number"
                        min={0}
                        max={max}
                        value={toleranceVal ? String(durationParts[key]) : ''}
                        placeholder="0"
                        onChange={(value) => {
                          const parsed = parseInt(value, 10);
                          handleDurationChange(key, Number.isNaN(parsed) ? 0 : Math.max(0, parsed));
                        }}
                        textCenter
                        className="h-7 w-[46px] !px-1.5 text-[12px]"
                      />
                      <span className="w-[28px] text-[12px] text-text-muted">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Conditions */}
            <div className="order-4 mx-4 grid gap-2 border-t border-border-muted/60 pb-4 pt-3">
              <div className="text-[13px] font-medium text-text-secondary">
                {tr('joinConditionsHeader')}
              </div>

              {rightSourceLabel && rightColumnsError && !isAsof && (
                <div className="text-[11px] text-warning px-0.5">{tr('rightColumnsFailed')}</div>
              )}

              {isAsof ? (
                <div className="grid gap-1.5">
                  <div className="flex min-h-8 items-center gap-1 px-0.5">
                    <div className="flex min-w-0 flex-[1] items-center">
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
                        className="h-7 w-full min-w-0 text-[12px]"
                      />
                    </div>
                    <div className="flex min-w-0 flex-[0.6] items-center">
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
                            asof: {
                              ...((cfg.asof as Record<string, unknown>) ?? {}),
                              operator: v,
                            },
                          }))
                        }
                        className="h-7 w-full text-[12px] [&>span]:text-center"
                      />
                    </div>
                    <div className="flex min-w-0 flex-[1] items-center">
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
                        className="h-7 w-full min-w-0 text-[12px]"
                      />
                    </div>
                    <span className="w-[60px] flex-shrink-0" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 max-h-[180px] overflow-x-hidden overflow-y-auto">
                    <GlassRowList
                      items={displayedAsofBy}
                      columns={[
                        {
                          flex: 'flex-[1]',
                          header: '',
                          render: (cond: ConditionEntry, i: number) => (
                            <GlassFieldSingleSelect
                              value={cond.left}
                              options={leftFieldCompletions}
                              onChange={(v) =>
                                handleAsofByChange(
                                  displayedAsofBy.map((c, j) => (j === i ? { ...c, left: v } : c))
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
                          render: () => (
                            <span className="w-full text-center text-[12px] text-text-secondary">
                              {tr('operatorEq')}
                            </span>
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
                                handleAsofByChange(
                                  displayedAsofBy.map((c, j) => (j === i ? { ...c, right: v } : c))
                                )
                              }
                              placeholder={tr('rightField')}
                              className="h-7 w-full text-[12px]"
                            />
                          ),
                        },
                      ]}
                      onAdd={handleAsofByAdd}
                      onRemove={handleAsofByRemove}
                      addTitle={tr('addCondition')}
                      canAct={(action: RowAction, index: number) =>
                        action === 'add'
                          ? Boolean(displayedAsofBy[index]?.left && displayedAsofBy[index]?.right)
                          : true
                      }
                      hideHeader
                    />
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
                                conditions.map((c, j) =>
                                  j === i ? { ...c, operator: v as JoinCondition['operator'] } : c
                                )
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
                <div className="px-0.5 text-[12px] text-text-muted">{tr('noConditionsNeeded')}</div>
              )}
            </div>

            {/* Output fields and conflict handling */}
            <div className="order-3 flex min-h-7 flex-wrap items-center gap-x-5 gap-y-2 px-4 pb-4">
              {/* Keep fields */}
              {!isSemiAnti && (
                <div className="flex shrink-0 items-center gap-5 px-0.5">
                  <div className="flex items-center gap-2" title={tr('keepFieldStatsLeft')}>
                    <span className="text-[12px] text-text-primary">{tr('joinLeftFields')}</span>
                    <div className="flex items-center gap-1">
                      <span className="text-[12px] text-text-muted tabular-nums">
                        {tr('joinFieldSummary', {
                          selected: leftKeepSummary.selected,
                          total: fieldCompletions.length,
                          renamed: leftKeepSummary.renamed,
                        })}
                      </span>
                      <button
                        type="button"
                        onClick={openKeepDialog}
                        className="flex h-7 items-center gap-1 rounded px-1.5 text-[12px] text-text-secondary transition-colors hover:bg-accent-subtle hover:text-accent"
                        title={tr('adjustKeepFields')}
                      >
                        <Settings className="h-3.5 w-3.5" />
                        <span>{tr('joinAdjustFields')}</span>
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2" title={tr('keepFieldStatsRight')}>
                    <span className="text-[12px] text-text-primary">{tr('joinRightFields')}</span>
                    <div className="flex items-center gap-1">
                      <span className="text-[12px] text-text-muted tabular-nums">
                        {tr('joinFieldSummary', {
                          selected: rightKeepSummary.selected,
                          total: rightRawColumns.length,
                          renamed: rightKeepSummary.renamed,
                        })}
                      </span>
                      <button
                        type="button"
                        onClick={openKeepDialog}
                        className="flex h-7 items-center gap-1 rounded px-1.5 text-[12px] text-text-secondary transition-colors hover:bg-accent-subtle hover:text-accent"
                        title={tr('adjustKeepFields')}
                      >
                        <Settings className="h-3.5 w-3.5" />
                        <span>{tr('joinAdjustFields')}</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Conflict */}
              {!isSemiAnti &&
                rightSourceLabel &&
                !rightColumnsError &&
                (hasOutputFieldConflict ? (
                  <div className="flex shrink-0 items-center gap-2 px-0.5">
                    <span className="shrink-0 text-[12px] text-text-primary">{tr('conflict')}</span>
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
                      className="h-7 w-40 text-[12px] [&>span]:text-left"
                    />
                    {conflictStrategy === 'right_prefix' && (
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
                        className="h-7 w-28 text-[13px]"
                      />
                    )}
                  </div>
                ) : (
                  <span className="px-0.5 text-[12px] text-text-muted">
                    {tr('joinNoFieldConflict')}
                  </span>
                ))}

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
      </section>

      {/* Keep field dialog */}
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
              <JoinKeepFieldColumn
                side="left"
                title={leftSourceLabel || tr('leftInput')}
                fields={fieldCompletions}
                alias={leftAlias}
                selected={draftLeftSel}
                aliases={draftLeftAliases}
                allChecked={draftLeftAllChecked}
                onToggleAll={toggleDraftLeftAll}
                onToggleField={toggleDraftLeftField}
                onAliasChange={updateLeftAlias}
              />
              <JoinKeepFieldColumn
                side="right"
                title={rightSourceLabel || tr('rightInput')}
                fields={rightRawColumns}
                alias={rightAlias}
                selected={draftRightSel}
                aliases={draftRightAliases}
                allChecked={draftRightAllChecked}
                onToggleAll={toggleDraftRightAll}
                onToggleField={toggleDraftRightField}
                onAliasChange={updateRightAlias}
              />
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
