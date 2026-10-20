import { Fragment, useEffect, useMemo, useState } from 'react';
import { Settings, Table2 } from 'lucide-react';
import type { OperatorFormProps } from './types';
import { dataClient } from '../../features/data/api/data-client';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
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
import {
  AddRow,
  Cell,
  ErrorRow,
  FormGrid,
  HintRow,
  LabelCell,
  RowActionsCell,
  WarningRow,
} from './shared/FormGrid';
import { parseFieldRef } from '@/shared/prep-dsl/parser';
import { JoinVennSVG, type JoinVennType } from './join/JoinVennIcon';
import { JoinAsofSection, type JoinAsofPatch } from './join/JoinAsofSection';
import { JoinFieldSettingsDialog } from './join/JoinFieldSettingsDialog';
import {
  createCondition,
  insertCondition,
  removeCondition,
  type ConditionEntry,
} from './join/conditionRows';
import { resolveJoinReferenceAliases } from './join/joinReferenceAliases';

const OPERATOR_KEYS = [
  { value: '=', key: 'operatorEq' },
  { value: '<', key: 'operatorLt' },
  { value: '<=', key: 'operatorLte' },
  { value: '>', key: 'operatorGt' },
  { value: '>=', key: 'operatorGte' },
];

/** Shared column grid: label | A | B(120) | C | D(112). */
export const JOIN_GRID_COLUMNS = '104px minmax(200px,1fr) 120px minmax(200px,1fr) 112px';

function extractJoinFieldName(value: string): string {
  return parseFieldRef(value)?.name ?? value;
}

