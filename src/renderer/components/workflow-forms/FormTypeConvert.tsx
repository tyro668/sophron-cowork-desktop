import { useCallback, useEffect, useMemo } from 'react';
import type { OperatorFormProps } from './index';
import {
  DATA_FIELD_TYPES,
  normalizeDataFieldType,
  type DataFieldType,
} from '../../../shared/data-field-types';
import { Settings } from 'lucide-react';
import { GlassDropdownMenu, GlassMenuItem } from '../GlassDropdownMenu';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import { GlassRowList } from './shared/GlassRowList';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
import { useDragReorder } from '../../hooks/useDragReorder';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useDataFieldTypeLabel } from '../../hooks/useDataFieldTypeLabel';
import { computeUsedFields } from './shared/used-fields';

interface ConversionEntry {
  column: string;
  type: string;
  onError?: string;
  format?: string;
}

const DEFAULT_CONVERSION: ConversionEntry = { column: '', type: 'text' };

const DATE_FORMAT_PRESETS: Array<{ value: string; example: string }> = [
  { value: '%Y-%m-%d', example: '2000-01-01' },
  { value: '%Y/%m/%d', example: '2000/1/1' },
  { value: '%m/%d/%Y', example: '1/1/2000' },
  { value: '%m/%d/%y', example: '1/1/00' },
  { value: '%d/%m/%Y', example: '1/1/2000' },
  { value: '%Y%m%d', example: '20000101' },
];

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

  const conversions = useMemo<ConversionEntry[]>(
    () => (node.config.conversions as ConversionEntry[]) ?? [{ ...DEFAULT_CONVERSION }],
    [node.config.conversions]
  );

  const commitConversions = useCallback(
    (next: ConversionEntry[]) => {
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
    (index: number, patch: Partial<ConversionEntry>) => {
      const next = activeConversions.map((c, i) => (i === index ? { ...c, ...patch } : c));
      commitConversions(next);
    },
    [activeConversions, commitConversions]
  );

  const addConversionAfter = useCallback(
    (index: number) => {
      const next = [...activeConversions];
      next.splice(index + 1, 0, { ...DEFAULT_CONVERSION });
      commitConversions(next);
    },
    [activeConversions, commitConversions]
  );

  const removeConversion = useCallback(
    (index: number) => {
      if (activeConversions.length <= 1) {
        commitConversions([{ ...DEFAULT_CONVERSION }]);
        return;
      }
      commitConversions(activeConversions.filter((_, i) => i !== index));
    },
    [activeConversions, commitConversions]
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
        <div className="flex-1 space-y-1 overflow-y-auto px-2 pr-3 pb-2 pt-1">
          <GlassRowList
            headerClassName="text-[12px]"
            items={activeConversions}
            columns={[
              {
                flex: 'flex-[3]',
                header: tr('typeConvertSourceField'),
                render: (conv: ConversionEntry, i: number) => {
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
                flex: 'flex-[1.2]',
                header: tr('typeConvertOriginalType'),
                render: (conv: ConversionEntry) => (
                  <span className="w-full text-center text-[11px] text-text-muted tabular-nums">
                    {conv.column && columnTypes?.[conv.column]
                      ? dataTypeLabel(columnTypes[conv.column])
                      : ''}
                  </span>
                ),
              },
              {
                flex: 'flex-[0.6]',
                header: '',
                render: () => (
                  <div className="flex items-center gap-0.5 justify-center text-text-muted">
                    <div className="h-[2.5px] w-[14px] bg-current rounded-full" />
                    <div className="h-0 w-0 border-l-[9px] border-l-current border-y-[7px] border-y-transparent" />
                  </div>
                ),
              },
              {
                flex: 'flex-[2]',
                header: tr('typeConvertTargetType'),
                render: (conv: ConversionEntry, i: number) => (
                  <GlassOptionSingleSelect
                    value={normalizeDataFieldType(conv.type)}
                    onChange={(v) => updateConversion(i, { type: v as DataFieldType })}
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
                flex: 'flex-[2]',
                header: tr('typeConvertErrorHandling'),
                render: (conv: ConversionEntry, i: number) => (
                  <GlassOptionSingleSelect
                    value={conv.onError ?? 'null'}
                    onChange={(v) =>
                      updateConversion(i, {
                        onError: v !== 'null' ? v : undefined,
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
            renderExtraActions={(i: number) => {
              const conv = activeConversions[i];
              const isDateType = conv.type === 'date' || conv.type === 'datetime';
              const hasFormat = !!conv.format;
              return (
                <GlassDropdownMenu
                  trigger={
                    <button
                      type="button"
                      disabled={!isDateType}
                      className={`inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded transition-colors ${
                        isDateType
                          ? 'cursor-pointer text-text-muted hover:bg-surface-hover hover:text-accent'
                          : 'cursor-not-allowed opacity-30'
                      } ${hasFormat && isDateType ? 'text-accent' : ''}`}
                      title={tr('typeConvertDateFormat')}
                      aria-label={tr('typeConvertDateFormat')}
                    >
                      <Settings className="h-3.5 w-3.5" />
                    </button>
                  }
                >
                  {DATE_FORMAT_PRESETS.map((preset) => (
                    <GlassMenuItem
                      key={preset.value}
                      selected={conv.format === preset.value}
                      onSelect={() =>
                        updateConversion(i, {
                          format: conv.format === preset.value ? undefined : preset.value,
                        })
                      }
                    >
                      <span className="flex items-center justify-between w-full">
                        <span>{preset.value}</span>
                        <span className="text-[11px] text-text-muted ml-2">{preset.example}</span>
                      </span>
                    </GlassMenuItem>
                  ))}
                </GlassDropdownMenu>
              );
            }}
            addTitle={tr('typeConvertAdd')}
            removeTitle={tr('typeConvertRemove')}
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
