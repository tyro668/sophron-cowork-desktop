import { useCallback, useState } from 'react';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassConditionEditor, type ConditionEntry } from './shared/GlassConditionEditor';
import { ChevronDown, ChevronRight } from 'lucide-react';

const JOIN_TYPES = [
  { value: 'inner', label: 'INNER — 内连接' },
  { value: 'left', label: 'LEFT — 左连接' },
  { value: 'right', label: 'RIGHT — 右连接' },
  { value: 'full', label: 'FULL — 全连接' },
  { value: 'cross', label: 'CROSS — 交叉连接' },
  { value: 'semi', label: 'SEMI — 半连接' },
  { value: 'anti', label: 'ANTI — 反连接' },
  { value: 'asof', label: 'ASOF — 时间近邻连接' },
];

const CARDINALITY_OPTIONS = [
  { value: '', label: '不限制' },
  { value: 'one_to_one', label: '一对一' },
  { value: 'one_to_many', label: '一对多' },
  { value: 'many_to_one', label: '多对一' },
  { value: 'many_to_many', label: '多对多' },
];

const ASOF_DIRECTIONS = [
  { value: '', label: '默认' },
  { value: 'backward', label: 'backward — 向后' },
  { value: 'forward', label: 'forward — 向前' },
  { value: 'nearest', label: 'nearest — 最近' },
];

const ASOF_OPERATORS = [
  { value: '>=', label: '>= (backward)' },
  { value: '<=', label: '<= (forward)' },
  { value: 'nearest', label: 'nearest' },
];

