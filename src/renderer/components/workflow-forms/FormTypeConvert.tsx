import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, GripVertical, ArrowRight, Settings } from 'lucide-react';
import type { OperatorFormProps } from './index';
import {
  DATA_FIELD_TYPES,
  dataFieldTypeLabel,
  normalizeDataFieldType,
  type DataFieldType,
} from '../../../shared/data-field-types';
import { FieldCombobox } from './shared/FieldCombobox';

interface ConversionEntry {
  column: string;
  type: string;
  format?: string;
  onError?: string;
  locale?: string;
  timezone?: string;
}

const DEFAULT_CONVERSION: ConversionEntry = { column: '', type: 'text' };

const DATE_FORMATS = [
  'yyyy-MM-dd',
  'yyyy/MM/dd',
  'yyyy.MM.dd',
  'dd/MM/yyyy',
  'MM/dd/yyyy',
  'yyyy-MM-dd HH:mm:ss',
  'yyyy/MM/dd HH:mm:ss',
  'yyyy-MM-dd HH:mm',
  'yyyyMMdd',
];

const TIMESTAMP_FORMATS = [
  'yyyy-MM-dd HH:mm:ss',
  'yyyy/MM/dd HH:mm:ss',
  'yyyy-MM-dd HH:mm:ss.SSS',
  'yyyy-MM-dd HH:mm',
  'yyyy-MM-dd',
  'yyyyMMddHHmmss',
];

const TIMEZONE_OPTIONS = [
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Singapore',
  'Asia/Kolkata',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'UTC',
];

