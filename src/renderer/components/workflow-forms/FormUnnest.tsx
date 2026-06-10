import { useCallback } from 'react';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { GlassFormTextInput } from './shared/GlassFormTextInput';

export default function FormUnnest({ node, fieldCompletions, onNodeChange }: OperatorFormProps) {
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

  const sourceKind = (node.config.sourceKind as string) ?? 'list';
  const column = String(node.config.column ?? '');
  const alias = String(node.config.alias ?? '');
  const path = String(node.config.path ?? '');
  const withIndex = String(node.config.withIndex ?? '');
  const recursive = Boolean(node.config.recursive ?? false);
  const maxDepth = node.config.maxDepth ? Number(node.config.maxDepth) : undefined;
  const keepParentNames = Boolean(node.config.keepParentNames ?? false);

  return (
    <div className="grid content-start gap-2.5">
      <GlassFormSection title="数据源">
        <GlassFormLabel required>源类型</GlassFormLabel>
        <div className="flex gap-1.5">
          {(['list', 'json'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => updateConfig((cfg) => ({ ...cfg, sourceKind: s }))}
              className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
                sourceKind === s
                  ? 'bg-accent/10 text-accent border border-accent/30'
                  : 'border border-border-muted bg-background/42 text-text-secondary hover:border-accent/30'
              }`}
            >
              {s === 'list' ? 'List' : 'JSON'}
            </button>
          ))}
        </div>
      </GlassFormSection>

      <GlassFormSection title="展开设置">
        <div className="grid gap-2">
          <div>
            <GlassFormLabel required>源字段</GlassFormLabel>
            <select
              value={column}
              onChange={(e) =>
                updateConfig((cfg) => ({ ...cfg, column: e.target.value || undefined }))
              }
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
            <GlassFormLabel required>展开后的别名</GlassFormLabel>
            <GlassFormTextInput
              value={alias}
              onChange={(value) => updateConfig((cfg) => ({ ...cfg, alias: value || undefined }))}
              placeholder="如 item"
              className="h-7"
            />
          </div>
          {sourceKind === 'json' && (
            <div>
              <GlassFormLabel required>JSON 路径</GlassFormLabel>
              <GlassFormTextInput
                value={path}
                onChange={(value) => updateConfig((cfg) => ({ ...cfg, path: value || undefined }))}
                placeholder={'如 $.items'}
                className="h-7"
              />
            </div>
          )}
        </div>
      </GlassFormSection>

      <GlassFormSection title="选项">
        <div className="grid gap-2">
          <div>
            <GlassFormLabel>索引列 (with index)</GlassFormLabel>
            <GlassFormTextInput
              value={withIndex}
              onChange={(value) =>
                updateConfig((cfg) => ({ ...cfg, withIndex: value || undefined }))
              }
              placeholder="如 item_index"
              className="h-7"
            />
          </div>
          <div>
            <GlassFormLabel>最大展开深度</GlassFormLabel>
            <input
              type="number"
              value={maxDepth ?? ''}
              onChange={(e) =>
                updateConfig((cfg) => ({
                  ...cfg,
                  maxDepth: e.target.value ? Number(e.target.value) : undefined,
                }))
              }
              min={1}
              placeholder="不限制"
              className="h-7 w-full rounded-md border border-border-muted bg-background/42 px-2 text-[12px] text-text-primary outline-none focus:border-accent placeholder:text-text-muted"
            />
          </div>
          <div className="flex gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-text-secondary">
              <input
                type="checkbox"
                checked={recursive}
                onChange={(e) =>
                  updateConfig((cfg) => ({
                    ...cfg,
                    recursive: e.target.checked || undefined,
                  }))
                }
                className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
              />
              递归展开
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-text-secondary">
              <input
                type="checkbox"
                checked={keepParentNames}
                onChange={(e) =>
                  updateConfig((cfg) => ({
                    ...cfg,
                    keepParentNames: e.target.checked || undefined,
                  }))
                }
                className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
              />
              保留父字段名
            </label>
          </div>
        </div>
      </GlassFormSection>
    </div>
  );
}
