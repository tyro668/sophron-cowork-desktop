import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OperatorFormProps } from './index';
import { GlassOperatorSelect } from './shared/GlassOperatorSelect';
import { GlassSortKeyEditor, type SortKeyEntry } from './shared/GlassSortKeyEditor';

function RadioRow({
  selected,
  label,
  onClick,
}: {
  selected: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors ${
        selected
          ? 'bg-accent/10 font-medium text-accent'
          : 'text-text-secondary hover:bg-surface-hover'
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full ${selected ? 'bg-accent' : 'bg-border-muted'}`}
        aria-hidden="true"
      />
      {label}
    </button>
  );
}

const INPUT_CLASS =
  'h-6 w-full rounded-md border border-border-muted bg-background/60 px-2 text-center text-[12px] text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent';

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
    setErrors(runValidation(n, offset, unit));
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

  const isTopMode = mode === 'top';

  return (
    <div className="flex h-full min-h-0 flex-1 gap-0 overflow-hidden">
      <div className="flex w-[180px] shrink-0 flex-col gap-3.5 border-r border-border-muted bg-surface/40 p-3.5">
        <section className="flex flex-col gap-1.5">
          <h4 className="text-[11px] font-medium text-text-muted">{tr('limitMode', '模式')}</h4>
          <RadioRow
            selected={!isTopMode}
            label={tr('limitSimpleMode', '简单限制')}
            onClick={() => {
              if (mode !== 'limit') {
                updateConfig((cfg) => ({ ...cfg, mode: 'limit', orderBy: undefined }));
              }
            }}
          />
          <RadioRow
            selected={isTopMode}
            label={tr('limitTopMode', 'Top 排序')}
            onClick={() => {
              if (mode !== 'top') {
                updateConfig((cfg) => ({ ...cfg, mode: 'top' }));
              }
            }}
          />
        </section>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        <div className="grid grid-cols-3 gap-3 -mt-[5mm]">
          <label className="grid gap-1.5">
            <span className="text-center text-[11px] font-medium text-text-secondary">
              {tr('limitCount', '数量')}
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={localLimit}
              onChange={(e) => pushLimit(e.target.value)}
              placeholder="100"
              className={INPUT_CLASS}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-center text-[11px] font-medium text-text-secondary">
              {tr('limitUnit', '单位')}
            </span>
            <GlassOperatorSelect
              value={unit}
              groups={[
                {
                  key: 'unit',
                  items: [
                    { value: 'rows', label: tr('limitUnitRows', '行数') },
                    { value: 'percent', label: tr('limitUnitPercent', '百分比') },
                  ],
                },
              ]}
              onChange={(value) => {
                updateConfig((cfg) => ({ ...cfg, unit: value }));
                setErrors(runValidation(limit, offset, value));
              }}
              className="h-6 min-w-[84px] rounded-md text-center text-[12px] text-text-muted w-full"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-center text-[11px] font-medium text-text-secondary">
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

        {isTopMode && (
          <>
            <div className="border-t border-border-muted" />
            <div className="-mt-2">
              <GlassSortKeyEditor
                keys={orderBy}
                fieldCompletions={fieldCompletions}
                onChange={(keys) =>
                  updateConfig((cfg) => ({ ...cfg, orderBy: keys.length > 0 ? keys : undefined }))
                }
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