export default function FormJoin({
  node,
  pipelineId,
  fieldCompletions,
  otherNodes,
  workflowEdges,
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

  // Conditions are keyed by stable reference names (input_source aliases), not
  // by editable display labels — otherwise saved conditions show as missing
  // and break whenever an upstream node is renamed.
  const referenceAliases = useMemo(
    () =>
      resolveJoinReferenceAliases({
        leftSourceId: sourceNode?.id,
        rightSourceId: rightSourceNode?.id,
        nodes: [...otherNodes, node],
        edges: workflowEdges ?? [],
        configRightAlias: node.config.rightAlias,
        savedLeftRefs: ui.conditions.map((condition) => condition.left),
      }),
    [node, otherNodes, rightSourceNode?.id, sourceNode?.id, ui.conditions, workflowEdges]
  );
  const leftAlias = referenceAliases.leftAlias || leftSourceLabel || 'left';
  const rightAlias = referenceAliases.rightAlias || rightSourceLabel || 'right_source';

  // Right table column names (fetched via IPC, same as before)
  const [rightRawColumns, setRightRawColumns] = useState<string[]>([]);
  const [rightColumnsError, setRightColumnsError] = useState(false);
  // Optional column type info for ASOF time field filtering
  const leftColumnTypes = useWorkflowNodeColumnTypes({ pipelineId, sourceNode });
  const rightColumnTypes = useWorkflowNodeColumnTypes({ pipelineId, sourceNode: rightSourceNode });

  useEffect(() => {
    setRightRawColumns([]);
    setRightColumnsError(false);
    if (!rightSourceNode || typeof pipelineId !== 'string') return;
    if (!dataClient.isAvailable()) return;
    void dataClient
      .getWorkflowNodeColumns({
        pipelineId,
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
  }, [rightSourceNode, pipelineId]);

  const joinTypes = useMemo<Array<{ value: JoinVennType; label: string; tip: string }>>(
    () => [
      { value: 'inner', label: tr('joinInner'), tip: tr('joinInnerTip') },
      { value: 'left', label: tr('joinLeft'), tip: tr('joinLeftTip') },
      { value: 'right', label: tr('joinRight'), tip: tr('joinRightTip') },
      { value: 'full', label: tr('joinFull'), tip: tr('joinFullTip') },
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

  const LeftIcon = sourceNode ? Table2 : undefined;
  const RightIcon = rightSourceNode ? Table2 : undefined;
  const currentJoinTip = joinTypes.find((item) => item.value === joinType)?.tip ?? '';
  const rowLabels = {
    add: tr('rowAdd'),
    copy: tr('rowCopy'),
    remove: tr('rowRemove'),
  };

  // Per-condition validation shown as err cells + error rows (no silent "(?)").
  const conditionIssues = conditions.map((cond) => {
    const leftMissing =
      Boolean(cond.left) &&
      leftFieldCompletions.length > 0 &&
      !leftFieldCompletions.includes(cond.left);
    const rightMissing =
      Boolean(cond.right) &&
      rightFieldCompletions.length > 0 &&
      !rightFieldCompletions.includes(cond.right);
    const incomplete = Boolean(cond.left) !== Boolean(cond.right);
    return { leftMissing, rightMissing, incomplete };
  });
  const errorMessages = conditionIssues.flatMap((issue, index) => {
    const cond = conditions[index];
    const prefix = tr('conditionPrefix', { index: index + 1 });
    const out: Array<{ key: string; prefix: string; text: string }> = [];
    if (issue.leftMissing) {
      out.push({
        key: `${index}-l`,
        prefix,
        text: tr('conditionMissingField', {
          side: tr('leftSide'),
          table: leftSourceLabel || leftAlias,
          field: extractJoinFieldName(cond.left),
        }),
      });
    }
    if (issue.rightMissing) {
      out.push({
        key: `${index}-r`,
        prefix,
        text: tr('conditionMissingField', {
          side: tr('rightSide'),
          table: rightSourceLabel || rightAlias,
          field: extractJoinFieldName(cond.right),
        }),
      });
    }
    if (issue.incomplete) {
      out.push({ key: `${index}-i`, prefix, text: tr('conditionIncomplete') });
    }
    return out;
  });
  const showRightWarning = Boolean(rightSourceLabel && rightColumnsError);
  const conditionRowSpan = !needsConditions
    ? 1
    : isAsof
      ? 1 + (showRightWarning ? 1 : 0)
      : 1 + conditions.length + errorMessages.length + 1 + (showRightWarning ? 1 : 0);

  return (
    <div className="scrollbar-hover h-full min-h-0 overflow-y-auto">
      <FormGrid columns={JOIN_GRID_COLUMNS} testId="join-form-grid">
        <LabelCell>{tr('joinType')}</LabelCell>
        <Cell span={2} v={['ctl']}>
          <GlassOptionSingleSelect
            value={joinType}
            groups={[
              {
                key: 'joinTypes',
                items: joinTypes.map((jt) => ({
                  value: jt.value,
                  label: jt.label,
                  title: jt.tip,
                  icon: (
                    <JoinVennSVG
                      type={jt.value}
                      selected={joinType === jt.value}
                      className="h-4 w-6 shrink-0"
                    />
                  ),
                })),
              },
            ]}
            onChange={handleJoinTypeChange}
            className="w-full"
            aria-label={tr('joinType')}
          />
        </Cell>
        <Cell span={2} v={['muted']}>
          <span className="truncate" title={currentJoinTip}>
            {currentJoinTip}
          </span>
        </Cell>

        <LabelCell>{tr('inputTables')}</LabelCell>
        <Cell span={2} v={['ro']} testId="join-left-source">
          {LeftIcon ? <LeftIcon className="opg-ic h-3.5 w-3.5" /> : null}
          <span className="truncate font-medium">
            {leftSourceLabel || tr('sources.noLeftSource')}
          </span>
          {sourceNode && leftAlias ? <span className="opg-badge">{leftAlias}</span> : null}
          <span className="ml-auto text-[12px] text-text-muted">{tr('leftSide')}</span>
        </Cell>
        <Cell v={['ro']} testId="join-right-source">
          {RightIcon ? <RightIcon className="opg-ic h-3.5 w-3.5" /> : null}
          <span className="truncate font-medium">
            {rightSourceLabel || tr('sources.noRightSource')}
          </span>
          {rightSourceNode && rightAlias ? <span className="opg-badge">{rightAlias}</span> : null}
          <span className="ml-auto text-[12px] text-text-muted">{tr('rightSide')}</span>
        </Cell>
        {!isSemiAnti ? (
          <button
            type="button"
            onClick={() => setKeepDialogOpen(true)}
            className="opg-c btns"
            title={tr('joinFieldSettingsTip')}
          >
            <Settings className="opg-ic h-3.5 w-3.5" />
            <span>{tr('joinFieldSettings')}</span>
          </button>
        ) : (
          <Cell v={['blank']} />
        )}

        {isSemiAnti ? (
          <HintRow span={5}>
            {tr('semiAntiConfigHint', {
              model: joinType === 'semi' ? tr('joinSemi') : tr('joinAnti'),
            })}
          </HintRow>
        ) : null}

        <LabelCell rowSpan={conditionRowSpan}>{tr('joinConditionsHeader')}</LabelCell>
        {showRightWarning ? <WarningRow span={4}>{tr('rightColumnsFailed')}</WarningRow> : null}
        {!needsConditions ? (
          <Cell span={4} v={['muted']}>
            {tr('noConditionsNeeded')}
          </Cell>
        ) : isAsof ? (
          <Cell span={4} v={['pane']}>
            <div className="p-3">
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
            </div>
          </Cell>
        ) : (
          <>
            <Cell v={['th']}>{tr('headerLeftField')}</Cell>
            <Cell v={['th']}>{tr('headerOperator')}</Cell>
            <Cell v={['th']}>{tr('headerRightField')}</Cell>
            <Cell v={['th']} />
            {conditions.map((cond, i) => (
              <Fragment key={cond.id ?? `condition-${i}`}>
                <Cell v={['ctl', conditionIssues[i]?.leftMissing && 'err']}>
                  <GlassFieldSingleSelect
                    value={cond.left}
                    options={leftFieldCompletions}
                    columnTypes={leftColumnTypesQualified}
                    showQualifierBadge
                    onChange={(v) =>
                      handleConditionsChange(
                        conditions.map((c, j) => (j === i ? { ...c, left: v } : c))
                      )
                    }
                    placeholder={tr('leftField')}
                    className="w-full"
                  />
                </Cell>
                <Cell v={['ctl', 'hl']}>
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
                    className="w-full"
                  />
                </Cell>
                <Cell v={['ctl', conditionIssues[i]?.rightMissing && 'err']}>
                  <GlassFieldSingleSelect
                    value={cond.right}
                    options={rightFieldCompletions}
                    columnTypes={rightColumnTypesQualified}
                    showQualifierBadge
                    onChange={(v) =>
                      handleConditionsChange(
                        conditions.map((c, j) => (j === i ? { ...c, right: v } : c))
                      )
                    }
                    placeholder={tr('rightField')}
                    className="w-full"
                  />
                </Cell>
                <RowActionsCell
                  labels={rowLabels}
                  onAdd={() => handleCondAdd(i)}
                  onCopy={() => {
                    if (!canAppendRow(conditions.length, MAX_JOIN_CONDITION_COUNT)) return;
                    const next = [...conditions];
                    next.splice(i + 1, 0, { ...cond, id: undefined });
                    handleConditionsChange(next);
                  }}
                  onRemove={() => handleCondRemove(i)}
                  canAdd={canAppendRow(conditions.length, MAX_JOIN_CONDITION_COUNT)}
                />
              </Fragment>
            ))}
            {errorMessages.map((message) => (
              <ErrorRow key={message.key} span={4}>
                <b>{message.prefix}</b>
                {message.text}
              </ErrorRow>
            ))}
            <AddRow
              span={4}
              label={tr('addCondition')}
              onClick={() => handleCondAdd(conditions.length - 1)}
              disabled={!canAppendRow(conditions.length, MAX_JOIN_CONDITION_COUNT)}
            />
          </>
        )}
      </FormGrid>

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
