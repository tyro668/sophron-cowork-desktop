import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import type { OperatorFormProps } from './index';
import {
  DATA_FIELD_TYPES,
  dataFieldTypeLabel,
  normalizeDataFieldType,
  type DataFieldType,
} from '../../../shared/data-field-types';
import { GlassFieldCombo } from './shared/GlassFieldCombo';
import { GlassOperatorSelect } from './shared/GlassOperatorSelect';

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
    () => (node.config.conversions as ConversionEntry[]) ?? [],
    [node.config.conversions]
  );

  const commitConversions = useCallback(
    (next: ConversionEntry[]) => {
      updateConfig((cfg) => ({ ...cfg, conversions: next.length > 0 ? next : undefined }));
    },
    [updateConfig]
  );

  // Display at least one empty row
  const displayConversions = useMemo(() => {
    return conversions.length > 0 ? conversions : [{ ...DEFAULT_CONVERSION }];
  }, [conversions]);

  // ── Drag-to-reorder state ──
  const dragIndexRef = useRef<number | null>(null);
  const dropTargetRef = useRef<number | null>(null);
  const [dragConversions, setDragConversions] = useState<ConversionEntry[] | null>(null);

  useEffect(() => {
    if (dragIndexRef.current === null) setDragConversions(null);
  }, [displayConversions]);

  const activeConversions = dragConversions ?? displayConversions;

  // ── Selected index for right panel ──
  const [selectedIndex, setSelectedIndex] = useState(0);

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
      setSelectedIndex(index + 1);
    },
    [activeConversions, commitConversions]
  );

  const removeConversion = useCallback(
    (index: number) => {
      if (activeConversions.length <= 1) {
        commitConversions([]);
        setSelectedIndex(0);
        return;
      }
      commitConversions(activeConversions.filter((_, i) => i !== index));
      setSelectedIndex((prev) => Math.max(0, Math.min(prev, activeConversions.length - 2)));
    },
    [activeConversions, commitConversions]
  );

  const handleDragStart = useCallback(
    (index: number) => {
      dragIndexRef.current = index;
      setDragConversions([...displayConversions]);
    },
    [displayConversions]
  );

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    dropTargetRef.current = index;
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
    dropTargetRef.current = null;
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
          {/* Header */}
          <div className="flex items-center gap-1.5 px-1.5 pb-1 text-[12px] font-medium text-text-muted">
            <span className="flex h-7 w-4 flex-shrink-0" aria-hidden="true" />
            <span className="flex flex-[3] min-w-0 items-center justify-center">
              {tr('typeConvertSourceField', '待转换字段')}
            </span>
            <span className="flex w-14 flex-shrink-0 items-center justify-center">
              {tr('typeConvertOriginalType', '原类型')}
            </span>
            <span className="flex flex-[2] min-w-0 items-center justify-center">
              {tr('typeConvertTargetType', '目标类型')}
            </span>
            <span className="flex flex-[2] min-w-0 items-center justify-center">
              {tr('typeConvertErrorHandling', '错误处理')}
            </span>
            <span className="flex h-7 w-7 flex-shrink-0" aria-hidden="true" />
            <span className="flex h-7 w-7 flex-shrink-0" aria-hidden="true" />
          </div>

          {activeConversions.map((conv, i) => {
            const disabledFields = new Set(usedFields);
            if (conv.column) disabledFields.delete(conv.column);
            const normalizedType = normalizeDataFieldType(conv.type);

            return (
              <div
                key={i}
                onDragOver={(e) => handleDragOver(e, i)}
                className={`${dragConversions && dropTargetRef.current === i && dragIndexRef.current !== i ? 'relative' : ''}`}
              >
                {dragConversions && dropTargetRef.current === i && dragIndexRef.current !== i && (
                  <div className="pointer-events-none absolute -top-0.5 left-0 right-0 h-0.5 bg-accent" />
                )}
                <div
                  className={`flex items-center gap-1.5 rounded px-1.5 py-1 transition-colors hover:bg-surface-hover/40 group ${
                    dragConversions && dragIndexRef.current === i ? 'opacity-50' : ''
                  } ${selectedIndex === i ? 'bg-accent/5 ring-1 ring-inset ring-accent/20' : ''}`}
                  onClick={() => setSelectedIndex(i)}
                >
                  {/* Drag handle */}
                  <div
                    draggable
                    onDragStart={() => handleDragStart(i)}
                    onDragEnd={handleDragEnd}
                    className="flex h-6 w-4 flex-shrink-0 cursor-grab items-center justify-center text-text-muted transition-colors hover:text-text-secondary active:cursor-grabbing"
                    title={tr('dragToReorder', '拖拽排序')}
                    aria-label={tr('dragToReorder', '拖拽排序')}
                  >
                    <GripVertical className="h-4 w-4" />
                  </div>

                  {/* Source field */}
                  <GlassFieldCombo
                    value={conv.column}
                    options={fieldCompletions}
                    columnTypes={columnTypes}
                    onChange={(value) => updateConversion(i, { column: value })}
                    placeholder={tr('typeConvertSelectField', '选择字段')}
                    searchPlaceholder={tr('searchField', '搜索字段')}
                    emptyText={tr('noMatch', '无匹配字段')}
                    disabledOptions={disabledFields}
                    className="flex-[3] min-w-0"
                  />

                  {/* Original type badge */}
                  {conv.column && columnTypes?.[conv.column] && (
                    <span className="w-14 flex-shrink-0 text-center text-[11px] text-text-muted tabular-nums">
                      {dataFieldTypeLabel(columnTypes[conv.column])}
                    </span>
                  )}
                  {!conv.column && <span className="w-14 flex-shrink-0" />}

                  {/* Arrow */}
                  <div className="flex items-center gap-0.5 w-7 flex-shrink-0 justify-center transition-colors group-hover:text-accent">
                    <div className="h-[2.5px] w-[14px] bg-current rounded-full" />
                    <div className="h-0 w-0 border-l-[9px] border-l-current border-y-[7px] border-y-transparent" />
                  </div>

                  {/* Target type */}
                  <GlassOperatorSelect
                    value={normalizedType}
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
                    className="h-6 flex-[2] min-w-0 text-[12px]"
                  />

                  {/* Error handling */}
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
                    className="h-6 flex-[2] min-w-0 text-[12px]"
                  />

                  {/* Add */}
                  <button
                    type="button"
                    onClick={() => addConversionAfter(i)}
                    className="inline-flex h-7 w-7 flex-shrink-0 cursor-pointer items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-hover hover:text-accent"
                    title={tr('typeConvertAdd', '添加转换')}
                    aria-label={tr('typeConvertAdd', '添加转换')}
                  >
                    <Plus className="h-4 w-4" />
                  </button>

                  {/* Delete */}
                  <button
                    type="button"
                    onClick={() => removeConversion(i)}
                    className="inline-flex h-7 w-7 flex-shrink-0 cursor-pointer items-center justify-center rounded text-text-muted transition-colors hover:text-error hover:bg-error/10"
                    title={tr('typeConvertRemove', '删除转换')}
                    aria-label={tr('typeConvertRemove', '删除转换')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