interface KeepItem {
  side?: 'left' | 'right';
  wildcard?: boolean;
  source?: string;
  alias?: string;
}

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
  const keepItems: KeepItem[] = (node.config.keep as KeepItem[]) ?? [];
  const keepLeftAll = keepItems.some((k) => k.side === 'left' && k.wildcard);
  const keepRightAll = keepItems.some((k) => k.side === 'right' && k.wildcard);
  const keepSelections = keepItems.filter((k) => !k.wildcard);

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
    const node = otherNodes.find((n) => n.id === value);
    updateConfig((cfg) => ({
      ...cfg,
      rightInput: value || undefined,
      rightAlias: node?.label || value ? (node?.label ?? value) : undefined,
    }));
  }

  function handleKeepChange(leftAll: boolean, rightAll: boolean, selections: KeepItem[]) {
    const items: KeepItem[] = [];
    if (leftAll) items.push({ side: 'left', wildcard: true });
    if (rightAll) items.push({ side: 'right', wildcard: true });
    items.push(...selections);
    updateConfig((cfg) => ({
      ...cfg,
      keep: items.length > 0 ? items : undefined,
    }));
  }

  function handleAsofChange(patch: Record<string, unknown>) {
    updateConfig((cfg) => ({
      ...cfg,
      asof: { ...((cfg.asof as Record<string, unknown>) ?? {}), ...patch },
    }));
  }

  return (
    <div className="grid content-start gap-2.5">
      <GlassFormSection title="连接类型">
        <GlassFormLabel required>类型</GlassFormLabel>
        <select
          value={joinType}
          onChange={(e) => {
            const nextType = e.target.value;
            updateConfig((cfg) => ({
              ...cfg,
              joinType: nextType,
              conditions: nextType === 'cross' ? undefined : cfg.conditions,
              asof: nextType === 'asof' ? (cfg.asof ?? {}) : undefined,
            }));
          }}
          className="h-7 w-full rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-secondary outline-none focus:border-accent"
        >
          {JOIN_TYPES.map((j) => (
            <option key={j.value} value={j.value}>
              {j.label}
            </option>
          ))}
        </select>
      </GlassFormSection>

      <GlassFormSection title="右表">
        <GlassFormLabel required>右侧输入源</GlassFormLabel>
        <select
          value={rightInput}
          onChange={(e) => handleRightInputChange(e.target.value)}
          className="h-7 w-full rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-primary outline-none focus:border-accent"
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
      </GlassFormSection>

      {needsConditions && !isAsof && (
        <GlassFormSection title="连接条件">
          <GlassConditionEditor
            conditions={conditions}
            leftFieldCompletions={[]}
            rightFieldCompletions={[]}
            onChange={(next) =>
              updateConfig((cfg) => ({
                ...cfg,
                conditions: next.length > 0 ? next : undefined,
              }))
            }
            leftLabel="左字段 (如 orders.customer_id)"
            rightLabel="右字段 (如 customers.customer_id)"
          />
          <p className="mt-1 text-[10px] text-text-muted">
            连接条件中的字段建议写成 [表名].[字段名] 格式避免歧义。
          </p>
        </GlassFormSection>
      )}

      {isAsof && (
        <GlassFormSection title="ASOF 时间近邻">
          <div className="grid gap-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <GlassFormLabel required>左时间字段</GlassFormLabel>
                <GlassFormTextInput
                  value={asofLeftTime}
                  onChange={(value) => handleAsofChange({ leftTime: value || undefined })}
                  placeholder="如 trades.trade_time"
                  className="h-7"
                />
              </div>
              <div>
                <GlassFormLabel required>右时间字段</GlassFormLabel>
                <GlassFormTextInput
                  value={asofRightTime}
                  onChange={(value) => handleAsofChange({ rightTime: value || undefined })}
                  placeholder="如 rates.rate_time"
                  className="h-7"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <GlassFormLabel>操作符</GlassFormLabel>
                <select
                  value={asofOperator}
                  onChange={(e) => handleAsofChange({ operator: e.target.value })}
                  className="h-7 w-full rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-secondary outline-none focus:border-accent"
                >
                  {ASOF_OPERATORS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <GlassFormLabel>匹配方向</GlassFormLabel>
                <select
                  value={asofDirection}
                  onChange={(e) => handleAsofChange({ direction: e.target.value || undefined })}
                  className="h-7 w-full rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-secondary outline-none focus:border-accent"
                >
                  {ASOF_DIRECTIONS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <GlassFormLabel>容忍窗口 (tolerance)</GlassFormLabel>
              <GlassFormTextInput
                value={asofTolerance}
                onChange={(value) => handleAsofChange({ tolerance: value || undefined })}
                placeholder={'如 1d, 6h, 30m'}
                className="h-7"
              />
            </div>
            <div>
              <GlassFormLabel>分组匹配键 (by) — ASOF 的额外等值条件</GlassFormLabel>
              <GlassConditionEditor
                conditions={asofBy}
                leftFieldCompletions={[]}
                rightFieldCompletions={[]}
                onChange={(next) => handleAsofChange({ by: next.length > 0 ? next : undefined })}
                leftLabel="左字段"
                rightLabel="右字段"
              />
            </div>
          </div>
        </GlassFormSection>
      )}

      <GlassFormSection title="保留字段 (keep)">
        <div className="grid gap-2">
          <div className="flex items-center gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-text-secondary">
              <input
                type="checkbox"
                checked={keepLeftAll}
                onChange={(e) => handleKeepChange(e.target.checked, keepRightAll, keepSelections)}
                className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
              />
              保留左表全部字段
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-text-secondary">
              <input
                type="checkbox"
                checked={keepRightAll}
                onChange={(e) => handleKeepChange(keepLeftAll, e.target.checked, keepSelections)}
                className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
              />
              保留右表全部字段
            </label>
          </div>
          <p className="text-[10px] text-text-muted">
            未勾选任何字段时默认保留左右表全部字段，同名字段自动处理冲突。
          </p>
        </div>
      </GlassFormSection>

      {/* Advanced options */}
      <div>
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
          <div className="mt-2 grid content-start gap-2.5">
            <GlassFormSection title="基数约束 (cardinality)">
              <select
                value={cardinality}
                onChange={(e) =>
                  updateConfig((cfg) => ({
                    ...cfg,
                    cardinality: e.target.value || undefined,
                  }))
                }
                className="h-7 w-full rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-secondary outline-none focus:border-accent"
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
                <div>
                  <GlassFormLabel>冲突策略</GlassFormLabel>
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
                    className="h-7 w-full rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-secondary outline-none focus:border-accent"
                  >
                    <option value="right_prefix">右表字段加前缀</option>
                    <option value="suffix">按表名加后缀</option>
                  </select>
                </div>
                {conflictStrategy === 'right_prefix' && (
                  <div>
                    <GlassFormLabel>右表前缀</GlassFormLabel>
                    <GlassFormTextInput
                      value={rightPrefix}
                      onChange={(value) =>
                        updateConfig((cfg) => ({
                          ...cfg,
                          conflict: {
                            ...((cfg.conflict as Record<string, unknown>) ?? {}),
                            rightPrefix: value || undefined,
                          },
                        }))
                      }
                      placeholder="如 customers_"
                      className="h-7"
                    />
                  </div>
                )}
              </div>
            </GlassFormSection>
          </div>
        )}
      </div>
    </div>
  );
}
