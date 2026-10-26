import { useCallback, useMemo, useState } from 'react';
import { Info, X } from 'lucide-react';

import type { OperatorFormProps } from './types';
import { GlassOptionMultiSelect } from './shared/GlassOptionMultiSelect';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import {
  Cell,
  ErrorRow,
  FormGrid,
  FormScroll,
  HintRow,
  LabelCell,
  SegmentCells,
  SelectCell,
} from './shared/FormGrid';
import { DEDUPE_GRID_COLUMNS } from './shared/gridColumns';
import { isTemporalDataFieldType } from '../../../shared/data-field-types';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import type { SortKey } from '../../../shared/operator-schemas';

export default function FormDeduplicate({
  node,
  pipelineId,
  fieldCompletions,
  sourceNode,
  onNodeChange,
}: OperatorFormProps) {
  const tr = useFormTranslation('deduplicate');
  const columnTypes = useWorkflowNodeColumnTypes({ pipelineId, sourceNode });
  const updateConfig = useUpdateConfig(onNodeChange);

  const strategy: 'by_columns' | 'all_columns' =
    node.config?.strategy === 'all_columns' ? 'all_columns' : 'by_columns';
  const columns = useMemo(() => (node.config?.fields as string[]) ?? [], [node.config?.fields]);
  const keep: 'first' | 'last' = node.config?.keep === 'last' ? 'last' : 'first';
  const orderBy = useMemo(() => (node.config?.orderBy as SortKey[]) ?? [], [node.config?.orderBy]);
  const orderField = orderBy[0]?.field ?? '';
  const orderDirection: 'asc' | 'desc' = orderBy[0]?.direction === 'desc' ? 'desc' : 'asc';

  const setStrategy = useCallback(
    (next: 'by_columns' | 'all_columns') => {
      updateConfig((cfg) => ({
        ...cfg,
        strategy: next,
        fields: next === 'all_columns' ? undefined : cfg.fields,
      }));
    },
    [updateConfig]
  );

  // Errors appear only after the user has interacted with the field.
  const [columnsTouched, setColumnsTouched] = useState(false);
  const commitColumns = useCallback(
    (next: string[]) => {
      setColumnsTouched(true);
      updateConfig((cfg) => ({
        ...cfg,
        strategy: 'by_columns',
        fields: next.length > 0 ? next : undefined,
      }));
    },
    [updateConfig]
  );

  const commitOrderField = useCallback(
    (field: string) => {
      updateConfig((cfg) => {
        if (!field) return { ...cfg, orderBy: undefined };
        const prev = (cfg.orderBy as SortKey[] | undefined)?.[0];
        return { ...cfg, orderBy: [{ ...prev, field, direction: prev?.direction ?? 'asc' }] };
      });
    },
    [updateConfig]
  );

  const commitOrderDirection = useCallback(
    (direction: 'asc' | 'desc') => {
      updateConfig((cfg) => {
        const prev = (cfg.orderBy as SortKey[] | undefined)?.[0];
        if (!prev?.field) return cfg;
        return { ...cfg, orderBy: [{ ...prev, direction }] };
      });
    },
    [updateConfig]
  );

  const columnsMissing = strategy === 'by_columns' && columns.length === 0 && columnsTouched;
  const keepLabel = keep === 'last' ? tr('dedupKeepLast') : tr('dedupKeepFirst');
  const hint = (() => {
    if (strategy === 'all_columns') return tr('dedupHintWholeRow', { keep: keepLabel });
    if (columns.length === 0) return tr('dedupHintPickFields', { keep: keepLabel });
    const keys = columns.join('、');
    if (!orderField) return tr('dedupHintNoOrder', { keys, keep: keepLabel });
    // asc+last / desc+first → the largest (latest) value wins.
    const picksMax = (orderDirection === 'asc') === (keep === 'last');
    const temporal = isTemporalDataFieldType(columnTypes[orderField]);
    const extreme = tr(
      temporal
        ? picksMax
          ? 'dedupLatest'
          : 'dedupEarliest'
        : picksMax
          ? 'dedupLargest'
          : 'dedupSmallest'
    );
    return tr('dedupHintOrdered', {
      keys,
      field: orderField,
      direction: orderDirection === 'asc' ? tr('sortKeys.asc') : tr('sortKeys.desc'),
      keep: keepLabel,
      extreme,
    });
  })();

  return (
    <FormScroll>
      <FormGrid columns={DEDUPE_GRID_COLUMNS} testId="dedupe-form-grid">
        <LabelCell>{tr('dedupBasis')}</LabelCell>
        <SelectCell
          value={strategy}
          options={[
            { value: 'by_columns', label: tr('dedupByFields') },
            { value: 'all_columns', label: tr('dedupWholeRow') },
          ]}
          onChange={setStrategy}
          ariaLabel={tr('dedupBasis')}
        />
        {strategy === 'by_columns' ? (
          <Cell span={3} v={['ctl', 'chips', columnsMissing && 'err']}>
            <GlassOptionMultiSelect
              options={fieldCompletions}
              selected={columns}
              onChange={commitColumns}
              placeholder={tr('fieldPicker.selectField')}
              optionTypes={columnTypes}
              className="w-full"
            />
          </Cell>
        ) : (
          <Cell span={3} v={['muted']}>
            {tr('dedupWholeRowTip')}
          </Cell>
        )}
        {columnsMissing ? (
          <>
            <Cell v={['lab']} />
            <ErrorRow span={5}>{tr('dedupColumnsRequired')}</ErrorRow>
          </>
        ) : null}

        <LabelCell>{tr('dedupKeepWhich')}</LabelCell>
        <SelectCell
          value={keep}
          options={[
            { value: 'first', label: tr('dedupKeepFirst') },
            { value: 'last', label: tr('dedupKeepLast') },
          ]}
          onChange={(value) => updateConfig((cfg) => ({ ...cfg, keep: value }))}
          ariaLabel={tr('dedupKeepWhich')}
        />
        <Cell span={3} v={['blank']} />

        <LabelCell>{tr('dedupOrderBy')}</LabelCell>
        <Cell span={orderField ? 3 : 5} v={['ctl']} className="opg-clearable">
          <GlassFieldSingleSelect
            value={orderField}
            options={fieldCompletions}
            columnTypes={columnTypes}
            onChange={commitOrderField}
            placeholder={tr('dedupOrderByPlaceholder')}
            searchPlaceholder={tr('fieldPicker.searchField')}
            emptyText={tr('fieldPicker.noMatch')}
            className="w-full"
          />
          {orderField ? (
            <button
              type="button"
              onClick={() => commitOrderField('')}
              className="opg-clear"
              title={tr('fieldPicker.clearAll')}
              aria-label={tr('fieldPicker.clearAll')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </Cell>
        {orderField ? (
          <SegmentCells
            value={orderDirection}
            options={[
              { value: 'asc', label: tr('sortKeys.asc') },
              { value: 'desc', label: tr('sortKeys.desc') },
            ]}
            onChange={commitOrderDirection}
            ariaLabel={tr('dedupOrderBy')}
          />
        ) : null}

        <HintRow span={6}>
          <Info className="opg-ic h-3.5 w-3.5" />
          <span className="min-w-0 truncate">{hint}</span>
        </HintRow>
      </FormGrid>
    </FormScroll>
  );
}
