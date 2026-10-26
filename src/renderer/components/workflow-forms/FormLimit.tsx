import { useEffect, useState } from 'react';
import type { OperatorFormProps } from './types';
import { SortKeysEditor, sortKeysEditorRowCount } from './shared/SortKeysEditor';
import {
  Cell,
  ErrorRow,
  FormGrid,
  FormScroll,
  GlassCommitTextInput,
  LabelCell,
  SelectCell,
} from './shared/FormGrid';
import { LIMIT_GRID_COLUMNS } from './shared/gridColumns';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
import { parseNonNegativeInteger, parsePositiveInteger } from '../../../shared/operator-config';
import type { SortKey } from '../../../shared/operator-schemas';

/** Count must be a positive integer (and ≤ 100 for percent). */
export function validateLimitCount(raw: string, unit: string): 'count' | 'percent' | null {
  const v = raw.trim();
  // Checked explicitly: parsePositiveInteger clamps 0 up to 1.
  if (!/^\d+$/.test(v) || Number(v) <= 0 || !Number.isSafeInteger(Number(v))) return 'count';
  const n = Number(v);
  if (unit === 'percent' && n > 100) return 'percent';
  return null;
}

/** Seed is optional; when present it must be a non-negative integer. */
export function validateLimitSeed(raw: string): boolean {
  const v = raw.trim();
  return v === '' || (/^\d+$/.test(v) && parseNonNegativeInteger(v) !== undefined);
}

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

  const mode = (node.config.sampling as string) ?? 'fixed';
  const limit = typeof node.config.limit === 'number' ? node.config.limit : null;
  const unit = (node.config.unit as string) ?? 'rows';
  const offset = typeof node.config.offset === 'number' ? node.config.offset : null;
  const orderBy: SortKey[] = (node.config.orderBy as SortKey[]) ?? [];
  const ties = !!node.config.ties;
  const method = (node.config.method as string) ?? 'system';
  const seed = node.config.seed as number | undefined;

  // Raw drafts stay visible (with an error) instead of being silently dropped.
  const [localLimit, setLocalLimit] = useState(limit != null ? String(limit) : '');
  const [localSeed, setLocalSeed] = useState(seed != null ? String(seed) : '');
  useEffect(() => {
    setLocalLimit((prev) =>
      (validateLimitCount(prev, 'rows') === null ? Number(prev.trim()) : undefined) ===
      (limit ?? undefined)
        ? prev
        : limit != null
          ? String(limit)
          : ''
    );
  }, [limit]);
  useEffect(() => {
    setLocalSeed((prev) =>
      parseNonNegativeInteger(prev) === seed ? prev : seed != null ? String(seed) : ''
    );
  }, [seed]);

  const isFixedMode = mode === 'fixed';
  const isRandomMode = mode === 'random';
  const isRows = unit === 'rows';
  const configuredSort = orderBy.filter((key) => key.field);
  const hasSort = configuredSort.length > 0;

  const [limitTouched, setLimitTouched] = useState(false);
  // Deferred validation: only after the user committed a value (blur/Enter).
  const countError =
    limitTouched || localLimit.trim() !== '' ? validateLimitCount(localLimit, unit) : null;
  const seedInvalid = !validateLimitSeed(localSeed);

  function commitLimit(raw: string) {
    setLimitTouched(true);
    setLocalLimit(raw);
    const v = raw.trim();
    const n = /^\d+$/.test(v) && Number(v) > 0 ? parsePositiveInteger(v) : undefined;
    updateConfig((cfg) => ({ ...cfg, limit: n }));
  }

  function commitOffset(raw: string) {
    const v = raw.trim();
    const n = /^\d+$/.test(v) ? parseNonNegativeInteger(v) : undefined;
    updateConfig((cfg) => ({ ...cfg, offset: n && n > 0 ? n : undefined }));
  }

  function commitSeed(raw: string) {
    setLocalSeed(raw);
    const v = raw.trim();
    const n = /^\d+$/.test(v) ? parseNonNegativeInteger(v) : undefined;
    updateConfig((cfg) => ({ ...cfg, seed: n }));
  }

  const commitSortKeys = (next: SortKey[]) => {
    updateConfig((cfg) => ({
      ...cfg,
      orderBy: next.length > 0 ? next : undefined,
      ties: next.some((k) => k.field) ? cfg.ties : undefined,
    }));
  };

  function setMode(nextMode: 'fixed' | 'random') {
    if (nextMode === 'fixed') {
      updateConfig((cfg) => ({ ...cfg, sampling: 'fixed', method: undefined, seed: undefined }));
      return;
    }
    updateConfig((cfg) => ({
      ...cfg,
      sampling: 'random',
      ties: undefined,
      orderBy: undefined,
      method: unit === 'percent' ? (cfg.method ?? 'system') : undefined,
    }));
  }

  function setUnit(value: 'rows' | 'percent') {
    updateConfig((cfg) => ({
      ...cfg,
      unit: value,
      offset: value === 'percent' ? undefined : cfg.offset,
      method: mode === 'random' && value === 'percent' ? (cfg.method ?? 'system') : undefined,
    }));
  }

  const countText = countError ? 'N' : localLimit.trim();
  const unitText = isRows ? tr('limitHintRows') : '%';
  const limitHint = hasSort
    ? tr('limitHintSorted', {
        keys: configuredSort
          .map((k) =>
            tr('limitHintKey', {
              field: k.field,
              dir: k.direction === 'desc' ? tr('sortKeys.desc') : tr('sortKeys.asc'),
            })
          )
          .join(tr('sortKeys.sortHintSeparator')),
        count: countText,
        unit: unitText,
      })
    : tr('limitHintInput', { count: countText, unit: unitText });

  const tiesRow = hasSort ? (
    <Cell span={9}>
      <label className="flex cursor-pointer items-center gap-2 select-none">
        <input
          type="checkbox"
          checked={ties}
          onChange={(e) => updateConfig((cfg) => ({ ...cfg, ties: e.target.checked || undefined }))}
          className="opg-cbx"
        />
        {tr('limitTiesLong')}
      </label>
    </Cell>
  ) : null;

  return (
    <FormScroll>
      <FormGrid columns={LIMIT_GRID_COLUMNS} testId="limit-form-grid">
        <LabelCell>{tr('limitMode')}</LabelCell>
        <SelectCell
          value={isRandomMode ? 'random' : 'fixed'}
          options={[
            { value: 'fixed', label: tr('limitFixedMode'), description: tr('limitFixedModeTip') },
            {
              value: 'random',
              label: tr('limitRandomMode'),
              description: tr('limitRandomModeTip'),
            },
          ]}
          onChange={setMode}
          ariaLabel={tr('limitMode')}
        />
        <Cell span={7} v={['blank']} />

        <LabelCell required>{isRandomMode ? tr('limitSampleSize') : tr('limitCount')}</LabelCell>
        <Cell v={['ctl', 'num', countError && 'err']}>
          <GlassCommitTextInput
            value={localLimit}
            onDraftChange={setLocalLimit}
            onCommit={commitLimit}
            placeholder={tr('limitCountPlaceholder')}
            ariaLabel={tr('limitCount')}
            ariaInvalid={Boolean(countError)}
          />
        </Cell>
        <SelectCell
          value={isRows ? 'rows' : 'percent'}
          options={[
            { value: 'rows', label: tr('limitUnitRows') },
            { value: 'percent', label: tr('limitUnitPercent') },
          ]}
          onChange={setUnit}
          ariaLabel={tr('limitUnit')}
        />
        <Cell span={6} v={['blank']} />
        {countError && (
          <>
            <Cell v={['lab']} />
            <ErrorRow span={9}>
              {countError === 'percent' ? tr('limitPercentError') : tr('limitCountError')}
            </ErrorRow>
          </>
        )}

        {isFixedMode && isRows && (
          <>
            <LabelCell>{tr('limitOffset')}</LabelCell>
            <Cell v={['ctl', 'num']}>
              <GlassCommitTextInput
                value={offset != null ? String(offset) : ''}
                onCommit={commitOffset}
                placeholder="0"
                ariaLabel={tr('limitOffset')}
              />
            </Cell>
            <Cell span={8} v={['muted']}>
              {tr('limitOffsetTip')}
            </Cell>
          </>
        )}

        {isRandomMode && (
          <>
            <LabelCell>{tr('limitSampleSeed')}</LabelCell>
            <Cell v={['ctl', 'num', seedInvalid && 'err']}>
              <GlassCommitTextInput
                value={localSeed}
                onDraftChange={setLocalSeed}
                onCommit={commitSeed}
                placeholder={tr('limitSampleSeedPlaceholder')}
                ariaLabel={tr('limitSampleSeed')}
                ariaInvalid={seedInvalid}
              />
            </Cell>
            {!isRows ? (
              <SelectCell
                value={method === 'bernoulli' ? 'bernoulli' : 'system'}
                options={[
                  { value: 'bernoulli', label: tr('limitSampleBernoulli') },
                  { value: 'system', label: tr('limitSampleSystem') },
                ]}
                onChange={(value) => updateConfig((cfg) => ({ ...cfg, method: value }))}
                ariaLabel={tr('limitSampleMethod')}
              />
            ) : (
              <Cell span={2} v={['blank']} />
            )}
            <Cell span={6} v={['muted']}>
              {tr('limitSeedTip')}
            </Cell>
            {seedInvalid && (
              <>
                <Cell v={['lab']} />
                <ErrorRow span={9}>{tr('limitSeedError')}</ErrorRow>
              </>
            )}
          </>
        )}

        {isFixedMode && (
          <>
            <LabelCell rowSpan={sortKeysEditorRowCount(orderBy, hasSort ? 1 : 0)}>
              {tr('limitSortHeader')}
            </LabelCell>
            <SortKeysEditor
              keys={orderBy}
              fieldCompletions={fieldCompletions}
              columnTypes={columnTypes}
              onChange={commitSortKeys}
              fieldSpan={3}
              extraRows={tiesRow}
              hint={limitHint}
              fieldHeader={tr('limitSortFieldHeader')}
            />
          </>
        )}
      </FormGrid>
    </FormScroll>
  );
}
