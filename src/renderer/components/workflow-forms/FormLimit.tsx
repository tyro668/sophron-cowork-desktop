import { useEffect, useRef, useState } from 'react';
import { Trash2, X, ChevronDown } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import { GlassFieldMultiSelect } from './shared/GlassFieldMultiSelect';
import { GlassRadioSelect } from './shared/GlassRadioSelect';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useClickOutside } from '../../hooks/useClickOutside';
import { parseNonNegativeInteger } from '../../../shared/operator-config';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import type { SortKey } from '../../../shared/operator-schemas';

const TAG_CONTAINER =
  'flex h-9 min-h-9 max-w-full items-center overflow-hidden rounded-md border border-border-muted bg-background/42 focus-within:border-accent';

export default function FormLimit({ node, fieldCompletions, onNodeChange }: OperatorFormProps) {
  const tr = useFormTranslation('limit');
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
  const sortPickerRef = useRef<HTMLDivElement>(null);
  useClickOutside(sortPickerRef, () => setSortOpen(false));

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
    updateConfig((cfg) => ({ ...cfg, limit: n }));
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

      <div className="scrollbar-hover flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {/* 数量 */}
        <div className="flex items-center gap-4">
          <GlassFormLabel>{isRandomMode ? tr('limitSampleSize') : tr('limitCount')}</GlassFormLabel>
          <GlassFormTextInput
            inputMode="numeric"
            value={localLimit}
            onChange={(v) => pushLimit(v)}
            placeholder="10"
            textCenter
            className="h-8 rounded-md px-2 text-[12px] w-60"
          />
        </div>

        {/* 单位 */}
        <div className="flex items-center gap-4">
          <GlassFormLabel>{tr('limitUnit')}</GlassFormLabel>
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
            variant="highlight"
            className="h-8 text-[12px] w-60"
          />
        </div>

        {/* 偏移量 */}
        {isFixedMode && isRows ? (
          <div className="flex items-center gap-4">
            <GlassFormLabel>{tr('limitOffset')}</GlassFormLabel>
            <GlassFormTextInput
              inputMode="numeric"
              value={localOffset}
              onChange={(v) => pushOffset(v)}
              placeholder="0"
              textCenter
              className="h-8 rounded-md px-2 text-[12px] w-60"
            />
          </div>
        ) : null}

        {isRandomMode && (
          <>
            {/* 采样种子 */}
            <div className="flex items-center gap-4">
              <GlassFormLabel>{tr('limitSampleSeed')}</GlassFormLabel>
              <GlassFormTextInput
                inputMode="numeric"
                value={localSeed}
                onChange={(v) => pushSeed(v)}
                placeholder={tr('limitSampleSeedPlaceholder')}
                textCenter
                className="h-8 rounded-md px-2 text-[12px] w-60"
              />
            </div>
            {/* 采样方式 */}
            {!isRows && (
              <div className="flex items-center gap-4">
                <GlassFormLabel>{tr('limitSampleMethod')}</GlassFormLabel>
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
                  className="h-8 text-[12px] w-60"
                />
              </div>
            )}
          </>
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
            <div className="flex items-center gap-4">
              <GlassFormLabel>{tr('limitSortHeader')}</GlassFormLabel>
              <div className="w-72 min-w-0 relative" ref={sortPickerRef}>
                <div className={`${TAG_CONTAINER} ${sortOpen ? 'rounded-b-none' : ''}`}>
                  {sortFields.length > 0 && (
                    <button
                      type="button"
                      onClick={() => updateConfig((cfg) => ({ ...cfg, orderBy: undefined }))}
                      className="ml-1 inline-flex flex-shrink-0 items-center justify-center self-stretch rounded px-1 text-text-muted hover:text-error hover:bg-error/10 transition-colors"
                      title={tr('fieldPicker.clearAll')}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                  <div className="scrollbar-hover flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1.5">
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
                          title={k.direction === 'asc' ? tr('sortKeys.asc') : tr('sortKeys.desc')}
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
                      onClick={() => setSortOpen(true)}
                      className="h-5 min-w-0 flex-1 bg-transparent text-[12px] text-text-primary outline-none placeholder:text-text-muted cursor-pointer"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setSortOpen((o) => !o)}
                    className={`flex w-7 flex-shrink-0 items-center justify-center self-stretch border-l border-border-muted text-text-muted transition-colors hover:text-text-secondary ${
                      sortOpen ? 'rounded-br-none' : 'rounded-r-md'
                    }`}
                  >
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform ${sortOpen ? 'rotate-180' : ''}`}
                    />
                  </button>
                </div>
                {sortOpen && (
                  <div className="absolute left-0 right-0 z-10 -mt-px">
                    <GlassFieldMultiSelect
                      columns={fieldCompletions}
                      selected={sortFields}
                      onChange={(v) => setSortFields(v)}
                      maxHeight="160px"
                      variant="glass"
                      className="rounded-t-none"
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
