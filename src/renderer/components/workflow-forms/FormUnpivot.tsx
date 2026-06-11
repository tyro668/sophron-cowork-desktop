import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, X } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';
import { GlassColumnSelector } from './shared/GlassColumnSelector';

const INPUT_CLASS =
  'h-7 w-full rounded-md border border-border-muted bg-background/42 px-2 text-[12px] text-text-primary outline-none focus:border-accent';

export default function FormUnpivot({ node, fieldCompletions, onNodeChange }: OperatorFormProps) {
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
      }));
    },
    [onNodeChange]
  );

  const columns: string[] = (node.config.columns as string[]) ?? [];
  const nameColumn = String(node.config.nameColumn ?? '');
  const valueColumn = String(node.config.valueColumn ?? '');
  const includeNulls = Boolean(node.config.includeNulls ?? false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showFieldPicker, setShowFieldPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const removingRef = useRef(false);

  const handleColumnsSelect = useCallback(
    (next: string[]) => {
      updateConfig((cfg) => ({ ...cfg, columns: next.length > 0 ? next : undefined }));
    },
    [updateConfig]
  );

  const removeColumn = useCallback(
    (col: string) => {
      if (removingRef.current) return;
      removingRef.current = true;
      updateConfig((cfg) => ({
        ...cfg,
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
      {/* Main: combobox columns + output names */}
      <GlassFormSection title={tr('unpivotMode', '列展开')}>
        <div className="grid gap-2.5">
          {/* Columns — combobox: tags + text input + dropdown button */}
          <label className="grid gap-1" ref={pickerRef}>
            <span className="text-[11px] font-medium text-text-secondary">
              {tr('unpivotExpandCols', '要展开的列')}
            </span>
            <div className="flex min-h-7 rounded-md border border-border-muted bg-background/42 focus-within:border-accent">
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
                  placeholder={
                    columns.length === 0
                      ? tr('unpivotColsPlaceholder', '输入字段名，用逗号分隔...')
                      : ''
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
            {/* Dropdown */}
            {showFieldPicker && (
              <GlassColumnSelector
                columns={fieldCompletions}
                selected={columns}
                onChange={handleColumnsSelect}
              />
            )}
          </label>

          {/* Output names — two columns */}
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1">
              <span className="text-[11px] font-medium text-text-secondary">
                {tr('unpivotNameCol', '名称列')}
                <span className="ml-0.5 text-xs text-text-muted">
                  {tr('unpivotNameColHint', '（默认 name）')}
                </span>
              </span>
              <input
                type="text"
                value={nameColumn}
                onChange={(e) =>
                  updateConfig((cfg) => ({ ...cfg, nameColumn: e.target.value || undefined }))
                }
                placeholder="name"
                className={INPUT_CLASS}
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[11px] font-medium text-text-secondary">
                {tr('unpivotValueCol', '值列')}
                <span className="ml-0.5 text-xs text-text-muted">
                  {tr('unpivotValueColHint', '（默认 value）')}
                </span>
              </span>
              <input
                type="text"
                value={valueColumn}
                onChange={(e) =>
                  updateConfig((cfg) => ({ ...cfg, valueColumn: e.target.value || undefined }))
                }
                placeholder="value"
                className={INPUT_CLASS}
              />
            </label>
          </div>
        </div>
      </GlassFormSection>

      {/* Advanced — collapsible */}
      <div className="rounded-lg border border-border-muted/70 bg-background/18">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-text-muted hover:text-text-secondary transition-colors"
        >
          <ChevronDown
            className={`h-3 w-3 transition-transform ${showAdvanced ? '' : '-rotate-90'}`}
          />
          {tr('unpivotOptions', '高级选项')}
        </button>
        {showAdvanced && (
          <div className="border-t border-border-muted/50 px-3 pb-2.5 pt-2">
            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-text-secondary">
              <input
                type="checkbox"
                checked={includeNulls}
                onChange={(e) =>
                  updateConfig((cfg) => ({
                    ...cfg,
                    includeNulls: e.target.checked || undefined,
                  }))
                }
                className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
              />
              {tr('unpivotIncludeNulls', '包含空值行 (include nulls)')}
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
