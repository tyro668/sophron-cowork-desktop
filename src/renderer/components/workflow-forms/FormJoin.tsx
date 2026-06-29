import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings } from 'lucide-react';
import type { DataWorkflowOperatorType } from '../../types';
import type { OperatorFormProps } from './index';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassFieldCombo } from './shared/GlassFieldCombo';
import { GlassOperatorSelect } from './shared/GlassOperatorSelect';
import { GlassConditionEditor, type ConditionEntry } from './shared/GlassConditionEditor';

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
  const conditions = useMemo(
    () => (node.config.conditions as ConditionEntry[]) ?? [],
    [node.config.conditions]
  );
  const cardinality = (node.config.cardinality as string) ?? '';
  const conflict = useMemo(
    () => (node.config.conflict as Record<string, unknown>) ?? {},
    [node.config.conflict]
  );
  const conflictStrategy = (conflict.strategy as string) ?? 'right_prefix';
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

  function handleKeepChange(items: Array<Record<string, unknown>>) {
    updateConfig((cfg) => ({ ...cfg, keep: items.length > 0 ? items : undefined }));
  }

  // ── Keep field modal state ──
  const [keepDialogOpen, setKeepDialogOpen] = useState(false);
  const [draftKeepAll, setDraftKeepAll] = useState(true);
  const [draftLeftSel, setDraftLeftSel] = useState(new Set<string>());
  const [draftRightSel, setDraftRightSel] = useState(new Set<string>());

  function openKeepDialog() {
    const hasWildcards = keepItems.some((i) => i.wildcard);
    const specific = keepItems.filter((i) => !i.wildcard);
    setDraftKeepAll(hasWildcards);
    setDraftLeftSel(
      new Set(
        specific
          .filter((i) => String(i.source).startsWith(leftAlias + '.'))
          .map((i) => String(i.source))
      )
    );
    setDraftRightSel(
      new Set(
        specific
          .filter((i) => String(i.source).startsWith(rightAlias + '.'))
          .map((i) => String(i.source))
      )
    );
    setKeepDialogOpen(true);
  }

  function confirmKeep() {
    const items: Array<Record<string, unknown>> = [];
    if (draftKeepAll) {
      items.push({ side: 'left', wildcard: true }, { side: 'right', wildcard: true });
    } else {
      for (const f of draftLeftSel) items.push({ source: f });
      for (const f of draftRightSel) items.push({ source: f });
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
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }

  function toggleDraftRightField(field: string) {
    setDraftRightSel((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }

  function toggleDraftLeftAll() {
    const allFields = fieldCompletions.map((f) => `${leftAlias}.${f}`);
    setDraftLeftSel((prev) => (prev.size > 0 ? new Set() : new Set(allFields)));
  }

  function toggleDraftRightAll() {
    const allFields = rightRawColumns.map((f) => `${rightAlias}.${f}`);
    setDraftRightSel((prev) => (prev.size > 0 ? new Set() : new Set(allFields)));
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
    return keepItems.filter(
      (i) => !i.wildcard && String(i.source ?? '').startsWith(leftAlias + '.')
    ).length;
  }, [keepItems, fieldCompletions, leftAlias]);
  const rightKeepCount = useMemo(() => {
    const wildcardItem = keepItems.find((i) => i.side === 'right' && i.wildcard);
    if (wildcardItem) return rightRawColumns.length;
    return keepItems.filter(
      (i) => !i.wildcard && String(i.source ?? '').startsWith(rightAlias + '.')
    ).length;
  }, [keepItems, rightRawColumns, rightAlias]);

  // ── Inline condition handlers ──
  function handleConditionsChange(next: ConditionEntry[]) {
    updateConfig((cfg) => ({ ...cfg, conditions: next.length > 0 ? next : undefined }));
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

  // ── Cardinality select options ──
  const cardinalityOptions = useMemo(
    () =>
      Object.keys(CARDINALITY_LABELS).map((value) => ({
        value,
        label: tr(CARDINALITY_LABELS[value], CARDINALITY_FALLBACKS[value]),
      })),
    [tr]
  );
  const cardinalityGroups = useMemo(
    () => [{ key: 'cardinality', items: cardinalityOptions }],
    [cardinalityOptions]
  );

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
      {/* ═══ Big card: 2:1 two-column layout ═══ */}
      <div className="rounded-lg border border-border-muted bg-background/42">
        <div className="flex">
          {/* ── Left column (flex-[2.5]) ── */}
          <div className="flex-[2.5] border-r border-border-muted/50">
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
                    {tr('leftInput', '左数据源')}
                  </span>
                  <div className="flex-1 flex items-center rounded-md border border-border-muted/70 bg-background/28 px-2 h-7 min-w-0">
                    <span className="text-[12px] text-text-primary truncate">
                      {leftSourceLabel || tr('noLeftSource', '上游节点')}
                    </span>
                  </div>
                </div>
                <div className="flex-1 flex items-center gap-2">
                  <span className="shrink-0 text-[11px] font-medium text-text-secondary">
                    {tr('rightInput', '右数据源')}
                  </span>
                  <div className="flex-1 flex items-center rounded-md border border-border-muted/70 bg-background/28 px-2 h-7 min-w-0">
                    <span className="text-[12px] text-text-primary truncate">
                      {rightSourceLabel || tr('noRightSource', '未连接右表')}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid gap-1">
                <GlassFormLabel>{tr('joinType', '连接类型')}</GlassFormLabel>
                <div className="grid grid-cols-8 gap-1">
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

            {/* ── Separator ── */}
            <div className="border-t border-border-muted/50" />

            {/* Condition section */}
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
                    {tr('joinConditionsHint', '配置字段匹配条件')}
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
                    <GlassFieldCombo
                      value={asofLeftTime}
                      options={fieldCompletions}
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
                      className="h-7 flex-1 min-w-0 text-[12px]"
                    />
                    <GlassOperatorSelect
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
                    <GlassFieldCombo
                      value={asofRightTime}
                      options={rightFieldCompletions}
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
                      className="h-7 flex-1 min-w-0 text-[12px]"
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
                      className="w-[72px] shrink-0"
                      style={{ height: '1.75rem' }}
                    />
                    <GlassOperatorSelect
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
                    <GlassConditionEditor
                      conditions={(asof.by as ConditionEntry[]) ?? []}
                      leftFieldCompletions={leftFieldCompletions}
                      rightFieldCompletions={rightFieldCompletions}
                      onChange={handleAsofByChange}
                      leftLabel={tr('leftField', '[左字段]')}
                      rightLabel={tr('rightField', '[右表].[字段]')}
                    />
                  </div>
                </div>
              ) : needsConditions ? (
                <div className="max-h-[280px] overflow-y-auto">
                  <GlassConditionEditor
                    conditions={conditions}
                    leftFieldCompletions={leftFieldCompletions}
                    rightFieldCompletions={rightFieldCompletions}
                    onChange={handleConditionsChange}
                    leftLabel={tr('leftField', '[左字段]')}
                    rightLabel={tr('rightField', '[右表].[字段]')}
                  />
                </div>
              ) : (
                <div className="text-[12px] text-text-secondary px-0.5">
                  {tr('noConditionsNeeded', '无需连接条件')}
                </div>
              )}
            </div>
          </div>

          {/* ── Right column (flex-[1]) ── */}
          <div className="flex-[1] p-3 grid gap-3 content-start">
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

            {/* Keep left fields */}
            <div className="flex items-center justify-between px-0.5">
              <span className="text-[12px] text-text-primary">
                {tr('keepLeftFields', '保留左表字段')}
              </span>
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-text-muted">
                  {leftKeepCount > 0 ? leftKeepCount : 0}
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

            {/* Keep right fields */}
            <div className="flex items-center justify-between px-0.5">
              <span className="text-[12px] text-text-primary">
                {tr('keepRightFields', '保留右表字段')}
              </span>
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-text-muted">
                  {rightKeepCount > 0 ? rightKeepCount : 0}
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

            <hr className="border-border-muted/50" />

            {/* Cardinality */}
            <div className="grid gap-1 px-0.5">
              <GlassFormLabel>{tr('cardinality', '基数约束')}</GlassFormLabel>
              <GlassOperatorSelect
                value={cardinality}
                groups={cardinalityGroups}
                onChange={(v) => updateConfig((cfg) => ({ ...cfg, cardinality: v || undefined }))}
                className="h-7 text-[12px] [&>span]:text-left"
              />
            </div>

            <hr className="border-border-muted/50" />

            {/* Conflict */}
            <div className="grid gap-1.5 px-0.5">
              <GlassFormLabel>{tr('conflict', '同名字段冲突')}</GlassFormLabel>
              <GlassOperatorSelect
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
                className="h-7 text-[12px] [&>span]:text-left"
              />
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
                  className="w-full"
                  style={{ height: '1.75rem' }}
                />
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
          <div className="flex max-h-full w-[520px] flex-col rounded-xl border border-border-subtle bg-[var(--glass-card-strong)] shadow-card backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-border-muted/50 px-4 py-3">
              <h3 className="text-[13px] font-semibold text-text-primary">
                {tr('selectKeepFields', '选择保留字段')}
              </h3>
            </div>
            <div className="flex gap-4 overflow-y-auto p-4">
              {/* Left table fields */}
              <div className="flex-1">
                <h4 className="mb-2 text-[12px] font-medium text-text-secondary">
                  {leftSourceLabel || tr('leftInput', '左表')}
                </h4>
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
                    const qualified = `${leftAlias}.${f}`;
                    return (
                      <label
                        key={f}
                        className="flex cursor-pointer items-center gap-1.5 text-[12px] text-text-primary"
                      >
                        <input
                          type="checkbox"
                          checked={draftLeftSel.has(qualified)}
                          onChange={() => toggleDraftLeftField(qualified)}
                          className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
                        />
                        <span className="truncate">{f}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              {/* Right table fields */}
              <div className="flex-1">
                <h4 className="mb-2 text-[12px] font-medium text-text-secondary">
                  {rightSourceLabel || tr('rightInput', '右表')}
                </h4>
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
                    const qualified = `${rightAlias}.${f}`;
                    return (
                      <label
                        key={f}
                        className="flex cursor-pointer items-center gap-1.5 text-[12px] text-text-primary"
                      >
                        <input
                          type="checkbox"
                          checked={draftRightSel.has(qualified)}
                          onChange={() => toggleDraftRightField(qualified)}
                          className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
                        />
                        <span className="truncate">{f}</span>
                      </label>
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
