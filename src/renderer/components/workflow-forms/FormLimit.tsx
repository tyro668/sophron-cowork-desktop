import { useEffect, useState } from 'react';
import { Trash2, X, ChevronDown } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import { GlassFieldMultiSelect } from './shared/GlassFieldMultiSelect';
import { GlassRadioSelect } from './shared/GlassRadioSelect';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { parseNonNegativeInteger } from '../../../shared/operator-config';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import type { SortKey } from '../../../shared/operator-schemas';

const LABEL_CLASS = 'h-7 w-16 shrink-0 text-[13px] leading-7 text-text-secondary';

const TAG_CONTAINER =
  'flex min-h-7 items-center rounded-md border border-border-muted bg-background/42 focus-within:border-accent';

export default function FormLimit({ node, fieldCompletions, onNodeChange }: OperatorFormProps) {
  const tr = useFormTranslation();
  const updateConfig = useUpdateConfig(onNodeChange);

  const mode = (node.config.mode as string) ?? 'fixed';
  const limit = typeof node.config.limit === 'number' ? node.config.limit : null;
  const unit = (node.config.unit as string) ?? 'rows';
  const offset = typeof node.config.offset === 'number' ? node.config.offset : null;
  const orderBy: SortKey[] = (node.config.orderBy as SortKey[]) ?? [];
  const ties = !!node.config.ties;
  const method = (node.config.method as string) ?? 'system';
  const seed = node.config.seed as number | undefined;

  const [localLimit, setLocalLimit] = useState(limit != null ? String(limit) : '');
  const [localOffset, setLocalOffset] = useState(offset != null ? String(offset) : '');
  const [localSeed, setLocalSeed] = useState(seed != null ? String(seed) : '');
  const [sortOpen, setSortOpen] = useState(false);

  useEffect(() => {
    setLocalLimit(limit != null ? String(limit) : '');
    setLocalOffset(offset != null ? String(offset) : '');
    setLocalSeed(seed != null ? String(seed) : '');
  }, [limit, offset, seed]);

  const [errors, setErrors] = useState<string[]>([]);

  function pushLimit(value: string) {
    setLocalLimit(value);
    if (value === '') return;
    const n = parseNonNegativeInteger(value);
    if (n === undefined) return;
    const clamped = String(n);
    if (clamped !== value) setLocalLimit(clamped);
    setErrors(runValidation(n, unit));
    updateConfig((cfg) => ({ ...cfg, limit: n > 0 ? n : 0 }));
  }

  function pushOffset(value: string) {
    setLocalOffset(value);
    if (value === '') return;
    const n = parseNonNegativeInteger(value);
    if (n === undefined) return;
    const clamped = String(n);
    if (clamped !== value) setLocalOffset(clamped);
    setErrors(runValidation(limit ?? 0, unit));
    updateConfig((cfg) => ({ ...cfg, offset: n > 0 ? n : undefined }));
  }

  function pushSeed(value: string) {
    setLocalSeed(value);
    if (value === '') {
      updateConfig((cfg) => ({ ...cfg, seed: undefined }));
      return;
    }
    const n = parseNonNegativeInteger(value);
    if (n === undefined) return;
    updateConfig((cfg) => ({ ...cfg, seed: n }));
  }

  function runValidation(limitVal: number, unitVal: string): string[] {
    const errs: string[] = [];
    if (unitVal === 'percent' && limitVal > 100) errs.push(tr('limitPercentError'));
    return errs;
  }

  const isFixedMode = mode === 'fixed';
  const isRandomMode = mode === 'random';
  const isRows = unit === 'rows';
  const hasSort = orderBy.length > 0;

  const sortFields = orderBy.map((k) => k.field);

  function toggleSortDirection(field: string) {
    updateConfig((cfg) => ({
      ...cfg,
      orderBy: ((cfg.orderBy as SortKey[]) ?? []).map((key) =>
        key.field === field ? { ...key, direction: key.direction === 'asc' ? 'desc' : 'asc' } : key
      ),
    }));
  }

  function removeSortField(field: string) {
    updateConfig((cfg) => {
      const next = ((cfg.orderBy as SortKey[]) ?? []).filter((key) => key.field !== field);
      return { ...cfg, orderBy: next.length > 0 ? next : undefined };
    });
  }

  function setSortFields(next: string[]) {
    updateConfig((cfg) => {
      const prev = (cfg.orderBy as SortKey[]) ?? [];
      const mapped = next.map(
        (field) => prev.find((key) => key.field === field) ?? { field, direction: 'asc' as const }
      );
      return { ...cfg, orderBy: mapped.length > 0 ? mapped : undefined };
    });
  }

  function setMode(nextMode: string) {
    if (nextMode === 'fixed') {
      updateConfig((cfg) => ({
        ...cfg,
        mode: 'fixed',
        method: undefined,
        seed: undefined,
      }));
      return;
    }

    updateConfig((cfg) => ({
      ...cfg,
      mode: 'random',
      ties: undefined,
      orderBy: undefined,
      method: unit === 'percent' ? (cfg.method ?? 'system') : undefined,
    }));
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <div className="scrollbar-hover flex w-[180px] shrink-0 flex-col overflow-y-auto border-r border-border-muted bg-surface/40 p-3.5">
        <GlassRadioSelect
          value={mode}
          options={[
            {
              value: 'fixed',
              label: tr('limitFixedMode'),
              tip: tr('limitFixedModeTip'),
            },
            {
              value: 'random',
              label: tr('limitRandomMode'),
              tip: tr('limitRandomModeTip'),
            },
          ]}
          onChange={setMode}
          label={tr('limitMode')}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {/* 数量 + 单位 + 偏移量/种子 */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className={LABEL_CLASS}>
              {isRandomMode ? tr('limitSampleSize') : tr('limitCount')}
            </span>
            <GlassFormTextInput
              inputMode="numeric"
              value={localLimit}
              onChange={(v) => pushLimit(v)}
              placeholder="10"
              textCenter
              className="h-7 rounded-md px-2 text-[12px] w-28"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className={LABEL_CLASS}>{tr('limitUnit')}</span>
            <GlassOptionSingleSelect
              value={unit}
              groups={[
                {
                  key: 'unit',
                  items: [
                    { value: 'rows', label: tr('limitUnitRows') },
                    { value: 'percent', label: tr('limitUnitPercent') },
                  ],
                },
              ]}
              onChange={(value) => {
                updateConfig((cfg) => ({
                  ...cfg,
                  unit: value,
                  offset: value === 'percent' ? undefined : cfg.offset,
                  method:
                    mode === 'random' && value === 'percent' ? (cfg.method ?? 'system') : undefined,
                }));
                setErrors(runValidation(limit ?? 0, value));
              }}
              className="h-7 text-[12px] w-28"
            />
          </div>
          {isFixedMode && isRows ? (
            <div className="flex items-center gap-2">
              <span className={LABEL_CLASS}>{tr('limitOffset')}</span>
              <GlassFormTextInput
                inputMode="numeric"
                value={localOffset}
                onChange={(v) => pushOffset(v)}
                placeholder="0"
                textCenter
                className="h-7 rounded-md px-2 text-[12px] w-28"
              />
            </div>
          ) : null}
        </div>

        {isRandomMode && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex items-center gap-2">
              <span className={LABEL_CLASS}>{tr('limitSampleSeed')}</span>
              <GlassFormTextInput
                inputMode="numeric"
                value={localSeed}
                onChange={(v) => pushSeed(v)}
                placeholder={tr('limitSampleSeedPlaceholder')}
                textCenter
                className="h-7 rounded-md px-2 text-[12px] w-60"
              />
            </div>
            {!isRows && (
              <div className="flex items-center gap-2">
                <span className={LABEL_CLASS}>{tr('limitSampleMethod')}</span>
                <GlassOptionSingleSelect
                  value={method}
                  groups={[
                    {
                      key: 'method',
                      items: [
                        { value: 'system', label: tr('limitSampleSystem') },
                        { value: 'bernoulli', label: tr('limitSampleBernoulli') },
                      ],
                    },
                  ]}
                  onChange={(value) => updateConfig((cfg) => ({ ...cfg, method: value }))}
                  className="h-7 text-[12px] w-28"
                />
              </div>
            )}
          </div>
        )}

        {errors.map((err) => (
          <div key={err} className="text-[11px] text-warning">
            {err}
          </div>
        ))}

        {/* 限制取样：排序 + TIES */}
        {isFixedMode && (
          <>
            {/* 排序字段 */}
            <div className="flex items-center gap-2">
              <span className={LABEL_CLASS}>{tr('limitSortHeader')}</span>
              <div className="w-72 min-w-0 relative">
                <div className={TAG_CONTAINER}>
                  {sortFields.length > 0 && (
                    <button
                      type="button"
                      onClick={() => updateConfig((cfg) => ({ ...cfg, orderBy: undefined }))}
                      className="ml-1 inline-flex flex-shrink-0 items-center justify-center self-stretch rounded px-1 text-text-muted hover:text-error hover:bg-error/10 transition-colors"
                      title={tr('clearAll')}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                  <div className="flex flex-1 items-center gap-1 px-1.5 min-w-0 overflow-x-auto">
                    {orderBy.map((k) => (
                      <span
                        key={k.field}
                        className="inline-flex shrink-0 items-center gap-0.5 rounded bg-accent/10 px-1 py-0.5 text-[12px] font-medium text-accent"
                      >
                        {k.field}
                        <button
                          type="button"
                          onClick={() => toggleSortDirection(k.field)}
                          className="text-[11px] leading-none px-0.5 hover:text-text-primary rounded"
                          title={k.direction === 'asc' ? tr('asc') : tr('desc')}
                        >
                          {k.direction === 'asc' ? '↑' : '↓'}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeSortField(k.field)}
                          className="ml-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full hover:bg-accent/20"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </span>
                    ))}
                    <input
                      key="sort-input"
                      type="text"
                      readOnly
                      placeholder={!sortFields.length ? tr('limitSortPlaceholder') : ''}
                      onFocus={() => setSortOpen(true)}
                      onBlur={() => setTimeout(() => setSortOpen(false), 150)}
                      className="h-5 min-w-0 flex-1 bg-transparent text-[12px] text-text-primary outline-none placeholder:text-text-muted cursor-pointer"
                    />
                  </div>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setSortOpen((o) => !o)}
                    className="flex w-7 flex-shrink-0 items-center justify-center self-stretch border-l border-border-muted text-text-muted hover:text-text-secondary transition-colors rounded-r-md"
                  >
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform ${sortOpen ? 'rotate-180' : ''}`}
                    />
                  </button>
                </div>
                {sortOpen && (
                  <div className="absolute z-10 left-0 right-0 mt-0.5">
                    <GlassFieldMultiSelect
                      columns={fieldCompletions}
                      selected={sortFields}
                      onChange={(v) => setSortFields(v)}
                      maxHeight="160px"
                      variant="glass"
                    />
                  </div>
                )}
              </div>
              {hasSort && (
                <label className="flex items-center gap-1.5 text-[12px] cursor-pointer select-none whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={ties}
                    onChange={(e) =>
                      updateConfig((cfg) => ({ ...cfg, ties: e.target.checked || undefined }))
                    }
                    className="h-4 w-4 rounded border-border-muted accent-accent"
                  />
                  {tr('limitTies')}
                </label>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
