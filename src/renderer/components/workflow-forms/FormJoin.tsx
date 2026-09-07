import { useEffect, useMemo, useState } from 'react';
import { Settings } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import { GlassRowList } from './shared/GlassRowList';
import { canAppendRow, ensureStableRowIds } from './shared/rowListOperations';
import { MAX_JOIN_CONDITION_COUNT, type JoinCondition } from '@/shared/operator-schemas';
import {
  JOIN_CONFLICT_DEFAULTS,
  qualifyJoinField,
  readJoinUiConfig,
  updateJoinAsof,
} from '@/shared/operator-config';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
import { JoinVennSVG, type JoinVennType } from './join/JoinVennIcon';
import { JoinAsofSection, type JoinAsofPatch } from './join/JoinAsofSection';
import { JoinFieldSettingsDialog } from './join/JoinFieldSettingsDialog';
import {
  createCondition,
  insertCondition,
  removeCondition,
  type ConditionEntry,
} from './join/conditionRows';

const OPERATOR_KEYS = [
  { value: '=', key: 'operatorEq' },
  { value: '<', key: 'operatorLt' },
  { value: '<=', key: 'operatorLte' },
  { value: '>', key: 'operatorGt' },
  { value: '>=', key: 'operatorGte' },
];

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
  const conditions = useMemo(
    () => (ui.conditions.length > 0 ? ensureStableRowIds(ui.conditions) : [createCondition()]),
    [ui.conditions]
  );

  const isAsof = joinType === 'asof';
  const needsConditions = joinType !== 'cross';
  const isSemiAnti = joinType === 'semi' || joinType === 'anti';

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

  const joinTypes = useMemo<Array<{ value: JoinVennType; label: string; tip: string }>>(
    () => [
      { value: 'left', label: tr('joinLeft'), tip: tr('joinLeftTip') },
      { value: 'inner', label: tr('joinInner'), tip: tr('joinInnerTip') },
      { value: 'full', label: tr('joinFull'), tip: tr('joinFullTip') },
      { value: 'right', label: tr('joinRight'), tip: tr('joinRightTip') },
      { value: 'cross', label: tr('joinCross'), tip: tr('joinCrossTip') },
      { value: 'semi', label: tr('joinSemi'), tip: tr('joinSemiTip') },
      { value: 'anti', label: tr('joinAnti'), tip: tr('joinAntiTip') },
      { value: 'asof', label: tr('joinAsof'), tip: tr('joinAsofTip') },
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

  const leftColumnTypesQualified = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [name, type] of Object.entries(leftColumnTypes)) {
      map[qualifyJoinField(leftAlias, name)] = type;
    }
    return map;
  }, [leftColumnTypes, leftAlias]);
  const rightColumnTypesQualified = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [name, type] of Object.entries(rightColumnTypes)) {
      map[qualifyJoinField(rightAlias, name)] = type;
    }
    return map;
  }, [rightColumnTypes, rightAlias]);

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

  const conditionOperatorItems = useMemo(
    () => OPERATOR_KEYS.map((op) => ({ value: op.value, label: tr(op.key) })),
    [tr]
  );

  function handleConditionsChange(next: ConditionEntry[]) {
    updateConfig((cfg) => ({
      ...cfg,
      conditions: next.length > 0 ? ensureStableRowIds(next) : undefined,
    }));
  }

  function handleCondAdd(index: number) {
    if (!canAppendRow(conditions.length, MAX_JOIN_CONDITION_COUNT)) return;
    handleConditionsChange(insertCondition(conditions, index));
  }

  function handleCondRemove(index: number) {
    handleConditionsChange(removeCondition(conditions, index));
  }

  const handleAsofChange = (patch: JoinAsofPatch) => {
    updateConfig((cfg) => ({ ...cfg, asof: updateJoinAsof(cfg.asof, { ...patch }) }));
  };

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
                    onClick={() => setKeepDialogOpen(true)}
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
                <JoinAsofSection
                  asof={ui.asof}
                  leftFields={fieldCompletions}
                  rightFields={rightRawColumns}
                  leftColumnTypes={leftColumnTypes}
                  rightColumnTypes={rightColumnTypes}
                  leftAlias={leftAlias}
                  rightAlias={rightAlias}
                  onAsofChange={handleAsofChange}
                />
              ) : needsConditions ? (
                <div className="scrollbar-hover max-h-[280px] overflow-y-auto">
                  <GlassRowList
                    items={conditions}
                    getKey={(condition, index) => condition.id ?? `condition-${index}`}
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
                    canAct={(action) =>
                      action !== 'add' || canAppendRow(conditions.length, MAX_JOIN_CONDITION_COUNT)
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
        <JoinFieldSettingsDialog
          keepItems={keepItems}
          conflict={ui.conflict}
          leftFields={fieldCompletions}
          rightFields={rightRawColumns}
          leftAlias={leftAlias}
          rightAlias={rightAlias}
          leftTitle={leftSourceLabel || tr('sources.leftInput')}
          rightTitle={rightSourceLabel || tr('sources.rightInput')}
          onConfirm={(keep, conflict) => {
            updateConfig((cfg) => ({ ...cfg, keep, conflict }));
            setKeepDialogOpen(false);
          }}
          onCancel={() => setKeepDialogOpen(false)}
        />
      )}
    </div>
  );
}
