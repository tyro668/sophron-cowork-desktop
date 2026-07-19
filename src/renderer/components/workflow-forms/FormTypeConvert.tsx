import { useCallback, useEffect, useMemo } from 'react';
import type { OperatorFormProps } from './index';
import {
  DATA_FIELD_TYPES,
  dataFieldTypeLabel,
  normalizeDataFieldType,
  type DataFieldType,
} from '../../../shared/data-field-types';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import { GlassRowList } from './shared/GlassRowList';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
import { useDragReorder } from '../../hooks/useDragReorder';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { computeUsedFields } from './shared/used-fields';

interface ConversionEntry {
  column: string;
  type: string;
  onError?: string;
}

const DEFAULT_CONVERSION: ConversionEntry = { column: '', type: 'text' };

export default function FormTypeConvert({
  node,
  taskId,
  fieldCompletions,
  sourceNode,
  onNodeChange,
}: OperatorFormProps) {
  const tr = useFormTranslation();
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
      { value: 'null', label: tr('typeConvertErrorNull', '转换出错则填充空值') },
      { value: 'fail', label: tr('typeConvertErrorFail', '转换出错则显示报错') },
      { value: 'keep', label: tr('typeConvertErrorKeep', '转换出错则保留原值') },
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
                header: tr('typeConvertSourceField', '待转换字段'),
                render: (conv: ConversionEntry, i: number) => {
                  const disabledFields = new Set(usedFields);
                  if (conv.column) disabledFields.delete(conv.column);
                  return (
                    <GlassFieldSingleSelect
                      value={conv.column}
                      options={fieldCompletions}
                      columnTypes={columnTypes}
                      onChange={(value) => updateConversion(i, { column: value })}
                      placeholder={tr('typeConvertSelectField', '选择字段')}
                      searchPlaceholder={tr('searchField', '搜索字段')}
                      emptyText={tr('noMatch', '无匹配字段')}
                      disabledOptions={disabledFields}
                      className="flex-1 min-w-0 h-7"
                    />
                  );
                },
              },
              {
                flex: 'flex-[1.2]',
                header: tr('typeConvertOriginalType', '原类型'),
                render: (conv: ConversionEntry) => (
                  <span className="w-full text-center text-[11px] text-text-muted tabular-nums">
                    {conv.column && columnTypes?.[conv.column]
                      ? dataFieldTypeLabel(columnTypes[conv.column])
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
                header: tr('typeConvertTargetType', '目标类型'),
                render: (conv: ConversionEntry, i: number) => (
                  <GlassOptionSingleSelect
                    value={normalizeDataFieldType(conv.type)}
                    onChange={(v) => updateConversion(i, { type: v as DataFieldType })}
                    groups={[
                      {
                        key: 'types',
                        items: DATA_FIELD_TYPES.map((t) => ({
                          value: t,
                          label: dataFieldTypeLabel(t),
                        })),
                      },
                    ]}
                    className="h-6 w-full text-[12px]"
                  />
                ),
              },
              {
                flex: 'flex-[2]',
                header: tr('typeConvertErrorHandling', '错误处理'),
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
            addTitle={tr('typeConvertAdd', '添加转换')}
            removeTitle={tr('typeConvertRemove', '删除转换')}
            draggable
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            getRowOpacity={(i) => !!(isDragging && dragIndexRef.current === i)}
            dragTitle={tr('dragToReorder', '拖拽排序')}
          />
        </div>
      </div>
    </div>
  );
}
