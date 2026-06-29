import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DataWorkflowOperatorType } from '../../types';
import type { OperatorFormProps } from './index';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassOperatorSelect } from './shared/GlassOperatorSelect';
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

  const joinTypeGroups = useMemo(
    () => [{ key: 'types', items: joinTypeOptions }],
    [joinTypeOptions]
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

  const specificCount = useMemo(() => keepItems.filter((i) => !i.wildcard).length, [keepItems]);

  // ── Condition dialog state ──
  const [condDialogOpen, setCondDialogOpen] = useState(false);
  const [draftConditions, setDraftConditions] = useState<ConditionEntry[]>([]);
  const [draftAsof, setDraftAsof] = useState<Record<string, unknown>>({});

  function openCondDialog() {
    if (isAsof) {
      setDraftAsof({ ...asof });
    } else {
      setDraftConditions([...conditions]);
    }
    setCondDialogOpen(true);
  }

  function confirmCondDialog() {
    if (isAsof) {
      updateConfig((cfg) => ({
        ...cfg,
        asof: { ...((cfg.asof as Record<string, unknown>) ?? {}), ...draftAsof },
      }));
    } else {
      const next = draftConditions.filter((c) => c.left && c.right);
      updateConfig((cfg) => ({ ...cfg, conditions: next.length > 0 ? next : undefined }));
    }
    setCondDialogOpen(false);
  }

  function cancelCondDialog() {
    setCondDialogOpen(false);
  }

  // ── Condition summary text ──
  const condSummary = useMemo(() => {
    if (!needsConditions) return tr('noConditionsNeeded', '无需连接条件');
    if (isAsof) {
      const left = asofLeftTime || '?';
      const right = asofRightTime || '?';
      return `ASOF: [${left}] ${asofOperator} [${right}]`;
    }
    if (conditions.length === 0) return tr('noConditions', '暂无连接条件');
    const first = conditions[0];
    return `${conditions.length} ${conditions.length > 1 ? tr('conditions', '个条件') : '个条件'}: [${first.left}] = [${first.right}]`;
  }, [needsConditions, isAsof, asofLeftTime, asofOperator, asofRightTime, conditions, tr]);

  const readOnlyClasses =
    'flex h-7 items-center rounded-md border border-border-muted bg-background/28 px-2 text-[12px] text-text-muted';

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
      <div className="flex items-stretch gap-0">
        {/* ═══ 步骤1: 数据源 ═══ */}
        <div className="flex-1 flex flex-col gap-2">
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
          <div className="flex-1 rounded-lg border border-border-muted bg-background/42">
            <div className="p-3 grid gap-2.5">
              <div className="grid gap-1">
                <GlassFormLabel>{tr('leftInput', '左数据源')}</GlassFormLabel>
                <div className={readOnlyClasses}>
                  {leftSourceLabel || tr('noLeftSource', '上游节点')}
                </div>
              </div>
              <div className="grid gap-1">
                <GlassFormLabel>{tr('rightInput', '右侧输入源')}</GlassFormLabel>
                <div className={readOnlyClasses}>
                  {rightSourceLabel || tr('noRightSource', '未连接右表')}
                </div>
              </div>
              <div className="grid gap-1">
                <GlassFormLabel>{tr('joinType', '连接类型')}</GlassFormLabel>
                <GlassOperatorSelect
                  value={joinType}
                  groups={joinTypeGroups}
                  onChange={(v) => handleJoinTypeChange(v)}
                  className="h-7 text-[12px] [&>span]:text-left"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Arrow */}
        <div className="flex items-start pt-[12px] px-2">
          <span className="text-text-muted font-bold text-base leading-none">❯</span>
        </div>

        {/* ═══ 步骤2: 连接条件 ═══ */}
        <div className="flex-1 flex flex-col gap-2">
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
          <div className="flex-1 rounded-lg border border-border-muted bg-background/42">
            <div className="p-3 grid gap-2.5">
              {rightSourceLabel && rightColumnsError && !isAsof && (
                <div className="text-[11px] text-warning">
                  {tr('rightColumnsFailed', '无法获取右表字段，请手动输入')}
                </div>
              )}
              <div className="text-[12px] text-text-secondary leading-relaxed min-h-[2.5rem]">
                {condSummary}
              </div>
              <button
                type="button"
                onClick={openCondDialog}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-border-muted bg-background/42 px-2 text-[11px] text-text-secondary hover:border-accent/30 hover:text-accent transition-colors self-start"
              >
                {tr('editConditions', '编辑条件')}
              </button>
            </div>
          </div>
        </div>

        {/* Arrow */}
        <div className="flex items-start pt-[12px] px-2">
          <span className="text-text-muted font-bold text-base leading-none">❯</span>
        </div>

        {/* ═══ 步骤3: 配置 ═══ */}
        <div className="flex-1 flex flex-col gap-2">
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
          <div className="flex-1 rounded-lg border border-border-muted bg-background/42">
            <div className="p-3 grid gap-3">
              {/* Keep fields */}
              <div className="grid gap-1.5">
                <GlassFormLabel>{tr('keepFields', '保留字段')}</GlassFormLabel>
                <GlassOperatorSelect
                  value={draftKeepAll ? 'all' : 'custom'}
                  groups={[
                    {
                      key: 'keep',
                      items: [
                        { value: 'all', label: tr('keepModeAll', '全部保留') },
                        { value: 'custom', label: tr('keepModeCustom', '自定义选择') },
                      ],
                    },
                  ]}
                  onChange={(v) => {
                    const isAll = v === 'all';
                    setDraftKeepAll(isAll);
                    if (isAll) {
                      handleKeepChange([
                        { side: 'left', wildcard: true },
                        { side: 'right', wildcard: true },
                      ]);
                    }
                  }}
                  className="h-7 text-[12px] [&>span]:text-left"
                />
                {!draftKeepAll && (
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-text-muted">
                      {specificCount > 0
                        ? `${tr('keepFieldsCount', '已选')} ${specificCount} ${tr('keepFieldsCountSuffix', '个字段')}`
                        : tr('noFieldsSelected', '未选择字段')}
                    </span>
                    <button
                      type="button"
                      onClick={openKeepDialog}
                      className="text-[11px] text-accent hover:underline"
                    >
                      {tr('adjustKeepFields', '调整选择')}
                    </button>
                  </div>
                )}
              </div>

              <hr className="border-border-muted/50" />

              {/* Cardinality */}
              <div className="grid gap-1">
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
              <div className="grid gap-1.5">
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
                    className="h-7"
                  />
                )}
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
                  {tr('selectAll', '全部')}
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
                  {tr('selectAll', '全部')}
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

      {/* ═══ Condition dialog ═══ */}
      {condDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/28 px-4 py-6"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) cancelCondDialog();
          }}
        >
          <div className="flex max-h-full w-[640px] flex-col rounded-xl border border-border-subtle bg-[var(--glass-card-strong)] shadow-card backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-border-muted/50 px-4 py-3">
              <h3 className="text-[13px] font-semibold text-text-primary">
                {isAsof ? 'ASOF' : tr('conditions', '连接条件')}
              </h3>
            </div>
            <div className="overflow-y-auto p-4">
              {isAsof ? (
                <div className="grid gap-3">
                  <div className="grid grid-cols-3 gap-1.5">
                    <GlassFormTextInput
                      value={(draftAsof.leftTime as string) ?? ''}
                      onChange={(v) =>
                        setDraftAsof((prev) => ({ ...prev, leftTime: v || undefined }))
                      }
                      placeholder={tr('leftTimeCol', '左时间列')}
                      className="h-7"
                    />
                    <GlassOperatorSelect
                      value={(draftAsof.operator as string) ?? '>='}
                      groups={[
                        {
                          key: 'op',
                          items: [
                            { value: '>=', label: '>= (backward)' },
                            { value: '<=', label: '<= (forward)' },
                            { value: 'nearest', label: 'nearest' },
                          ],
                        },
                      ]}
                      onChange={(v) => setDraftAsof((prev) => ({ ...prev, operator: v }))}
                      className="h-7 text-[12px] [&>span]:text-left"
                    />
                    <GlassFormTextInput
                      value={(draftAsof.rightTime as string) ?? ''}
                      onChange={(v) =>
                        setDraftAsof((prev) => ({ ...prev, rightTime: v || undefined }))
                      }
                      placeholder={tr('rightTimeCol', '右时间列')}
                      className="h-7"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <GlassFormTextInput
                      value={(draftAsof.tolerance as string) ?? ''}
                      onChange={(v) =>
                        setDraftAsof((prev) => ({ ...prev, tolerance: v || undefined }))
                      }
                      placeholder={tr('tolerance', '容忍窗口，如 1d')}
                      className="h-7"
                    />
                    <GlassOperatorSelect
                      value={(draftAsof.direction as string) ?? ''}
                      groups={[
                        {
                          key: 'dir',
                          items: [
                            { value: '', label: tr('directionDefault', '方向：默认') },
                            { value: 'backward', label: 'backward' },
                            { value: 'forward', label: 'forward' },
                            { value: 'nearest', label: 'nearest' },
                          ],
                        },
                      ]}
                      onChange={(v) =>
                        setDraftAsof((prev) => ({ ...prev, direction: v || undefined }))
                      }
                      className="h-7 text-[12px] [&>span]:text-left"
                    />
                  </div>
                  <GlassConditionEditor
                    conditions={(draftAsof.by as ConditionEntry[]) ?? []}
                    leftFieldCompletions={leftFieldCompletions}
                    rightFieldCompletions={rightFieldCompletions}
                    onChange={(next) =>
                      setDraftAsof((prev) => ({ ...prev, by: next.length > 0 ? next : undefined }))
                    }
                    leftLabel={tr('leftField', '[左字段]')}
                    rightLabel={tr('rightField', '[右表].[字段]')}
                  />
                </div>
              ) : (
                <GlassConditionEditor
                  conditions={draftConditions}
                  leftFieldCompletions={leftFieldCompletions}
                  rightFieldCompletions={rightFieldCompletions}
                  onChange={setDraftConditions}
                  leftLabel={tr('leftField', '[左字段]')}
                  rightLabel={tr('rightField', '[右表].[字段]')}
                />
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-border-muted/50 px-4 py-3">
              <button
                type="button"
                onClick={cancelCondDialog}
                className="rounded-md border border-border-muted bg-background/42 px-3 py-1 text-[12px] text-text-secondary hover:border-accent/30 hover:text-accent transition-colors"
              >
                {tr('cancel', '取消')}
              </button>
              <button
                type="button"
                onClick={confirmCondDialog}
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
