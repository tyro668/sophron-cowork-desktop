import { useCallback } from 'react';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { GlassSortKeyEditor, type SortKeyEntry } from './shared/GlassSortKeyEditor';

export default function FormLimit({ node, fieldCompletions, onNodeChange }: OperatorFormProps) {
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

  const mode = (node.config.mode as string) ?? 'limit';
  const limit = Number(node.config.limit ?? 10);
  const unit = (node.config.unit as string) ?? 'rows';
  const offset = Number(node.config.offset ?? 0);
  const orderBy: SortKeyEntry[] = (node.config.orderBy as SortKeyEntry[]) ?? [];

  return (
    <div className="grid content-start gap-2.5">
      <GlassFormSection title="限制模式">
        <GlassFormLabel required>模式</GlassFormLabel>
        <div className="flex gap-1.5">
          {(['limit', 'top'] as const).map((m) => (
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
              {m === 'limit' ? 'Limit' : 'Top'}
            </button>
          ))}
        </div>
      </GlassFormSection>

      <GlassFormSection title="行数设置">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <GlassFormLabel>行数</GlassFormLabel>
            <input
              type="number"
              value={limit}
              onChange={(e) =>
                updateConfig((cfg) => ({ ...cfg, limit: Math.max(1, Number(e.target.value)) }))
              }
              min={1}
              className="h-7 w-full rounded-md border border-border-muted bg-background/42 px-2 text-[12px] text-text-primary outline-none focus:border-accent"
            />
          </div>
          {mode === 'limit' && (
            <>
              <div>
                <GlassFormLabel>单位</GlassFormLabel>
                <select
                  value={unit}
                  onChange={(e) => updateConfig((cfg) => ({ ...cfg, unit: e.target.value }))}
                  className="h-7 w-full rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-secondary outline-none focus:border-accent"
                >
                  <option value="rows">行数</option>
                  <option value="percent">百分比</option>
                </select>
              </div>
              <div>
                <GlassFormLabel>偏移量 (offset)</GlassFormLabel>
                <input
                  type="number"
                  value={offset}
                  onChange={(e) =>
                    updateConfig((cfg) => ({
                      ...cfg,
                      offset: Math.max(0, Number(e.target.value)) || undefined,
                    }))
                  }
                  min={0}
                  className="h-7 w-full rounded-md border border-border-muted bg-background/42 px-2 text-[12px] text-text-primary outline-none focus:border-accent"
                />
              </div>
            </>
          )}
        </div>
      </GlassFormSection>

      {mode === 'top' && (
        <GlassFormSection title="Top 排序">
          <GlassSortKeyEditor
            keys={orderBy}
            fieldCompletions={fieldCompletions}
            onChange={(keys) =>
              updateConfig((cfg) => ({ ...cfg, orderBy: keys.length > 0 ? keys : undefined }))
            }
          />
        </GlassFormSection>
      )}
    </div>
  );
}
