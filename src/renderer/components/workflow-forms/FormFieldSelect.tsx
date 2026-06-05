import { useCallback } from 'react';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { GlassColumnSelector } from './shared/GlassColumnSelector';

export default function FormFieldSelect({
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

  const mode = (node.config.mode as string) ?? 'include';
  const columns: string[] = (node.config.columns as string[]) ?? [];

  return (
    <div className="grid content-start gap-2.5">
      <GlassFormSection title="字段选择模式">
        <GlassFormLabel required>模式</GlassFormLabel>
        <div className="flex gap-1.5">
          {(['include', 'exclude'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => updateConfig((cfg) => ({ ...cfg, mode: m }))}
              className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
                mode === m
                  ? 'bg-accent/10 text-accent border border-accent/30'
                  : 'border border-border-muted bg-background/42 text-text-secondary hover:border-accent/30'
              }`}
            >
              {m === 'include' ? '保留 (select)' : '排除 (drop)'}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[10px] text-text-muted">
          {mode === 'include'
            ? '只保留选中的字段，其他字段将被删除。'
            : '排除选中的字段，其他字段将被保留。'}
        </p>
      </GlassFormSection>

      <GlassFormSection title={mode === 'include' ? '保留的字段' : '排除的字段'}>
        <GlassColumnSelector
          columns={fieldCompletions}
          selected={columns}
          onChange={(next) =>
            updateConfig((cfg) => ({ ...cfg, columns: next.length > 0 ? next : undefined }))
          }
        />
      </GlassFormSection>
    </div>
  );
}
