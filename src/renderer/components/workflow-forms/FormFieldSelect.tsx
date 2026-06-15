import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, X } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';
import { GlassColumnSelector } from './shared/GlassColumnSelector';

export default function FormFieldSelect({
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
  const [showFieldPicker, setShowFieldPicker] = useState(false);
  const removingRef = useRef(false);

  const handleColumnsSelect = useCallback(
    (next: string[]) => {
      updateConfig((cfg) => ({
        ...cfg,
        mode: 'include',
        columns: next.length > 0 ? next : undefined,
      }));
    },
    [updateConfig]
  );

  const removeColumn = useCallback(
    (col: string) => {
      if (removingRef.current) return;
      removingRef.current = true;
      updateConfig((cfg) => ({
        ...cfg,
        mode: 'include',
        columns: ((cfg.columns as string[]) ?? []).filter((c) => c !== col),
      }));
      requestAnimationFrame(() => {
        removingRef.current = false;
      });
    },
    [updateConfig]
  );

  return (
    <div className="grid content-start gap-2.5">
      <GlassFormSection title={tr('fieldSelectTitle', '字段选择')}>
        <div className="grid gap-1.5">
          {/* Combobox: tags + text input + dropdown button */}
          <div className="flex min-h-8 rounded-md border border-border-muted bg-background/42 focus-within:border-accent">
            {/* Tags */}
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
                  columns.length === 0 ? tr('fieldSelectPlaceholder', '选择字段...') : ''
                }
                className="h-5 min-w-[60px] flex-1 bg-transparent text-[12px] text-text-primary outline-none placeholder:text-text-muted"
              />
            </div>
            {/* Dropdown toggle */}
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

          {/* Count hint */}
          <div className="text-[10px] text-text-muted">
            {tr('fieldSelectCount', '已选 {{n}}/{{total}} 个字段')
              .replace('{{n}}', String(columns.length))
              .replace('{{total}}', String(fieldCompletions.length))}
          </div>

          {/* Dropdown */}
          {showFieldPicker && (
            <GlassColumnSelector
              columns={fieldCompletions}
              selected={columns}
              onChange={handleColumnsSelect}
              maxHeight="200px"
            />
          )}
        </div>
      </GlassFormSection>
    </div>
  );
}
