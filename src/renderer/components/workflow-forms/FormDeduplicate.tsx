import { useCallback } from 'react';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { GlassColumnSelector } from './shared/GlassColumnSelector';
import { GlassSortKeyEditor, type SortKeyEntry } from './shared/GlassSortKeyEditor';

export default function FormDeduplicate({
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

  const strategy = (node.config.strategy as string) ?? 'by_columns';
  const columns: string[] = (node.config.columns as string[]) ?? [];
  const keep = (node.config.keep as string) ?? 'first';
  const orderBy: SortKeyEntry[] = (node.config.orderBy as SortKeyEntry[]) ?? [];

  return (
    <div className="grid content-start gap-2.5">
      <GlassFormSection title="去重范围">
        <GlassFormLabel required>策略</GlassFormLabel>
        <div className="flex gap-1.5">
          {(['by_columns', 'all_columns'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => updateConfig((cfg) => ({ ...cfg, strategy: s }))}
              className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
                strategy === s
                  ? 'bg-accent/10 text-accent border border-accent/30'
                  : 'border border-border-muted bg-background/42 text-text-secondary hover:border-accent/30'
              }`}
            >
              {s === 'all_columns' ? '全字段' : '按字段'}
            </button>
          ))}
        </div>
      </GlassFormSection>

      {strategy === 'by_columns' && (
        <GlassFormSection title="去重字段">
          <GlassColumnSelector
            columns={fieldCompletions}
            selected={columns}
            onChange={(next) =>
              updateConfig((cfg) => ({ ...cfg, columns: next.length > 0 ? next : undefined }))
            }
          />
        </GlassFormSection>
      )}

      <GlassFormSection title="保留规则">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <GlassFormLabel>保留</GlassFormLabel>
            <select
              value={keep}
              onChange={(e) => updateConfig((cfg) => ({ ...cfg, keep: e.target.value }))}
              className="h-7 w-full rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-secondary outline-none focus:border-accent"
            >
              <option value="first">第一条</option>
              <option value="last">最后一条</option>
            </select>
          </div>
        </div>
      </GlassFormSection>

      {keep === 'last' && (
        <GlassFormSection title="排序依据（确定「最后一条」的基准）">
          <GlassSortKeyEditor
            keys={orderBy}
            fieldCompletions={fieldCompletions}
            onChange={(nextKeys) =>
              updateConfig((cfg) => ({
                ...cfg,
                orderBy: nextKeys.length > 0 ? nextKeys : undefined,
              }))
            }
          />
        </GlassFormSection>
      )}
    </div>
  );
}
