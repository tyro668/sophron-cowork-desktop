import { useCallback, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassConditionEditor, type ConditionEntry } from './shared/GlassConditionEditor';

const JOIN_TYPES = [
  { value: 'inner', label: '内连接' },
  { value: 'left', label: '左连接' },
  { value: 'right', label: '右连接' },
  { value: 'full', label: '全连接' },
  { value: 'cross', label: '交叉' },
  { value: 'semi', label: '半连接' },
  { value: 'anti', label: '反连接' },
  { value: 'asof', label: '时间近邻' },
];

const CARDINALITY_OPTIONS = [
  { value: '', label: '不限制' },
  { value: 'one_to_one', label: '一对一' },
  { value: 'one_to_many', label: '一对多' },
  { value: 'many_to_one', label: '多对一' },
  { value: 'many_to_many', label: '多对多' },
];

const SELECT_CLASS =
  'h-7 rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-secondary outline-none focus:border-accent';

export default function FormJoin({ node, otherNodes, onNodeChange }: OperatorFormProps) {
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

  const [showAdvanced, setShowAdvanced] = useState(false);

  const joinType = (node.config.joinType as string) ?? 'left';
  const rightInput = (node.config.rightInput as string) ?? '';
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
  const inputSourceNodes = otherNodes.filter((n) => n.type === 'input_source');

  function handleRightInputChange(value: string) {
    const sourceNode = otherNodes.find((n) => n.id === value);
    const alias = (sourceNode?.config?.alias as string) || sourceNode?.label || '';
    updateConfig((cfg) => ({
      ...cfg,
      rightInput: alias || undefined,
      rightAlias: alias || undefined,
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

  return (
    <div className="grid content-start gap-2.5">
      {/* Join type + Right input in one row */}
      <GlassFormSection>
        <div className="grid gap-2">
          {/* Join type toggle buttons */}
          <div>
            <GlassFormLabel>连接类型</GlassFormLabel>
            <div className="flex flex-wrap gap-1">
              {JOIN_TYPES.map((j) => (
                <button
                  key={j.value}
                  type="button"
                  onClick={() =>
                    updateConfig((cfg) => ({
                      ...cfg,
                      joinType: j.value,
                      conditions: j.value === 'cross' ? undefined : cfg.conditions,
                      asof: j.value === 'asof' ? (cfg.asof ?? {}) : undefined,
                    }))
                  }
                  className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                    joinType === j.value
                      ? 'bg-accent/10 text-accent border border-accent/30'
                      : 'border border-border-muted bg-background/42 text-text-secondary hover:border-accent/30'
                  }`}
                >
                  {j.label}
                </button>
              ))}
            </div>
          </div>

          {/* Right input */}
          <div>
            <GlassFormLabel>右侧输入源</GlassFormLabel>
            <select
              value={rightInput}
              onChange={(e) => handleRightInputChange(e.target.value)}
              className={SELECT_CLASS + ' w-full'}
            >
              <option value="" disabled>
                选择输入源
              </option>
              {inputSourceNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </GlassFormSection>

      {/* Conditions (non-cross, non-asof) */}
      {needsConditions && !isAsof && (
        <GlassFormSection title="连接条件">
          <GlassConditionEditor
            conditions={conditions}
            leftFieldCompletions={[]}
            rightFieldCompletions={[]}
            onChange={(next) =>
              updateConfig((cfg) => ({ ...cfg, conditions: next.length > 0 ? next : undefined }))
            }
            leftLabel="左字段 (如 orders.customer_id)"
            rightLabel="右字段 (如 customers.customer_id)"
          />
        </GlassFormSection>
      )}

      {/* ASOF */}
      {isAsof && (
        <GlassFormSection title="时间近邻 (ASOF)">
          <div className="grid gap-2">
            <div className="grid grid-cols-3 gap-1.5">
              <GlassFormTextInput
                value={asofLeftTime}
                onChange={(v) => handleAsofChange({ leftTime: v || undefined })}
                placeholder="左时间列"
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
                placeholder="右时间列"
                className="h-7"
              />
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <GlassFormTextInput
                value={asofTolerance}
                onChange={(v) => handleAsofChange({ tolerance: v || undefined })}
                placeholder="容忍窗口，如 1d"
                className="h-7"
              />
              <select
                value={asofDirection}
                onChange={(e) => handleAsofChange({ direction: e.target.value || undefined })}
                className={SELECT_CLASS}
              >
                <option value="">方向：默认</option>
                <option value="backward">backward</option>
                <option value="forward">forward</option>
                <option value="nearest">nearest</option>
              </select>
            </div>
            <GlassConditionEditor
              conditions={asofBy}
              leftFieldCompletions={[]}
              rightFieldCompletions={[]}
              onChange={(next) => handleAsofChange({ by: next.length > 0 ? next : undefined })}
              leftLabel="左字段"
              rightLabel="右字段"
            />
          </div>
        </GlassFormSection>
      )}

      {/* Keep */}
      <GlassFormSection title="保留字段">
        <div className="flex items-center gap-4">
          <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-text-secondary">
            <input
              type="checkbox"
              checked={keepLeftAll}
              onChange={(e) => handleKeepChange(e.target.checked, keepRightAll)}
              className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
            />
            左表全部
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-text-secondary">
            <input
              type="checkbox"
              checked={keepRightAll}
              onChange={(e) => handleKeepChange(keepLeftAll, e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
            />
            右表全部
          </label>
        </div>
      </GlassFormSection>

      {/* Advanced */}
      <button
        type="button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-text-muted hover:text-text-secondary transition-colors"
      >
        {showAdvanced ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        高级选项
      </button>

      {showAdvanced && (
        <div className="grid content-start gap-2.5">
          <GlassFormSection title="基数约束">
            <select
              value={cardinality}
              onChange={(e) =>
                updateConfig((cfg) => ({ ...cfg, cardinality: e.target.value || undefined }))
              }
              className={SELECT_CLASS + ' w-full'}
            >
              {CARDINALITY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </GlassFormSection>

          <GlassFormSection title="同名字段冲突">
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
                <option value="right_prefix">右表字段加前缀</option>
                <option value="suffix">按表名加后缀</option>
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
                  placeholder="前缀，如 customers_"
                  className="h-7"
                />
              )}
            </div>
          </GlassFormSection>
        </div>
      )}
    </div>
  );
}
