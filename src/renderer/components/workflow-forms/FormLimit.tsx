import { useEffect, useState } from 'react';
import type { OperatorFormProps } from './types';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import { GlassSegmentedControl } from './shared/GlassSegmentedControl';
import { SortKeysEditor } from './shared/SortKeysEditor';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
import { parseNonNegativeInteger, parsePositiveInteger } from '../../../shared/operator-config';
import type { SortKey } from '../../../shared/operator-schemas';

export default function FormLimit({
  node,
  pipelineId,
  fieldCompletions,
  sourceNode,
  onNodeChange,
}: OperatorFormProps) {
  const tr = useFormTranslation('limit');
  const updateConfig = useUpdateConfig(onNodeChange);
  const columnTypes = useWorkflowNodeColumnTypes({ pipelineId, sourceNode });

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

  useEffect(() => {
    setLocalLimit(limit != null ? String(limit) : '');
    setLocalOffset(offset != null ? String(offset) : '');
    setLocalSeed(seed != null ? String(seed) : '');
  }, [limit, offset, seed]);

  const [errors, setErrors] = useState<string[]>([]);

  function pushLimit(value: string) {
    setLocalLimit(value);
    if (value === '') {
      setErrors([]);
      updateConfig((cfg) => ({ ...cfg, limit: undefined }));
      return;
    }
    const n = parsePositiveInteger(value);
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
  const hasSort = orderBy.some((key) => key.field);

  const commitSortKeys = (next: SortKey[]) => {
    updateConfig((cfg) => ({ ...cfg, orderBy: next.length > 0 ? next : undefined }));
  };

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
    <div className="scrollbar-hover flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-3">
      <div className="flex items-center gap-2">
        <GlassFormLabel>{tr('limitMode')}</GlassFormLabel>
        <GlassSegmentedControl
          value={mode}
          options={[
            { value: 'fixed', label: tr('limitFixedMode'), tip: tr('limitFixedModeTip') },
            { value: 'random', label: tr('limitRandomMode'), tip: tr('limitRandomModeTip') },
          ]}
          onChange={setMode}
          ariaLabel={tr('limitMode')}
        />
      </div>

      <div className="flex items-center gap-2">
        <GlassFormLabel>{isRandomMode ? tr('limitSampleSize') : tr('limitCount')}</GlassFormLabel>
        <GlassFormTextInput
          inputMode="numeric"
          value={localLimit}
          onChange={(v) => pushLimit(v)}
          placeholder="10"
          textCenter
          className="h-8 w-60 rounded-md px-2"
        />
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
          className="h-8 w-32"
          aria-label={tr('limitUnit')}
        />
      </div>

      {isFixedMode && isRows && (
        <div className="flex items-center gap-2">
          <GlassFormLabel>{tr('limitOffset')}</GlassFormLabel>
          <GlassFormTextInput
            inputMode="numeric"
            value={localOffset}
            onChange={(v) => pushOffset(v)}
            placeholder="0"
            textCenter
            className="h-8 w-60 rounded-md px-2"
          />
        </div>
      )}

      {isRandomMode && (
        <>
          <div className="flex items-center gap-2">
            <GlassFormLabel>{tr('limitSampleSeed')}</GlassFormLabel>
            <GlassFormTextInput
              inputMode="numeric"
              value={localSeed}
              onChange={(v) => pushSeed(v)}
              placeholder={tr('limitSampleSeedPlaceholder')}
              textCenter
              className="h-8 w-60 rounded-md px-2"
            />
          </div>
          {!isRows && (
            <div className="flex items-center gap-2">
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
                className="h-8 w-60"
              />
            </div>
          )}
        </>
      )}

      {errors.map((err) => (
        <div key={err} className="pl-[88px] text-[12px] text-warning">
          {err}
        </div>
      ))}

      {isFixedMode && (
        <div className="flex items-start gap-2">
          <GlassFormLabel>{tr('limitSortHeader')}</GlassFormLabel>
          <div className="min-w-0 flex-1">
            <SortKeysEditor
              keys={orderBy}
              fieldCompletions={fieldCompletions}
              columnTypes={columnTypes}
              onChange={commitSortKeys}
            />
            {hasSort && (
              <label className="mt-1 flex h-8 cursor-pointer items-center gap-1.5 text-[12px] text-text-secondary select-none">
                <input
                  type="checkbox"
                  checked={ties}
                  onChange={(e) =>
                    updateConfig((cfg) => ({ ...cfg, ties: e.target.checked || undefined }))
                  }
                  className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
                />
                {tr('limitTies')}
              </label>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
