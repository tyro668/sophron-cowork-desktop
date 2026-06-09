import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DataWorkflowOperatorType } from '../../types';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassConditionEditor, type ConditionEntry } from './shared/GlassConditionEditor';

const CARDINALITY_LABELS: Record<string, string> = {
  '': 'cardinalityNone',
  one_to_one: 'cardinalityOneToOne',
  one_to_many: 'cardinalityOneToMany',
  many_to_one: 'cardinalityManyToOne',
  many_to_many: 'cardinalityManyToMany',
};
const CARDINALITY_FALLBACKS: Record<string, string> = {
  '': '不限制',
  one_to_one: '一对一',
  one_to_many: '一对多',
  many_to_one: '多对一',
  many_to_many: '多对多',
};

const SELECT_CLASS =
  'h-7 rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-secondary outline-none focus:border-accent';

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
    (key: string, fallback: string) => t(`formLabels.${key}`, { defaultValue: fallback }),
    [t]
  );

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

  const joinType = (node.config.joinType as string) ?? 'left';
  const conditions: ConditionEntry[] = (node.config.conditions as ConditionEntry[]) ?? [];
  const cardinality = (node.config.cardinality as string) ?? '';
  const conflict = (node.config.conflict as Record<string, unknown>) ?? {};
  const conflictStrategy = (conflict.strategy as string) ?? 'right_prefix';
  const rightPrefix = (conflict.rightPrefix as string) ?? '';
  const keepItems: Array<Record<string, unknown>> =
    (node.config.keep as Array<Record<string, unknown>>) ?? [];
  const keepLeftAll = keepItems.some((k) => k.side === 'left' && k.wildcard);
  const keepRightAll = keepItems.some((k) => k.side === 'right' && k.wildcard);

  // ASOF
  const asof = (node.config.asof as Record<string, unknown>) ?? {};
  const asofLeftTime = (asof.leftTime as string) ?? '';
  const asofOperator = (asof.operator as string) ?? '>=';
  const asofRightTime = (asof.rightTime as string) ?? '';
  const asofDirection = (asof.direction as string) ?? '';
  const asofTolerance = (asof.tolerance as string) ?? '';
  const asofBy: ConditionEntry[] = (asof.by as ConditionEntry[]) ?? [];

  const isAsof = joinType === 'asof';
  const needsConditions = joinType !== 'cross';

  // Resolve a node label from the full node list
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

  // Right table column names (fetched from DuckDB via IPC)
  const [rightRawColumns, setRightRawColumns] = useState<string[]>([]);
  const [rightColumnsError, setRightColumnsError] = useState(false);

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
        nodeType: rightSourceNode.type as DataWorkflowOperatorType,
        nodeConfig: rightSourceNode.config,
      })
      .then((cols) => {
        setRightRawColumns(cols);
        setRightColumnsError(false);
      })
      .catch(() => {
        setRightRawColumns([]);
        setRightColumnsError(true);
      });
  }, [rightSourceNode, taskId]);

  const joinTypeOptions = useMemo(
    () => [
      { value: 'inner', label: tr('joinInner', '内连接') },
      { value: 'left', label: tr('joinLeft', '左连接') },
      { value: 'right', label: tr('joinRight', '右连接') },
      { value: 'full', label: tr('joinFull', '全连接') },
      { value: 'cross', label: tr('joinCross', '交叉') },
      { value: 'semi', label: tr('joinSemi', '半连接') },
      { value: 'anti', label: tr('joinAnti', '反连接') },
      { value: 'asof', label: tr('joinAsof', '时间近邻') },
    ],
    [tr]
  );

  const rightFieldCompletions = useMemo(() => {
    if (!rightSourceLabel || rightRawColumns.length === 0) return [] as string[];
    return rightRawColumns.map((c) => `[${rightSourceLabel}].[${c}]`);
  }, [rightSourceLabel, rightRawColumns]);

  const leftFieldCompletions = useMemo(
    () => fieldCompletions.map((c) => `[${c}]`),
    [fieldCompletions]
  );

  function handleJoinTypeChange(value: string) {
    updateConfig((cfg) => ({
      ...cfg,
      joinType: value,
      conditions: value === 'cross' ? undefined : cfg.conditions,
      asof: value === 'asof' ? (cfg.asof ?? {}) : undefined,
    }));
  }

  function handleKeepChange(leftAll: boolean, rightAll: boolean) {
    const items: Array<Record<string, unknown>> = [];
    if (leftAll) items.push({ side: 'left', wildcard: true });
    if (rightAll) items.push({ side: 'right', wildcard: true });
    updateConfig((cfg) => ({ ...cfg, keep: items.length > 0 ? items : undefined }));
  }

  function handleAsofChange(patch: Record<string, unknown>) {
    updateConfig((cfg) => ({
      ...cfg,
      asof: { ...((cfg.asof as Record<string, unknown>) ?? {}), ...patch },
    }));
  }

  const readOnlyClasses =
    'flex h-7 items-center rounded-md border border-border-muted bg-background/28 px-1.5 text-[12px] text-text-muted';

  return (
    <div className="grid content-start gap-2.5">
      {/* Join type + Left source + Right source (both from handles) */}
      <GlassFormSection>
        <div className="grid gap-2 sm:grid-cols-3">
          <div>
            <GlassFormLabel>{tr('joinType', '连接类型')}</GlassFormLabel>
            <select
              value={joinType}
              onChange={(e) => handleJoinTypeChange(e.target.value)}
              className={SELECT_CLASS + ' w-full'}
            >
              {joinTypeOptions.map((j) => (
                <option key={j.value} value={j.value}>
                  {j.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <GlassFormLabel>{tr('leftInput', '左数据源')}</GlassFormLabel>
            <div className={readOnlyClasses}>
              {leftSourceLabel || tr('noLeftSource', '上游节点')}
            </div>
          </div>
          <div>
            <GlassFormLabel>{tr('rightInput', '右侧输入源')}</GlassFormLabel>
            <div className={readOnlyClasses}>
              {rightSourceLabel || tr('noRightSource', '未连接右表')}
            </div>
          </div>
        </div>
      </GlassFormSection>

      {/* Conditions (non-cross, non-asof) */}
      {needsConditions && !isAsof && (
        <GlassFormSection title={tr('conditions', '连接条件')}>
          {rightSourceLabel && rightColumnsError && (
            <div className="mb-2 text-[11px] text-warning">
              {tr('rightColumnsFailed', '无法获取右表字段，请手动输入')}
            </div>
          )}
          <GlassConditionEditor
            conditions={conditions}
            leftFieldCompletions={leftFieldCompletions}
            rightFieldCompletions={rightFieldCompletions}
            onChange={(next) =>
              updateConfig((cfg) => ({ ...cfg, conditions: next.length > 0 ? next : undefined }))
            }
            leftLabel={tr('leftField', '[左字段]')}
            rightLabel={tr('rightField', '[右表].[字段]')}
          />
        </GlassFormSection>
      )}

      {/* ASOF */}
      {isAsof && (
        <GlassFormSection title="ASOF">
          {rightSourceLabel && rightColumnsError && (
            <div className="mb-2 text-[11px] text-warning">
              {tr('rightColumnsFailed', '无法获取右表字段，请手动输入')}
            </div>
          )}
          <div className="grid gap-2">
            <div className="grid grid-cols-3 gap-1.5">
              <GlassFormTextInput
                value={asofLeftTime}
                onChange={(v) => handleAsofChange({ leftTime: v || undefined })}
                placeholder={tr('leftTimeCol', '左时间列')}
                className="h-7"
              />
              <select
                value={asofOperator}
                onChange={(e) => handleAsofChange({ operator: e.target.value })}
                className={SELECT_CLASS}
              >
                <option value=">=">{'>= (backward)'}</option>
                <option value="<=">{'<= (forward)'}</option>
                <option value="nearest">nearest</option>
              </select>
              <GlassFormTextInput
                value={asofRightTime}
                onChange={(v) => handleAsofChange({ rightTime: v || undefined })}
                placeholder={tr('rightTimeCol', '右时间列')}
                className="h-7"
              />
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <GlassFormTextInput
                value={asofTolerance}
                onChange={(v) => handleAsofChange({ tolerance: v || undefined })}
                placeholder={tr('tolerance', '容忍窗口，如 1d')}
                className="h-7"
              />
              <select
                value={asofDirection}
                onChange={(e) => handleAsofChange({ direction: e.target.value || undefined })}
                className={SELECT_CLASS}
              >
                <option value="">{tr('directionDefault', '方向：默认')}</option>
                <option value="backward">backward</option>
                <option value="forward">forward</option>
                <option value="nearest">nearest</option>
              </select>
            </div>
            <GlassConditionEditor
              conditions={asofBy}
              leftFieldCompletions={leftFieldCompletions}
              rightFieldCompletions={rightFieldCompletions}
              onChange={(next) => handleAsofChange({ by: next.length > 0 ? next : undefined })}
              leftLabel={tr('leftField', '[左字段]')}
              rightLabel={tr('rightField', '[右表].[字段]')}
            />
          </div>
        </GlassFormSection>
      )}

      {/* Keep + Cardinality + Conflict in one row */}
      <div className="grid grid-cols-3 gap-2.5">
        <GlassFormSection title={tr('keepFields', '保留字段')}>
          <div className="grid gap-1.5">
            <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-text-secondary">
              <input
                type="checkbox"
                checked={keepLeftAll}
                onChange={(e) => handleKeepChange(e.target.checked, keepRightAll)}
                className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
              />
              {tr('keepLeftAll', '左表全部')}
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-text-secondary">
              <input
                type="checkbox"
                checked={keepRightAll}
                onChange={(e) => handleKeepChange(keepLeftAll, e.target.checked)}
                className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
              />
              {tr('keepRightAll', '右表全部')}
            </label>
          </div>
        </GlassFormSection>

        <GlassFormSection title={tr('cardinality', '基数约束')}>
          <select
            value={cardinality}
            onChange={(e) =>
              updateConfig((cfg) => ({ ...cfg, cardinality: e.target.value || undefined }))
            }
            className={SELECT_CLASS + ' w-full'}
          >
            {Object.keys(CARDINALITY_LABELS).map((value) => (
              <option key={value} value={value}>
                {tr(CARDINALITY_LABELS[value], CARDINALITY_FALLBACKS[value])}
              </option>
            ))}
          </select>
        </GlassFormSection>

        <GlassFormSection title={tr('conflict', '同名字段冲突')}>
          <div className="grid gap-2">
            <select
              value={conflictStrategy}
              onChange={(e) =>
                updateConfig((cfg) => ({
                  ...cfg,
                  conflict: {
                    ...((cfg.conflict as Record<string, unknown>) ?? {}),
                    strategy: e.target.value,
                  },
                }))
              }
              className={SELECT_CLASS + ' w-full'}
            >
              <option value="right_prefix">{tr('conflictPrefix', '右表字段加前缀')}</option>
              <option value="suffix">{tr('conflictSuffix', '按表名加后缀')}</option>
            </select>
            {conflictStrategy === 'right_prefix' && (
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
                className="h-7"
              />
            )}
          </div>
        </GlassFormSection>
      </div>
    </div>
  );
}
