import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, X } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';
import { GlassColumnSelector } from './shared/GlassColumnSelector';
import { GlassSortKeyEditor, type SortKeyEntry } from './shared/GlassSortKeyEditor';

const TOGGLE_BTN = 'h-6 rounded px-2.5 text-[11px] font-medium transition-colors';

export default function FormDeduplicate({
  node,
  fieldCompletions,
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

  const columns: string[] = (node.config.columns as string[]) ?? [];
  const keep = (node.config.keep as string) ?? 'first';
  const orderBy: SortKeyEntry[] = (node.config.orderBy as SortKeyEntry[]) ?? [];
  const [showFieldPicker, setShowFieldPicker] = useState(false);
  const removingRef = useRef(false);

  const handleColumnsSelect = useCallback(
    (next: string[]) => {
      updateConfig((cfg) => ({
        ...cfg,
        strategy: next.length > 0 ? 'by_columns' : 'all_columns',
        columns: next.length > 0 ? next : undefined,
      }));
    },
    [updateConfig]
  );

  const removeColumn = useCallback(
    (col: string) => {
      if (removingRef.current) return;
      removingRef.current = true;
      updateConfig((cfg) => {
        const next = ((cfg.columns as string[]) ?? []).filter((c) => c !== col);
        return {
          ...cfg,
          strategy: next.length > 0 ? 'by_columns' : 'all_columns',
          columns: next.length > 0 ? next : undefined,
        };
      });
      requestAnimationFrame(() => {
        removingRef.current = false;
      });
    },
    [updateConfig]
  );

  return (
    <div className="grid content-start gap-2.5">
      <GlassFormSection title={tr('dedupTitle', '去重')}>
        <div className="grid gap-2">
          {/* Combobox: tags + text input + dropdown button */}
          <label className="grid gap-1">
            <span className="text-[11px] font-medium text-text-secondary">
              {tr('dedupColumns', '去重字段')}
            </span>
            <div className="flex min-h-8 rounded-md border border-border-muted bg-background/42 focus-within:border-accent">
              <div className="flex flex-1 flex-wrap items-center gap-1 px-1.5 py-1">
                {columns.map((col) => (
                  <span
                    key={col}
                    className="inline-flex items-center gap-0.5 rounded bg-surface-active/80 px-1.5 py-0.5 text-[11px] text-text-primary"
                  >
                    {col}
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        removeColumn(col);
                      }}
                      className="ml-0.5 flex-shrink-0 rounded-full p-0.5 hover:bg-surface-hover transition-colors"
                    >
                      <X className="h-2.5 w-2.5 text-text-muted" />
                    </button>
                  </span>
                ))}
                <input
                  type="text"
                  readOnly
                  placeholder={
                    columns.length === 0 ? tr('dedupSelectPlaceholder', '选择去重字段...') : ''
                  }
                  className="h-5 min-w-[60px] flex-1 bg-transparent text-[12px] text-text-primary outline-none placeholder:text-text-muted"
                />
              </div>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowFieldPicker((v) => !v);
                }}
                className="flex w-7 items-center justify-center border-l border-border-muted text-text-muted hover:text-text-secondary transition-colors rounded-r-md"
              >
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${showFieldPicker ? 'rotate-180' : ''}`}
                />
              </button>
            </div>
          </label>

          {/* Dropdown */}
          {showFieldPicker && (
            <GlassColumnSelector
              columns={fieldCompletions}
              selected={columns}
              onChange={handleColumnsSelect}
              maxHeight="200px"
            />
          )}

          {/* Keep mode toggle + hint */}
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md bg-surface-active/70 p-0.5">
              {(['first', 'last'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => updateConfig((cfg) => ({ ...cfg, keep: m }))}
                  className={`${TOGGLE_BTN} ${
                    keep === m
                      ? 'bg-background/70 text-accent shadow-soft'
                      : 'text-text-muted hover:text-text-secondary'
                  }`}
                >
                  {m === 'first' ? tr('first', '第一条') : tr('last', '最后一条')}
                </button>
              ))}
            </div>
            <span className="truncate text-[10px] text-text-muted">
              {columns.length > 0
                ? tr('dedupByFields', '按 {{count}} 个字段去重').replace(
                    '{{count}}',
                    String(columns.length)
                  )
                : tr('dedupAllFields', '全字段去重')}
            </span>
          </div>

          {/* Sort key editor (keep === 'last') */}
          {keep === 'last' && (
            <div className="border-t border-border-subtle pt-2">
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
            </div>
          )}
        </div>
      </GlassFormSection>
    </div>
  );
}
