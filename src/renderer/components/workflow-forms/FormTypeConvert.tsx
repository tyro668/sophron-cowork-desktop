import { useCallback, useMemo } from 'react';
import type { OperatorFormProps } from './types';
import {
  DATA_FIELD_TYPES,
  normalizeDataFieldType,
  type DataFieldType,
} from '../../../shared/data-field-types';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import {
  AddRow,
  Cell,
  FormGrid,
  FormScroll,
  GridRow,
  RowActionsCell,
  SegmentCells,
} from './shared/FormGrid';
import { TYPE_CONVERT_GRID_COLUMNS } from './shared/gridColumns';
import { useGridRowDrag } from './shared/useGridRowDrag';
import { createStableRowId, ensureStableRowIds, patchRowAt } from './shared/rowListOperations';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useDataFieldTypeLabel } from '../../hooks/useDataFieldTypeLabel';
import { computeUsedFields } from '../../../shared/collections/used-fields';
import { parseTypeConversionScale, prepareTypeConversion } from '../../../shared/operator-config';
import {
  DATE_FORMAT_PRESETS,
  SCALE_MIN,
  SCALE_MAX,
  type DateFormat,
  type TypeConversionEntry,
} from '../../../shared/operator-schemas/type-convert';

const EMPTY_TYPE_CONVERSION: Readonly<TypeConversionEntry> = {
  field: '',
  type: 'text',
};