const ON_ERROR_OPTIONS = [
  { value: 'null', label: '置空' },
  { value: 'fail', label: '报错' },
  { value: 'keep', label: '保留' },
];

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
  const [dragConversions, setDragConversions] = useState<ConversionEntry[] | null>(null);

  useEffect(() => {
    if (dragIndexRef.current === null) setDragConversions(null);
  }, [displayConversions]);

  const activeConversions = dragConversions ?? displayConversions;

  // ── Selected index for right panel ──
  const [selectedIndex, setSelectedIndex] = useState(0);

  // ── Expanded config panels ──
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  const toggleRowExpanded = useCallback((index: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

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

  // Real conversions (with field selected)
  const realConversions = useMemo(
    () => activeConversions.filter((c) => c.column),
    [activeConversions]
  );

  // Available target types (exclude current source type)
  const availableTargetTypes = useMemo(() => {
    return DATA_FIELD_TYPES;
  }, []);

  return (
    <div className="grid h-full grid-cols-[7fr_3fr] overflow-hidden">
      {/* Left: conversion rules */}
      <div className="flex min-h-0 flex-col overflow-hidden border-r border-border-muted">
        <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pr-3 pb-2 pt-1">
          {/* Header */}
          <div className="flex items-center gap-1 px-1.5 pb-0.5 text-[11px] font-medium text-text-muted">
            <span className="flex h-6 w-4 flex-shrink-0" aria-hidden="true" />
            <span className="flex-[5] min-w-0 text-center">
              {tr('typeConvertSourceField', '待转换字段')}
            </span>
            <span className="w-6 flex-shrink-0" aria-hidden="true" />
            <span className="flex-[3] min-w-0 text-center">
              {tr('typeConvertTargetType', '目标类型')}
            </span>
            <span className="flex-[2] min-w-0 text-center">
              {tr('typeConvertErrorHandling', '错误处理')}
            </span>
            <span className="flex h-6 w-6 flex-shrink-0" aria-hidden="true" />
            <span className="flex h-6 w-6 flex-shrink-0" aria-hidden="true" />
            <span className="flex h-6 w-6 flex-shrink-0" aria-hidden="true" />
          </div>

          {activeConversions.map((conv, i) => {
            const disabledFields = new Set(usedFields);
            if (conv.column) disabledFields.delete(conv.column);
            const normalizedType = normalizeDataFieldType(conv.type);
            const needsConfig =
              normalizedType === 'date' ||
              normalizedType === 'datetime' ||
              normalizedType === 'decimal';
            const isExpanded = expandedRows.has(i);
            const showFormat = normalizedType === 'date' || normalizedType === 'datetime';
            const showTimezone = normalizedType === 'datetime';
            const showLocale = normalizedType === 'decimal';
            const hasConfig = conv.format || conv.timezone || conv.locale;

            return (
              <div key={i} onDragOver={(e) => handleDragOver(e, i)}>
                <div
                  className={`flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-surface-hover/40 ${
                    dragConversions && dragIndexRef.current === i ? 'opacity-50' : ''
                  } ${selectedIndex === i ? 'bg-surface-hover/30' : ''}`}
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

                  {/* Source field with type */}
                  <FieldCombobox
                    value={conv.column}
                    options={fieldCompletions}
                    columnTypes={columnTypes}
                    onChange={(value) => updateConversion(i, { column: value })}
                    placeholder={tr('typeConvertSelectField', '选择字段')}
                    searchPlaceholder={tr('searchField', '搜索字段')}
                    emptyText={tr('noMatch', '无匹配字段')}
                    disabledOptions={disabledFields}
                    className="flex-[5] min-w-0"
                    showType
                  />

                  {/* Arrow */}
                  <ArrowRight className="w-6 flex-shrink-0 text-text-muted" />

                  {/* Target type */}
                  <select
                    value={normalizedType}
                    onChange={(e) => updateConversion(i, { type: e.target.value as DataFieldType })}
                    className="h-6 flex-[3] min-w-0 rounded border border-border-muted bg-background/42 px-1.5 text-center text-[12px] text-text-primary outline-none focus:border-accent"
                  >
                    {availableTargetTypes.map((t) => (
                      <option key={t} value={t}>
                        {dataFieldTypeLabel(t)}
                      </option>
                    ))}
                  </select>

                  {/* Error handling */}
                  <select
                    value={conv.onError ?? 'null'}
                    onChange={(e) =>
                      updateConversion(i, {
                        onError: e.target.value !== 'null' ? e.target.value : undefined,
                      })
                    }
                    className="h-6 flex-[2] min-w-0 rounded border border-border-muted bg-background/42 px-1.5 text-center text-[12px] text-text-secondary outline-none focus:border-accent"
                  >
                    {ON_ERROR_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>

                  {/* Config toggle - always visible, disabled when not applicable */}
                  <button
                    type="button"
                    onClick={(e) => {
                      if (needsConfig) {
                        e.stopPropagation();
                        toggleRowExpanded(i);
                      }
                    }}
                    disabled={!needsConfig}
                    className={`inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded transition-colors ${
                      needsConfig
                        ? hasConfig
                          ? 'cursor-pointer text-accent hover:bg-accent/10'
                          : isExpanded
                            ? 'cursor-pointer text-accent hover:bg-accent/10'
                            : 'cursor-pointer text-warning hover:bg-warning/10'
                        : 'cursor-not-allowed text-text-muted/40'
                    }`}
                    title={
                      needsConfig
                        ? hasConfig
                          ? tr('typeConvertEditConfig', '编辑配置')
                          : tr('typeConvertNeedConfig', '需要配置')
                        : tr('typeConvertNoConfigNeeded', '无需配置')
                    }
                  >
                    <Settings className="h-3.5 w-3.5" />
                  </button>

                  {/* Add */}
                  <button
                    type="button"
                    onClick={() => addConversionAfter(i)}
                    className="inline-flex h-6 w-6 flex-shrink-0 cursor-pointer items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-hover hover:text-accent"
                    title={tr('typeConvertAdd', '添加转换')}
                    aria-label={tr('typeConvertAdd', '添加转换')}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>

                  {/* Delete */}
                  <button
                    type="button"
                    onClick={() => removeConversion(i)}
                    className="inline-flex h-6 w-6 flex-shrink-0 cursor-pointer items-center justify-center rounded text-text-muted transition-colors hover:text-error hover:bg-error/10"
                    title={tr('typeConvertRemove', '删除转换')}
                    aria-label={tr('typeConvertRemove', '删除转换')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Expanded config panel */}
                {isExpanded && needsConfig && (
                  <div className="ml-6 mt-1 mb-1 space-y-1.5 rounded border border-border-muted bg-background/20 p-2">
                    {showFormat && (
                      <div className="flex items-center gap-2">
                        <label className="w-16 flex-shrink-0 text-[11px] text-text-secondary">
                          {tr('typeConvertDateFormat', '日期格式')}
                        </label>
                        <input
                          type="text"
                          list={`fmt-list-${i}`}
                          value={conv.format ?? ''}
                          onChange={(e) =>
                            updateConversion(i, { format: e.target.value || undefined })
                          }
                          placeholder={
                            normalizedType === 'datetime' ? 'yyyy-MM-dd HH:mm:ss' : 'yyyy-MM-dd'
                          }
                          className="h-6 flex-1 rounded border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
                        />
                        <datalist id={`fmt-list-${i}`}>
                          {(normalizedType === 'datetime' ? TIMESTAMP_FORMATS : DATE_FORMATS).map(
                            (f) => (
                              <option key={f} value={f} />
                            )
                          )}
                        </datalist>
                      </div>
                    )}

                    {showTimezone && (
                      <div className="flex items-center gap-2">
                        <label className="w-16 flex-shrink-0 text-[11px] text-text-secondary">
                          {tr('typeConvertTimezone', '时区')}
                        </label>
                        <input
                          type="text"
                          list={`tz-list-${i}`}
                          value={conv.timezone ?? ''}
                          onChange={(e) =>
                            updateConversion(i, { timezone: e.target.value || undefined })
                          }
                          placeholder="Asia/Shanghai"
                          className="h-6 flex-1 rounded border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
                        />
                        <datalist id={`tz-list-${i}`}>
                          {TIMEZONE_OPTIONS.map((tz) => (
                            <option key={tz} value={tz} />
                          ))}
                        </datalist>
                      </div>
                    )}

                    {showLocale && (
                      <div className="flex items-center gap-2">
                        <label className="w-16 flex-shrink-0 text-[11px] text-text-secondary">
                          {tr('typeConvertLocale', '区域')}
                        </label>
                        <input
                          type="text"
                          value={conv.locale ?? ''}
                          onChange={(e) =>
                            updateConversion(i, { locale: e.target.value || undefined })
                          }
                          placeholder="de_DE"
                          className="h-6 flex-1 rounded border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Right: summary */}
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-2 pb-2 pt-1 pl-3">
        <div>
          <h5 className="mb-2 text-[11px] font-medium text-text-muted">
            {tr('typeConvertCurrentRules', '当前转换规则')}
          </h5>
          {realConversions.length === 0 ? (
            <p className="text-[12px] leading-5 text-text-secondary">
              {tr('typeConvertNoRules', '未设置转换规则，请在左侧添加。')}
            </p>
          ) : (
            <ol className="space-y-1.5">
              {realConversions.map((c, i) => {
                const normalizedType = normalizeDataFieldType(c.type);
                const configParts: string[] = [];
                if (c.format) configParts.push(c.format);
                if (c.timezone) configParts.push(c.timezone);
                if (c.locale) configParts.push(c.locale);
                const configStr = configParts.length > 0 ? ` (${configParts.join(', ')})` : '';

                return (
                  <li key={i} className="flex items-start gap-2 text-[12px]">
                    <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded bg-surface text-[10px] font-medium tabular-nums text-text-muted">
                      {i + 1}
                    </span>
                    <span className="leading-4 text-text-primary">
                      {c.column}
                      <span className="text-text-secondary">
                        {' '}
                        → {dataFieldTypeLabel(normalizedType)}
                      </span>
                      {configStr && <span className="text-text-muted">{configStr}</span>}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div className="rounded-md border border-border-muted bg-background/42 px-2.5 py-2">
          <p className="text-[11px] leading-4 text-text-muted">
            {tr(
              'typeConvertHint',
              '提示：拖拽可调整执行顺序，点击齿轮图标可配置日期格式、时区等选项。'
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
