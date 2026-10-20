import { Fragment, useCallback, useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import type { OperatorFormProps } from './types';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import {
  AddRow,
  Cell,
  ErrorRow,
  FormGrid,
  FormScroll,
  GlassCommitTextInput,
  GridRow,
  RowActionsCell,
  SegmentCells,
} from './shared/FormGrid';
import { useGridRowDrag } from './shared/useGridRowDrag';
import { FIELD_MAPPING_GRID_COLUMNS } from './shared/gridColumns';
import { createStableRowId, ensureStableRowIds, patchRowAt } from './shared/rowListOperations';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
import { computeUsedFields } from '../../../shared/collections/used-fields';
import {
  computeFieldMappingTarget,
  EMPTY_FIELD_MAPPING,
  normalizeFieldMappingEntry,
} from '../../../shared/operator-config';
import type { FieldMappingEntry } from '../../../shared/operator-schemas';

export default function FormFieldMapping({
  node,
  pipelineId,
  fieldCompletions,
  sourceNode,
  onNodeChange,
}: OperatorFormProps) {
  const tr = useFormTranslation('fieldMapping');
  const updateConfig = useUpdateConfig(onNodeChange);
  const columnTypes = useWorkflowNodeColumnTypes({ pipelineId, sourceNode });

  const mappings = useMemo<FieldMappingEntry[]>(
    () =>
      ensureStableRowIds(
        ((node.config.mappings as Record<string, unknown>[]) ?? []).map(normalizeFieldMappingEntry)
      ),
    [node.config.mappings]
  );
  const editableMappings = useMemo(
    () => (mappings.length > 0 ? mappings : [{ ...EMPTY_FIELD_MAPPING, id: createStableRowId() }]),
    [mappings]
  );

  const commitMappings = useCallback(
    (next: FieldMappingEntry[]) => {
      updateConfig((cfg) => ({
        ...cfg,
        mappings: next.length > 0 ? ensureStableRowIds(next) : undefined,
      }));
    },
    [updateConfig]
  );

  const {
    activeItems: activeMappings,
    rowProps,
    dragHandle,
  } = useGridRowDrag(editableMappings, commitMappings);

  const usedFields = useMemo(
    () => computeUsedFields(activeMappings, (m) => m.source),
    [activeMappings]
  );

  const updateMapping = useCallback(
    (index: number, patch: Partial<FieldMappingEntry>) => {
      updateConfig((cfg) => {
        const current = ((cfg.mappings as Record<string, unknown>[] | undefined) ?? []).map(
          normalizeFieldMappingEntry
        );
        const next = patchRowAt(current, activeMappings, index, patch);
        return { ...cfg, mappings: ensureStableRowIds(next) };
      });
    },
    [activeMappings, updateConfig]
  );

  const addMappingAfter = useCallback(
    (index: number) => {
      if (activeMappings.length >= fieldCompletions.length) return;
      const next = [...activeMappings];
      next.splice(index + 1, 0, { ...EMPTY_FIELD_MAPPING, id: createStableRowId() });
      commitMappings(next);
    },
    [activeMappings, fieldCompletions.length, commitMappings]
  );

  const copyMapping = useCallback(
    (index: number) => {
      if (activeMappings.length >= fieldCompletions.length) return;
      const source = activeMappings[index];
      const next = [...activeMappings];
      next.splice(index + 1, 0, {
        id: createStableRowId(),
        source: '',
        targetMode: source.targetMode,
        targetValue: source.targetValue,
      } as FieldMappingEntry);
      commitMappings(next);
    },
    [activeMappings, fieldCompletions.length, commitMappings]
  );

  const removeMapping = useCallback(
    (index: number) => {
      if (activeMappings.length <= 1) {
        commitMappings([]);
        return;
      }
      commitMappings(activeMappings.filter((_, i) => i !== index));
    },
    [activeMappings, commitMappings]
  );

  const targetModeOptions = useMemo(
    () => [
      { value: 'prefix' as const, label: tr('fieldMappingSegPrefix') },
      { value: 'suffix' as const, label: tr('fieldMappingSegSuffix') },
      { value: 'rename' as const, label: tr('fieldMappingModeRename') },
    ],
    [tr]
  );

  const issues = useMemo(
    () => validateFieldMappings(activeMappings, fieldCompletions),
    [activeMappings, fieldCompletions]
  );
  const canAdd = activeMappings.length < fieldCompletions.length;
  const rowLabels = {
    add: tr('rowAdd'),
    copy: tr('rowCopy'),
    remove: tr('fieldMappingRemove'),
    drag: tr('rowDrag'),
  };

  return (
    <FormScroll>
      <FormGrid columns={FIELD_MAPPING_GRID_COLUMNS} testId="field-mapping-form-grid">
        <Cell v={['th']}>{tr('fieldMappingSourceField')}</Cell>
        <Cell span={3} v={['th']}>
          {tr('fieldMappingModeHeader')}
        </Cell>
        <Cell v={['th']}>{tr('fieldMappingValue')}</Cell>
        <Cell v={['th']}>{tr('fieldMappingResultField')}</Cell>
        <Cell v={['th']} />
        {activeMappings.map((item, i) => {
          const disabledFields = new Set(usedFields);
          if (item.source) disabledFields.delete(item.source);
          const target = computeFieldMappingTarget(item);
          const issue = issues[i];
          return (
            <Fragment key={item.id ?? `mapping-${i}`}>
              <GridRow {...rowProps(i)} testId={`field-mapping-row-${i}`}>
                <Cell v={['ctl']}>
                  <GlassFieldSingleSelect
                    value={item.source}
                    options={fieldCompletions}
                    columnTypes={columnTypes}
                    onChange={(value) => updateMapping(i, { source: value })}
                    placeholder={tr('fieldMappingSelectField')}
                    searchPlaceholder={tr('fieldPicker.searchField')}
                    emptyText={tr('fieldPicker.noMatch')}
                    disabledOptions={disabledFields}
                    className="w-full"
                  />
                </Cell>
                <SegmentCells
                  value={item.targetMode}
                  options={targetModeOptions}
                  onChange={(v) => updateMapping(i, { targetMode: v })}
                  ariaLabel={tr('fieldMappingMode')}
                />
                <Cell v={['ctl']}>
                  <GlassCommitTextInput
                    value={item.targetValue}
                    onCommit={(v) => updateMapping(i, { targetValue: v })}
                    placeholder={
                      item.targetMode === 'rename'
                        ? tr('fieldMappingRenamePlaceholder')
                        : item.targetMode === 'prefix'
                          ? tr('fieldMappingPrefixPlaceholder')
                          : tr('fieldMappingSuffixPlaceholder')
                    }
                    ariaLabel={tr('fieldMappingValue')}
                    className="h-full w-full px-2.5 text-[13px]"
                  />
                </Cell>
                <Cell v={[issue && 'err']} title={target}>
                  <ArrowRight className="opg-ic h-3.5 w-3.5" />
                  <span
                    className={`truncate font-mono text-[12px] ${issue ? 'text-error' : 'text-text-secondary'}`}
                  >
                    {target || '—'}
                  </span>
                </Cell>
                <RowActionsCell
                  labels={rowLabels}
                  onAdd={() => addMappingAfter(i)}
                  onCopy={() => copyMapping(i)}
                  onRemove={() => removeMapping(i)}
                  canAdd={canAdd}
                  dragHandle={dragHandle(i)}
                />
              </GridRow>
              {issue ? (
                <ErrorRow span={7}>
                  <b>{tr('rowPrefix', { index: i + 1 })}</b>
                  {tr(issue.key, issue.params)}
                </ErrorRow>
              ) : null}
            </Fragment>
          );
        })}
        <AddRow
          span={7}
          label={tr('fieldMappingAdd')}
          onClick={() => addMappingAfter(activeMappings.length - 1)}
          disabled={!canAdd}
        />
      </FormGrid>
    </FormScroll>
  );
}

/** Result-name collisions: with an earlier row, or with an untouched upstream field. */
export function validateFieldMappings(
  mappings: FieldMappingEntry[],
  upstreamFields: string[]
): Array<{ key: string; params: Record<string, unknown> } | null> {
  const renamedSources = new Set(
    mappings
      .filter((m) => m.source && computeFieldMappingTarget(m) !== m.source)
      .map((m) => m.source)
  );
  const seen = new Map<string, number>();
  return mappings.map((m, index) => {
    const target = computeFieldMappingTarget(m);
    if (!m.source || !target) return null;
    const prev = seen.get(target);
    if (prev !== undefined) {
      return { key: 'fieldMappingDuplicateTarget', params: { name: target, row: prev + 1 } };
    }
    seen.set(target, index);
    if (target !== m.source && upstreamFields.includes(target) && !renamedSources.has(target)) {
      return { key: 'fieldMappingTargetExists', params: { name: target } };
    }
    return null;
  });
}
