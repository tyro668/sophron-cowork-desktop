import { useCallback, useEffect, useMemo } from 'react';
import type { OperatorFormProps } from './index';
import {
  DATA_FIELD_TYPES,
  normalizeDataFieldType,
  type DataFieldType,
} from '../../../shared/data-field-types';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import { GlassRowList, type RowAction } from './shared/GlassRowList';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
import { useDragReorder } from '../../hooks/useDragReorder';
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
  column: '',
  type: 'text',
};

export default function FormTypeConvert({
  node,
  taskId,
  fieldCompletions,
  sourceNode,
  onNodeChange,
}: OperatorFormProps) {
  const tr = useFormTranslation();
  const dataTypeLabel = useDataFieldTypeLabel();
  const columnTypes = useWorkflowNodeColumnTypes({ taskId, sourceNode });
  const updateConfig = useUpdateConfig(onNodeChange);

  const conversions = useMemo<TypeConversionEntry[]>(() => {
    const configuredConversions =
      (node.config.conversions as TypeConversionEntry[] | undefined) ?? [];
    return configuredConversions.length > 0
      ? configuredConversions
      : [{ ...EMPTY_TYPE_CONVERSION }];
  }, [node.config.conversions]);

  const commitConversions = useCallback(
    (next: TypeConversionEntry[]) => {
      updateConfig((cfg) => ({ ...cfg, conversions: next.length > 0 ? next : undefined }));
    },
    [updateConfig]
  );

  const {
    activeItems: activeConversions,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    isDragging,
    resetDrag,
    dragIndexRef,
  } = useDragReorder(conversions, commitConversions);

  useEffect(() => {
    if (!isDragging) resetDrag();
  }, [conversions, isDragging, resetDrag]);

  const updateConversion = useCallback(
    (index: number, patch: Partial<TypeConversionEntry>) => {
      const next = activeConversions.map((c, i) => (i === index ? { ...c, ...patch } : c));
      commitConversions(next);
    },
    [activeConversions, commitConversions]
  );

  const addConversionAfter = useCallback(
    (index: number) => {
      if (activeConversions.length >= fieldCompletions.length) return;
      const next = [...activeConversions];
      next.splice(index + 1, 0, { ...EMPTY_TYPE_CONVERSION });
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
        column: '',
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
    () => computeUsedFields(activeConversions, (c) => c.column),
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

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: conversion rules */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="scrollbar-hover flex-1 space-y-1 overflow-y-auto px-2 pr-3 pb-2 pt-1">
          <GlassRowList
            headerClassName=""
            variant="table"
            items={activeConversions}
            columns={[
              {
                flex: 'flex-[1]',
                header: tr('typeConvertSourceField'),
                render: (conv: TypeConversionEntry, i: number) => {
                  const disabledFields = new Set(usedFields);
                  if (conv.column) disabledFields.delete(conv.column);
                  return (
                    <GlassFieldSingleSelect
                      value={conv.column}
                      options={fieldCompletions}
                      columnTypes={columnTypes}
                      onChange={(value) => updateConversion(i, { column: value })}
                      placeholder={tr('typeConvertSelectField')}
                      searchPlaceholder={tr('searchField')}
                      emptyText={tr('noMatch')}
                      disabledOptions={disabledFields}
                      className="flex-1 min-w-0 h-7"
                    />
                  );
                },
              },
              {
                flex: 'flex-[1]',
                header: tr('typeConvertTargetType'),
                render: (conv: TypeConversionEntry, i: number) => (
                  <GlassOptionSingleSelect
                    value={normalizeDataFieldType(conv.type)}
                    onChange={(v) => {
                      const newType = v as DataFieldType;
                      updateConversion(i, {
                        ...prepareTypeConversion(newType),
                      });
                    }}
                    groups={[
                      {
                        key: 'types',
                        items: DATA_FIELD_TYPES.map((t) => ({
                          value: t,
                          label: dataTypeLabel(t),
                        })),
                      },
                    ]}
                    className="h-6 w-full text-[12px]"
                  />
                ),
              },
              {
                flex: 'flex-[1]',
                header: tr('typeConvertTypeSettings'),
                render: (conv: TypeConversionEntry, i: number) => {
                  const isDateType = conv.type === 'date' || conv.type === 'datetime';
                  if (isDateType) {
                    const formatOptions = [
                      { value: '', label: tr('typeConvertAutoParse') },
                      ...DATE_FORMAT_PRESETS.map((p) => ({ value: p.value, label: p.example })),
                    ];
                    return (
                      <GlassOptionSingleSelect
                        value={conv.format ?? ''}
                        groups={[{ key: 'formats', items: formatOptions }]}
                        onChange={(v) =>
                          updateConversion(i, {
                            format: (v || undefined) as DateFormat | undefined,
                          })
                        }
                        variant="muted"
                        className="h-6 w-full text-[12px]"
                      />
                    );
                  }
                  if (conv.type === 'decimal') {
                    return (
                      <GlassOptionSingleSelect
                        value={conv.scale != null ? String(conv.scale) : String(SCALE_MIN)}
                        groups={[
                          {
                            key: 'scale',
                            items: Array.from({ length: SCALE_MAX - SCALE_MIN + 1 }, (_, k) => {
                              const n = SCALE_MIN + k;
                              return {
                                value: String(n),
                                label: tr('typeConvertScaleOption', { n }),
                              };
                            }),
                          },
                        ]}
                        onChange={(v) =>
                          updateConversion(i, {
                            scale: parseTypeConversionScale(v),
                          })
                        }
                        variant="muted"
                        className="h-6 w-full text-[12px]"
                      />
                    );
                  }
                  return (
                    <span className="flex h-7 w-full items-center rounded border border-border-subtle/80 bg-surface-hover/45 px-1.5 text-left text-[12px] text-text-muted">
                      {tr('typeConvertNoSettings')}
                    </span>
                  );
                },
              },
              {
                flex: 'flex-[1]',
                header: tr('typeConvertErrorHandling'),
                render: (conv: TypeConversionEntry, i: number) => (
                  <GlassOptionSingleSelect
                    value={conv.onError ?? 'null'}
                    onChange={(v) =>
                      updateConversion(i, {
                        onError: v !== 'null' ? (v as 'keep' | 'fail') : undefined,
                      })
                    }
                    groups={[
                      {
                        key: 'errors',
                        items: onErrorOptions.map((o) => ({
                          value: o.value,
                          label: o.label,
                        })),
                      },
                    ]}
                    className="h-6 w-full text-[12px]"
                  />
                ),
              },
            ]}
            onAdd={(i) => addConversionAfter(i)}
            onRemove={(i) => removeConversion(i)}
            onCopy={copyConversion}
            addTitle={tr('typeConvertAdd')}
            removeTitle={tr('typeConvertRemove')}
            copyTitle={tr('fieldMappingCopy')}
            actions={['add', 'copy', 'remove']}
            canAct={(action: RowAction) =>
              action === 'remove' ? true : activeConversions.length < fieldCompletions.length
            }
            draggable
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            getRowOpacity={(i) => !!(isDragging && dragIndexRef.current === i)}
            dragTitle={tr('dragToReorder')}
          />
        </div>
      </div>
    </div>
  );
}
