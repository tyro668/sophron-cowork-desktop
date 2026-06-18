import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';
import { GlassSortKeyEditor, type SortKeyEntry } from './shared/GlassSortKeyEditor';

const INPUT_CLASS =
  'h-7 w-full rounded-md border border-border-muted bg-background/42 px-2 text-[12px] text-text-primary outline-none focus:border-accent';

export default function FormLimit({ node, fieldCompletions, onNodeChange }: OperatorFormProps) {
  const { t } = useTranslation();
  const tr = useCallback(
    (key: string, fallback: string) =>
      t(`data.workflow.formLabels.${key}`, { defaultValue: fallback }),
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

  const mode = (node.config.mode as string) ?? 'limit';
  const limit = Number(node.config.limit ?? 100);
  const unit = (node.config.unit as string) ?? 'rows';
  const offset = Number(node.config.offset ?? 0);
  const orderBy: SortKeyEntry[] = (node.config.orderBy as SortKeyEntry[]) ?? [];

  // Local state for fluent typing — synced from config on identity change
  const configRef = useRef(node.config);
  const [localLimit, setLocalLimit] = useState(String(limit));
  const [localOffset, setLocalOffset] = useState(String(offset));
  if (configRef.current !== node.config) {
    configRef.current = node.config;
    if (String(limit) !== localLimit) setLocalLimit(String(limit));
    if (String(offset) !== localOffset) setLocalOffset(String(offset));
  }

  const [errors, setErrors] = useState<string[]>([]);

  function pushLimit(value: string) {
    setLocalLimit(value);
    const n = Math.max(1, Number(value) || 1);
    const clamped = String(n);
    if (clamped !== value) setLocalLimit(clamped);
    const newUnit = unit;
    const newOffset = offset;
    setErrors(runValidation(n, newOffset, newUnit));
    updateConfig((cfg) => ({ ...cfg, limit: n }));
  }

  function pushOffset(value: string) {
    setLocalOffset(value);
    const n = Math.max(0, Number(value) || 0);
    const clamped = String(n);
    if (clamped !== value) setLocalOffset(clamped);
    setErrors(runValidation(limit, n, unit));
    updateConfig((cfg) => ({ ...cfg, offset: n > 0 ? n : undefined }));
  }

  function runValidation(limitVal: number, _offsetVal: number, unitVal: string): string[] {
    const errs: string[] = [];
    if (unitVal === 'percent' && limitVal > 100)
      errs.push(tr('limitPercentError', '百分比不能超过 100'));
    return errs;
  }

  return (
    <div className="grid content-start gap-2.5">
      <GlassFormSection>
        <div className="grid gap-2">
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-text-muted">{tr('limitMode', '模式')}</span>
            <div className="inline-flex rounded-md bg-surface-active/70 p-0.5">
              <button
                type="button"
                onClick={() => updateConfig((cfg) => ({ ...cfg, mode: 'limit' }))}
                className={`h-6 rounded px-2.5 text-[11px] font-medium transition-colors ${
                  mode === 'limit'
                    ? 'bg-background/70 text-accent shadow-soft'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                Limit
              </button>
              <button
                type="button"
                onClick={() => updateConfig((cfg) => ({ ...cfg, mode: 'top' }))}
                className={`h-6 rounded px-2.5 text-[11px] font-medium transition-colors ${
                  mode === 'top'
                    ? 'bg-background/70 text-accent shadow-soft'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                Top
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <label className="grid gap-1">
              <span className="text-[11px] font-medium text-text-secondary">
                {tr('limitCount', '数量')}
              </span>
              <input
                type="text"
                inputMode="numeric"
                value={localLimit}
                onChange={(e) => pushLimit(e.target.value)}
                className={INPUT_CLASS}
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[11px] font-medium text-text-secondary">
                {tr('limitUnit', '单位')}
              </span>
              <select
                value={unit}
                onChange={(e) => {
                  const newUnit = e.target.value;
                  updateConfig((cfg) => ({ ...cfg, unit: newUnit }));
                  setErrors(runValidation(limit, offset, newUnit));
                }}
                className={INPUT_CLASS}
              >
                <option value="rows">{tr('limitUnitRows', '行数')}</option>
                <option value="percent">{tr('limitUnitPercent', '百分比')}</option>
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-[11px] font-medium text-text-secondary">
                {tr('limitOffset', '偏移量（行数）')}
              </span>
              <input
                type="text"
                inputMode="numeric"
                value={localOffset}
                onChange={(e) => pushOffset(e.target.value)}
                placeholder="0"
                className={INPUT_CLASS}
              />
            </label>
          </div>

          {errors.map((err) => (
            <div key={err} className="text-[11px] text-warning">
              {err}
            </div>
          ))}
        </div>
      </GlassFormSection>

      {mode === 'top' && (
        <GlassFormSection title={tr('limitTopSort', 'Top 排序')}>
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
