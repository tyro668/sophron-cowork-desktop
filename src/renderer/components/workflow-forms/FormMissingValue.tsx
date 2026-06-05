import { useCallback } from 'react';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassListEditor } from './shared/GlassListEditor';

const METHOD_OPTIONS = [
  { value: 'skip', label: '不处理' },
  { value: 'nullify_values', label: '特殊值转空' },
  { value: 'literal_fill', label: '固定值填充' },
  { value: 'forward_fill', label: '前向填充' },
  { value: 'backward_fill', label: '后向填充' },
  { value: 'mean_fill', label: '均值填充' },
  { value: 'median_fill', label: '中位数填充' },
  { value: 'mode_fill', label: '众数填充' },
  { value: 'drop', label: '删除含缺失的行' },
];

const STRATEGY_OPTIONS = [
  { value: 'by_column', label: '按列处理' },
  { value: 'drop_empty_rows', label: '删除全空行' },
  { value: 'drop_rows_by_nulls', label: '关键字段缺失则删除行' },
];

interface MissingRule {
  column: string;
  method: string;
  values?: string[];
  value?: unknown;
}

function createDefault(): MissingRule {
  return { column: '', method: 'literal_fill', value: '' };
}

export default function FormMissingValue({
  node,
  fieldCompletions,
  onNodeChange,
}: OperatorFormProps) {
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

  const strategy = (node.config.strategy as string) ?? 'by_column';
  const rules: MissingRule[] = (node.config.rules as MissingRule[]) ?? [];
  const condition = (node.config.condition as string) ?? 'all_null';
  const conditionColumns: string[] = (node.config.columns as string[]) ?? [];

  function handleRulesChange(items: MissingRule[]) {
    updateConfig((cfg) => ({ ...cfg, rules: items.length > 0 ? items : undefined }));
  }

  return (
    <div className="grid content-start gap-2.5">
      <GlassFormSection title="处理策略">
        <GlassFormLabel required>策略</GlassFormLabel>
        <select
          value={strategy}
          onChange={(e) =>
            updateConfig((cfg) => ({
              ...cfg,
              strategy: e.target.value,
              rules: undefined,
              condition: undefined,
              columns: undefined,
            }))
          }
          className="h-7 w-full rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-secondary outline-none focus:border-accent"
        >
          {STRATEGY_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </GlassFormSection>

      {strategy === 'drop_empty_rows' && (
        <GlassFormSection title="全空行删除">
          <div className="rounded-lg border border-border-muted bg-background/42 px-3 py-2.5 text-[12px] text-text-secondary">
            所有字段均为空 (null) 的行将被自动删除。
          </div>
        </GlassFormSection>
      )}

      {strategy === 'drop_rows_by_nulls' && (
        <GlassFormSection title="关键字段缺失删除">
          <div className="grid gap-2">
            <div>
              <GlassFormLabel>条件</GlassFormLabel>
              <div className="flex gap-1.5">
                {(['all_null', 'any_null'] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => updateConfig((cfg) => ({ ...cfg, condition: c }))}
                    className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
                      condition === c
                        ? 'bg-accent/10 text-accent border border-accent/30'
                        : 'border border-border-muted bg-background/42 text-text-secondary hover:border-accent/30'
                    }`}
                  >
                    {c === 'all_null' ? '全部为空' : '任一为空'}
                  </button>
                ))}
              </div>
            </div>
            {condition === 'any_null' && (
              <div>
                <GlassFormLabel>关键字段</GlassFormLabel>
                <div className="rounded-lg border border-border-muted bg-background/42 p-1.5">
                  {fieldCompletions.map((col) => (
                    <label
                      key={col}
                      className="flex cursor-pointer items-center gap-2 px-1.5 py-1 text-[12px] text-text-secondary hover:bg-surface-hover rounded"
                    >
                      <input
                        type="checkbox"
                        checked={conditionColumns.includes(col)}
                        onChange={() => {
                          const next = conditionColumns.includes(col)
                            ? conditionColumns.filter((c) => c !== col)
                            : [...conditionColumns, col];
                          updateConfig((cfg) => ({
                            ...cfg,
                            columns: next.length > 0 ? next : undefined,
                          }));
                        }}
                        className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
                      />
                      {col}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </GlassFormSection>
      )}

      {strategy === 'by_column' && (
        <GlassFormSection title="按列处理规则">
          <GlassFormLabel>处理规则（按 DSL 顺序执行）</GlassFormLabel>
          <GlassListEditor
            items={rules}
            renderRow={(item, _index, onChange) => (
              <div className="grid gap-1.5">
                <div className="grid grid-cols-2 gap-1.5">
                  <div>
                    <GlassFormLabel>字段</GlassFormLabel>
                    <select
                      value={item.column}
                      onChange={(e) => onChange({ ...item, column: e.target.value })}
                      className="h-7 w-full rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-primary outline-none focus:border-accent"
                    >
                      <option value="" disabled>
                        选择字段
                      </option>
                      {fieldCompletions.map((col) => (
                        <option key={col} value={col}>
                          {col}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <GlassFormLabel>处理方法</GlassFormLabel>
                    <select
                      value={item.method}
                      onChange={(e) => {
                        const nextMethod = e.target.value;
                        onChange({
                          ...item,
                          method: nextMethod,
                          values: nextMethod === 'nullify_values' ? (item.values ?? []) : undefined,
                          value: nextMethod === 'literal_fill' ? (item.value ?? '') : undefined,
                        });
                      }}
                      className="h-7 w-full rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-secondary outline-none focus:border-accent"
                    >
                      {METHOD_OPTIONS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {item.method === 'nullify_values' && (
                  <div>
                    <GlassFormLabel>转空的特殊值（用逗号分隔）</GlassFormLabel>
                    <GlassFormTextInput
                      value={(item.values ?? []).join(', ')}
                      onChange={(value) => {
                        const vals = value
                          .split(',')
                          .map((v) => v.trim().replace(/^"|"$/g, ''))
                          .filter(Boolean);
                        onChange({ ...item, values: vals.length > 0 ? vals : undefined });
                      }}
                      placeholder={'如 "", N/A, -'}
                      className="h-7"
                    />
                  </div>
                )}
                {item.method === 'literal_fill' && (
                  <div>
                    <GlassFormLabel>填充值</GlassFormLabel>
                    <GlassFormTextInput
                      value={String(item.value ?? '')}
                      onChange={(value) => onChange({ ...item, value: value || undefined })}
                      placeholder={'如 UNKNOWN 或 0'}
                      className="h-7"
                    />
                  </div>
                )}
              </div>
            )}
            createDefault={createDefault}
            onChange={handleRulesChange}
            addLabel="添加规则"
            emptyText="暂无处理规则"
          />
          <p className="mt-2 text-[10px] leading-relaxed text-text-muted">
            同一字段允许多条规则，按列表顺序执行。例如先「特殊值转空」再「固定值填充」。
            均值/中位数/众数填充仅适用于数值字段。前向/后向填充需要上游有排序。
          </p>
        </GlassFormSection>
      )}
    </div>
  );
}
