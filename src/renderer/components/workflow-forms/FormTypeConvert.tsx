import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OperatorFormProps } from './index';
import {
  DATA_FIELD_TYPES,
  dataFieldTypeLabel,
  normalizeDataFieldType,
  type DataFieldType,
} from '../../../shared/data-field-types';
import { GlassFieldCombo } from './shared/GlassFieldCombo';
import { GlassOperatorSelect } from './shared/GlassOperatorSelect';
import { GlassRowList } from './shared/GlassRowList';

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
  const { t } = useTranslation();
  const tr = useCallback(
    (key: string, fallback: string) =>
      t(`data.workflow.formLabels.${key}`, { defaultValue: fallback }),
    [t]
  );

  // ── Column types ──
  const [columnTypes, setColumnTypes] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!taskId || !sourceNode?.id) return;
    const api = window.electronAPI?.data;
    if (!api?.getWorkflowNodeColumnTypes) return;
    api
      .getWorkflowNodeColumnTypes({
        taskId,
        nodeId: sourceNode.id,
        nodeType: sourceNode.type as never,
        nodeConfig: (sourceNode.config ?? {}) as Record<string, unknown>,
      })
      .then((types) => {
        const map: Record<string, string> = {};
        for (const t of types) map[t.name] = t.type;
        setColumnTypes(map);
      })
      .catch(() => setColumnTypes({}));
  }, [taskId, sourceNode?.id, sourceNode?.type, sourceNode?.config]);

  const updateConfig = useCallback(
    (updater: (config: Record<string, unknown>) => Record<string, unknown>) => {
      onNodeChange((current) => ({
        ...current,
        config: updater(current.config),
        updatedAt: Date.now(),
      }));
    },
    [onNodeChange]
  );

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

  // ── Drag-to-reorder state ──
  const dragIndexRef = useRef<number | null>(null);
  const [dragConversions, setDragConversions] = useState<ConversionEntry[] | null>(null);

  const activeConversions = dragConversions ?? conversions;

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

  const handleDragStart = useCallback(
    (index: number) => {
      dragIndexRef.current = index;
      setDragConversions([...conversions]);
    },
    [conversions]
  );

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndexRef.current === null || dragIndexRef.current === index) return;
    const from = dragIndexRef.current;
    setDragConversions((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(index, 0, moved);
      return next;
    });
    dragIndexRef.current = index;
  }, []);

  const handleDragEnd = useCallback(() => {
    if (dragConversions && dragIndexRef.current !== null) {
      commitConversions(dragConversions);
    }
    dragIndexRef.current = null;
    setDragConversions(null);
  }, [dragConversions, commitConversions]);

  // Used fields for deduplication
  const usedFields = useMemo(() => {
    const used = new Set<string>();
    for (const c of activeConversions) {
      if (c.column) used.add(c.column);
    }
    return used;
  }, [activeConversions]);

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
            items={activeConversions}
            columns={[
              {
                flex: 'flex-[3]',
                header: tr('typeConvertSourceField', '待转换字段'),
                render: (conv: ConversionEntry, i: number) => {
                  const disabledFields = new Set(usedFields);
                  if (conv.column) disabledFields.delete(conv.column);
                  return (
                    <GlassFieldCombo
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
                  <span className="text-[11px] text-text-muted tabular-nums">
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
                  <GlassOperatorSelect
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
                  <GlassOperatorSelect
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
            getRowOpacity={(i) => !!(dragConversions && dragIndexRef.current === i)}
            dragTitle={tr('dragToReorder', '拖拽排序')}
          />
        </div>
      </div>
    </div>
  );
}
