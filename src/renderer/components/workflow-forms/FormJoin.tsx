import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Settings } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import { GlassRowList, type RowAction } from './shared/GlassRowList';
import { toggleSelectAll } from '../../../shared/collections/selection';
import { isTemporalDataFieldType } from '@/shared/data-field-types';
import { parseDuration } from '@/shared/operator-schemas/join';
import type { DurationParts, JoinCondition } from '@/shared/operator-schemas';
import {
  buildJoinConflictConfig,
  createJoinKeepDraft,
  JOIN_CONFLICT_DEFAULTS,
  qualifyJoinField,
  readJoinUiConfig,
  serializeJoinKeepDraft,
  updateJoinAsof,
  updateJoinDurationPart,
} from '@/shared/operator-config';
import type { JoinConflictUi } from '@/shared/operator-config';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';

export type ConditionEntry = JoinCondition;

const DEFAULT_CONDITION: ConditionEntry = { left: '', operator: '=', right: '' };

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
  allIndeterminate?: boolean;
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
  allIndeterminate,
  onToggleAll,
  onToggleField,
  onAliasChange,
}: JoinKeepFieldColumnProps) {
  const tr = useFormTranslation('join');

  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = Boolean(allIndeterminate);
    }
  }, [allIndeterminate]);

  return (
    <div
      className={side === 'left' ? 'flex-1 border-r border-border-muted/50 pr-4' : 'flex-1 pl-4'}
    >
      <h4 className="mb-1 text-[12px] font-medium text-text-secondary">{title}</h4>
      <p className="mb-2 text-[10px] text-text-muted">{tr('joinKeepAliasPrompt')}</p>
      <label className="mb-1.5 flex cursor-pointer items-center gap-1.5 text-[12px] font-medium text-text-secondary">
        <input
          ref={selectAllRef}
          type="checkbox"
          checked={allChecked}
          onChange={onToggleAll}
          className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
        />
        {tr('selectAllFields')}
      </label>
      <div className="scrollbar-hover max-h-48 space-y-1 overflow-y-auto">
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
              {/* Always mounted (hidden when unchecked) so toggling selection
                  does not change the row height or resize the dialog. */}
              <input
                type="text"
                value={fieldAlias}
                onChange={(event) => onAliasChange(qualifiedField, event.target.value)}
                placeholder={field}
                tabIndex={isChecked ? undefined : -1}
                className={`h-5 w-28 shrink-0 rounded border border-border-muted/50 bg-background/30 px-1.5 text-[11px] text-text-primary outline-none placeholder:text-text-muted/50 focus:border-accent ${
                  isChecked ? '' : 'invisible'
                }`}
              />
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
  const tr = useFormTranslation('join');
  const updateConfig = useUpdateConfig(onNodeChange);

  // Initialize default conflict config (only for non-semi/anti joins)
  useEffect(() => {
    const { joinType: currentJoinType } = readJoinUiConfig(node.config);
    if (currentJoinType !== 'semi' && currentJoinType !== 'anti' && !node.config.conflict) {
      updateConfig((cfg) => ({
        ...cfg,
        conflict: { ...JOIN_CONFLICT_DEFAULTS },
      }));
    }
  }, [node.config, updateConfig]);

  const ui = useMemo(() => readJoinUiConfig(node.config), [node.config]);
  const { joinType, keep: keepItems } = ui;
  const { operator: asofOperator, tolerance: toleranceVal } = ui.asof;
  const conditions = ui.conditions.length > 0 ? ui.conditions : [DEFAULT_CONDITION];

  // ASOF
  const asofLeftTime = ui.asof.leftTime;
  const asofRightTime = ui.asof.rightTime;
  const asofBy = ui.asof.by;
  const displayedAsofBy = useMemo(
    () => (asofBy.length > 0 ? asofBy : [DEFAULT_CONDITION]),
    [asofBy]
  );

  const isAsof = joinType === 'asof';
  const needsConditions = joinType !== 'cross';
  const isSemiAnti = joinType === 'semi' || joinType === 'anti';

  const durationParts = useMemo(() => parseDuration(toleranceVal), [toleranceVal]);

  function handleDurationChange(part: keyof DurationParts, val: number) {
    updateConfig((cfg) => ({
      ...cfg,
      asof: updateJoinAsof(cfg.asof, {
        tolerance: updateJoinDurationPart(toleranceVal, part, val),
      }),
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
          : (cfg.conflict ?? { ...JOIN_CONFLICT_DEFAULTS }),
    }));
  }

  // Keep-field edits stay local until the user confirms the dialog.
  const [keepDialogOpen, setKeepDialogOpen] = useState(false);

  // Escape closes the keep-fields dialog without applying the draft selection.
  useEffect(() => {
    if (!keepDialogOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setKeepDialogOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [keepDialogOpen]);
  const [draftLeftWildcard, setDraftLeftWildcard] = useState(false);
  const [draftRightWildcard, setDraftRightWildcard] = useState(false);
  const [draftLeftSel, setDraftLeftSel] = useState(new Set<string>());
  const [draftRightSel, setDraftRightSel] = useState(new Set<string>());
  const [draftLeftAliases, setDraftLeftAliases] = useState(new Map<string, string>());
  const [draftRightAliases, setDraftRightAliases] = useState(new Map<string, string>());
  const [draftConflict, setDraftConflict] = useState<JoinConflictUi>(() => ui.conflict);

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
    setDraftConflict({ ...ui.conflict });
    setKeepDialogOpen(true);
  }

  function confirmKeep() {
    const items = serializeJoinKeepDraft({
      leftTotal: fieldCompletions.length,
      rightTotal: rightRawColumns.length,
      leftWildcard: draftLeftWildcard,
      rightWildcard: draftRightWildcard,
      leftSelected: draftLeftSel,
      rightSelected: draftRightSel,
      leftAliases: draftLeftAliases,
      rightAliases: draftRightAliases,
    });
    // Conflict edits live in the same draft so cancel reverts them together
    // with the keep selection.
    updateConfig((cfg) => ({
      ...cfg,
      keep: items.length > 0 ? items : undefined,
      conflict: buildJoinConflictConfig(draftConflict),
    }));
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
  const draftLeftIndeterminate = useMemo(
    () => draftLeftSel.size > 0 && draftLeftSel.size < fieldCompletions.length,
    [draftLeftSel, fieldCompletions]
  );
  const draftRightIndeterminate = useMemo(
    () => draftRightSel.size > 0 && draftRightSel.size < rightRawColumns.length,
    [draftRightSel, rightRawColumns]
  );

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
      asof: updateJoinAsof(cfg.asof, { by: next.length > 0 ? next : undefined }),
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
          <div className="scrollbar-hover flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
            <div className="order-1 grid gap-2 p-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <GlassFormLabel>{tr('sources.leftInput')}</GlassFormLabel>
                  <div className="flex h-7 min-w-0 flex-1 items-center rounded-md border border-border-muted/70 bg-background/28 px-2">
                    <span className="truncate text-[12px] text-text-primary">
                      {leftSourceLabel || tr('sources.noLeftSource')}
                    </span>
                  </div>
                </div>
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <GlassFormLabel>{tr('sources.rightInput')}</GlassFormLabel>
                  <div className="flex h-7 min-w-0 flex-1 items-center rounded-md border border-border-muted/70 bg-background/28 px-2">
                    <span className="truncate text-[12px] text-text-primary">
                      {rightSourceLabel || tr('sources.noRightSource')}
                    </span>
                  </div>
                </div>
                {!isSemiAnti && (
                  <button
                    type="button"
                    onClick={openKeepDialog}
                    className="flex h-7 shrink-0 items-center gap-1 rounded px-1.5 text-[12px] text-text-secondary transition-colors hover:bg-accent-subtle hover:text-accent"
                    title={tr('joinFieldSettingsTip')}
                  >
                    <Settings className="h-3.5 w-3.5" />
                    <span>{tr('joinFieldSettings')}</span>
                  </button>
                )}
              </div>
              {isSemiAnti && (
                <div className="text-[12px] text-text-muted">
                  {tr('semiAntiConfigHint', {
                    model: joinType === 'semi' ? tr('joinSemi') : tr('joinAnti'),
                  })}
                </div>
              )}
            </div>

            {/* Conditions */}
            <div className="order-2 mx-4 mb-4 grid gap-2 border-t border-border-muted/60 pt-3">
              <div className="text-[13px] font-medium text-text-secondary">
                {tr('joinConditionsHeader')}
              </div>

              {rightSourceLabel && rightColumnsError && (
                <div className="text-[11px] text-warning px-0.5">{tr('rightColumnsFailed')}</div>
              )}

              {isAsof ? (
                <div className="grid gap-1.5">
                  {/* ASOF time settings card: the time trio and tolerance form their
                      own group; only the by rows below use the condition grid. */}
                  <div className="grid gap-2.5 rounded-lg border border-border-muted bg-background px-3 py-2.5">
                    <div className="flex items-center gap-1">
                      <div className="flex min-w-0 flex-[1] items-center">
                        <div className="flex w-full">
                          <GlassFieldSingleSelect
                            value={asofLeftTime}
                            options={asofLeftTimeOptions}
                            columnTypes={leftColumnTypesQualified}
                            onChange={(v) =>
                              updateConfig((cfg) => ({
                                ...cfg,
                                asof: updateJoinAsof(cfg.asof, { leftTime: v || undefined }),
                              }))
                            }
                            placeholder={tr('leftTimeCol')}
                            className="h-7 w-full min-w-0 text-[12px]"
                          />
                        </div>
                      </div>
                      <div className="flex min-w-0 flex-[0.6] items-center">
                        <div className="flex w-full">
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
                                asof: updateJoinAsof(cfg.asof, { operator: v }),
                              }))
                            }
                            variant="highlight"
                            className="h-7 w-full text-[12px] [&>span]:text-center"
                          />
                        </div>
                      </div>
                      <div className="flex min-w-0 flex-[1] items-center">
                        <div className="flex w-full">
                          <GlassFieldSingleSelect
                            value={asofRightTime}
                            options={asofRightTimeOptions}
                            columnTypes={rightColumnTypesQualified}
                            onChange={(v) =>
                              updateConfig((cfg) => ({
                                ...cfg,
                                asof: updateJoinAsof(cfg.asof, { rightTime: v || undefined }),
                              }))
                            }
                            placeholder={tr('rightTimeCol')}
                            className="h-7 w-full min-w-0 text-[12px]"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <GlassFormLabel className="!h-7">{tr('tolerance')}</GlassFormLabel>
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
                              handleDurationChange(
                                key,
                                Number.isNaN(parsed) ? 0 : Math.max(0, parsed)
                              );
                            }}
                            textCenter
                            className="h-7 w-[46px] !px-1.5 text-[12px]"
                          />
                          <span className="w-[28px] text-[12px] text-text-muted">{label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="px-0.5 text-[12px] text-text-muted">{tr('joinAsofByHeader')}</div>
                  <div className="scrollbar-hover min-w-0 max-h-[180px] overflow-x-hidden overflow-y-auto">
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
                              columnTypes={leftColumnTypesQualified}
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
                              columnTypes={rightColumnTypesQualified}
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
                <div className="scrollbar-hover max-h-[280px] overflow-y-auto">
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
                            columnTypes={leftColumnTypesQualified}
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
                            variant="highlight"
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
                            columnTypes={rightColumnTypesQualified}
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
          </div>
        </div>
      </section>

      {/* Keep field dialog */}
      {keepDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/28 px-4 py-6"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) cancelKeep();
          }}
        >
          <div
            autoFocus
            tabIndex={-1}
            className="flex max-h-full w-[680px] flex-col rounded-xl border border-border-subtle bg-[var(--glass-card-strong)] shadow-card backdrop-blur-xl outline-none"
          >
            <div className="flex items-center justify-between border-b border-border-muted/50 px-4 py-3">
              <h3 className="text-[13px] font-semibold text-text-primary">
                {tr('joinFieldSettings')}
              </h3>
            </div>
            <div className="scrollbar-hover flex gap-4 overflow-y-auto p-4">
              <JoinKeepFieldColumn
                side="left"
                title={leftSourceLabel || tr('sources.leftInput')}
                fields={fieldCompletions}
                alias={leftAlias}
                selected={draftLeftSel}
                aliases={draftLeftAliases}
                allChecked={draftLeftAllChecked}
                allIndeterminate={draftLeftIndeterminate}
                onToggleAll={toggleDraftLeftAll}
                onToggleField={toggleDraftLeftField}
                onAliasChange={updateLeftAlias}
              />
              <JoinKeepFieldColumn
                side="right"
                title={rightSourceLabel || tr('sources.rightInput')}
                fields={rightRawColumns}
                alias={rightAlias}
                selected={draftRightSel}
                aliases={draftRightAliases}
                allChecked={draftRightAllChecked}
                allIndeterminate={draftRightIndeterminate}
                onToggleAll={toggleDraftRightAll}
                onToggleField={toggleDraftRightField}
                onAliasChange={updateRightAlias}
              />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border-muted/50 px-4 py-3">
              <span className="shrink-0 text-[12px] text-text-primary">{tr('conflict')}</span>
              <GlassOptionSingleSelect
                value={draftConflict.strategy}
                groups={conflictGroups}
                onChange={(v) => setDraftConflict((prev) => ({ ...prev, strategy: v }))}
                className="h-7 w-40 text-[12px] [&>span]:text-left"
              />
              {draftConflict.strategy === 'suffix' ? (
                <>
                  <label className="flex items-center gap-1 text-[12px] text-text-secondary">
                    {tr('conflictLeftSuffix')}
                    <GlassFormTextInput
                      value={draftConflict.leftSuffix}
                      onChange={(v) => setDraftConflict((prev) => ({ ...prev, leftSuffix: v }))}
                      placeholder={JOIN_CONFLICT_DEFAULTS.leftSuffix}
                      className="h-7 w-24 text-[12px]"
                    />
                  </label>
                  <label className="flex items-center gap-1 text-[12px] text-text-secondary">
                    {tr('conflictRightSuffix')}
                    <GlassFormTextInput
                      value={draftConflict.rightSuffix}
                      onChange={(v) => setDraftConflict((prev) => ({ ...prev, rightSuffix: v }))}
                      placeholder={JOIN_CONFLICT_DEFAULTS.rightSuffix}
                      className="h-7 w-24 text-[12px]"
                    />
                  </label>
                </>
              ) : (
                <label className="flex items-center gap-1 text-[12px] text-text-secondary">
                  {tr('prefix')}
                  <GlassFormTextInput
                    value={draftConflict.rightPrefix}
                    onChange={(v) => setDraftConflict((prev) => ({ ...prev, rightPrefix: v }))}
                    placeholder={JOIN_CONFLICT_DEFAULTS.rightPrefix}
                    className="h-7 w-24 text-[12px]"
                  />
                </label>
              )}
            </div>
            <div className="flex justify-end gap-2 px-4 py-3">
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