export default function FormTypeConvert({
  node,
  pipelineId,
  fieldCompletions,
  sourceNode,
  onNodeChange,
}: OperatorFormProps) {
  const tr = useFormTranslation('typeConvert');
  const dataTypeLabel = useDataFieldTypeLabel();
  const columnTypes = useWorkflowNodeColumnTypes({ pipelineId, sourceNode });
  const updateConfig = useUpdateConfig(onNodeChange);

  const conversions = useMemo<TypeConversionEntry[]>(() => {
    const configuredConversions =
      (node.config.conversions as TypeConversionEntry[] | undefined) ?? [];
    return configuredConversions.length > 0
      ? ensureStableRowIds(configuredConversions)
      : [{ ...EMPTY_TYPE_CONVERSION, id: createStableRowId() }];
  }, [node.config.conversions]);

  const commitConversions = useCallback(
    (next: TypeConversionEntry[]) => {
      updateConfig((cfg) => ({
        ...cfg,
        conversions: next.length > 0 ? ensureStableRowIds(next) : undefined,
      }));
    },
    [updateConfig]
  );

  const {
    activeItems: activeConversions,
    rowProps,
    dragHandle,
  } = useGridRowDrag(conversions, commitConversions);

  // Functional update against the latest config (no stale closure).
  const updateConversion = useCallback(
    (index: number, patch: Partial<TypeConversionEntry>) => {
      updateConfig((cfg) => {
        const current = (cfg.conversions as TypeConversionEntry[] | undefined) ?? [];
        return {
          ...cfg,
          conversions: ensureStableRowIds(patchRowAt(current, conversions, index, patch)),
        };
      });
    },
    [conversions, updateConfig]
  );

  const addConversionAfter = useCallback(
    (index: number) => {
      if (activeConversions.length >= fieldCompletions.length) return;
      const next = [...activeConversions];
      next.splice(index + 1, 0, { ...EMPTY_TYPE_CONVERSION, id: createStableRowId() });
      commitConversions(next);
    },
    [activeConversions, fieldCompletions.length, commitConversions]
  );

  const removeConversion = useCallback(
    (index: number) => {
      if (activeConversions.length <= 1) {
        commitConversions([]);
        return;
      }
      commitConversions(activeConversions.filter((_, i) => i !== index));
    },
    [activeConversions, commitConversions]
  );

  const copyConversion = useCallback(
    (index: number) => {
      if (activeConversions.length >= fieldCompletions.length) return;
      const source = activeConversions[index];
      const next = [...activeConversions];
      next.splice(index + 1, 0, {
        id: createStableRowId(),
        field: '',
        type: source.type,
        onError: source.onError,
        format: source.format,
        scale: source.scale,
      } as TypeConversionEntry);
      commitConversions(next);
    },
    [activeConversions, fieldCompletions.length, commitConversions]
  );

  const usedFields = useMemo(
    () => computeUsedFields(activeConversions, (c) => c.field),
    [activeConversions]
  );

  const onErrorOptions = useMemo(
    () => [
      { value: 'null', label: tr('typeConvertErrorNull') },
      { value: 'fail', label: tr('typeConvertErrorFail') },
      { value: 'keep', label: tr('typeConvertErrorKeep') },
    ],
    [tr]
  );

  const canAdd = activeConversions.length < fieldCompletions.length;
  const rowLabels = {
    add: tr('typeConvertAdd'),
    copy: tr('rowList.copyRow'),
    remove: tr('typeConvertRemove'),
    drag: tr('rowList.dragToReorder'),
  };

  return (
    <FormScroll>
      <FormGrid columns={TYPE_CONVERT_GRID_COLUMNS} testId="type-convert-form-grid">
        <Cell v={['th']}>{tr('typeConvertSourceField')}</Cell>
        <Cell v={['th']}>{tr('typeConvertTargetType')}</Cell>
        <Cell v={['th']}>{tr('typeConvertTypeSettings')}</Cell>
        <Cell span={3} v={['th']}>
          {tr('typeConvertOnFailure')}
        </Cell>
        <Cell v={['th']} />
        {activeConversions.map((conv, i) => {
          const disabledFields = new Set(usedFields);
          if (conv.field) disabledFields.delete(conv.field);
          const isDateType = conv.type === 'date' || conv.type === 'datetime';
          return (
            <GridRow
              key={conv.id ?? `conversion-${i}`}
              {...rowProps(i)}
              testId={`type-convert-row-${i}`}
            >
              <Cell v={['ctl']}>
                <GlassFieldSingleSelect
                  value={conv.field}
                  options={fieldCompletions}
                  columnTypes={columnTypes}
                  onChange={(value) => updateConversion(i, { field: value })}
                  placeholder={tr('typeConvertSelectField')}
                  searchPlaceholder={tr('fieldPicker.searchField')}
                  emptyText={tr('fieldPicker.noMatch')}
                  disabledOptions={disabledFields}
                  className="w-full"
                />
              </Cell>
              <Cell v={['ctl', 'hl']}>
                <GlassOptionSingleSelect
                  value={normalizeDataFieldType(conv.type)}
                  onChange={(v) =>
                    updateConversion(i, { ...prepareTypeConversion(v as DataFieldType) })
                  }
                  groups={[
                    {
                      key: 'types',
                      items: DATA_FIELD_TYPES.map((t) => ({ value: t, label: dataTypeLabel(t) })),
                    },
                  ]}
                  variant="highlight"
                  className="w-full"
                />
              </Cell>
              {isDateType ? (
                <Cell v={['ctl']}>
                  <GlassOptionSingleSelect
                    value={conv.format ?? ''}
                    groups={[
                      {
                        key: 'formats',
                        items: [
                          {
                            value: '',
                            label: tr('typeConvertAutoParse'),
                            title: tr('typeConvertAutoParseHint'),
                          },
                          ...DATE_FORMAT_PRESETS.map((preset) => ({
                            value: preset.value,
                            label: preset.value,
                            title: tr('typeConvertFormatExample', { example: preset.example }),
                          })),
                        ],
                      },
                    ]}
                    onChange={(v) =>
                      updateConversion(i, { format: (v || undefined) as DateFormat | undefined })
                    }
                    className="w-full"
                  />
                </Cell>
              ) : conv.type === 'decimal' ? (
                <Cell v={['ctl']}>
                  <GlassOptionSingleSelect
                    value={conv.scale != null ? String(conv.scale) : String(SCALE_MIN)}
                    groups={[
                      {
                        key: 'scale',
                        items: Array.from({ length: SCALE_MAX - SCALE_MIN + 1 }, (_, k) => {
                          const n = SCALE_MIN + k;
                          return { value: String(n), label: tr('typeConvertScaleOption', { n }) };
                        }),
                      },
                    ]}
                    onChange={(v) => updateConversion(i, { scale: parseTypeConversionScale(v) })}
                    className="w-full"
                  />
                </Cell>
              ) : (
                <Cell v={['muted']}>{tr('typeConvertNoSettings')}</Cell>
              )}
              <SegmentCells
                value={(conv.onError ?? 'null') as 'null' | 'fail' | 'keep'}
                options={
                  onErrorOptions as Array<{ value: 'null' | 'fail' | 'keep'; label: string }>
                }
                onChange={(v) =>
                  updateConversion(i, {
                    onError: v !== 'null' ? (v as 'keep' | 'fail') : undefined,
                  })
                }
                ariaLabel={tr('typeConvertOnFailure')}
              />
              <RowActionsCell
                labels={rowLabels}
                onAdd={() => addConversionAfter(i)}
                onCopy={() => copyConversion(i)}
                onRemove={() => removeConversion(i)}
                canAdd={canAdd}
                dragHandle={dragHandle(i)}
              />
            </GridRow>
          );
        })}
        <AddRow
          span={7}
          label={tr('typeConvertAdd')}
          onClick={() => addConversionAfter(activeConversions.length - 1)}
          disabled={!canAdd}
        />
      </FormGrid>
    </FormScroll>
  );
}
