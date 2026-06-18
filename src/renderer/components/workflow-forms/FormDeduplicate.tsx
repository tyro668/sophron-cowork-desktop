import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X, Plus, Trash2, GripVertical } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { DATA_FIELD_TYPE_LABELS, normalizeDataFieldType } from '../../../shared/data-field-types';

interface SortKeyEntry {
  field: string;
  direction: 'asc' | 'desc';
  nulls?: 'first' | 'last';
}

const DEFAULT_SORT_KEY: SortKeyEntry = { field: '', direction: 'asc' };

export default function FormDeduplicate({
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
      .catch((err) => {
        console.error('Failed to fetch column types for dedup:', err);
        setColumnTypes({});
      });
  }, [taskId, sourceNode?.id, sourceNode?.type, sourceNode?.config]);

  const typeLabel = useCallback(
    (col: string) => {
      const raw = columnTypes[col];
      if (!raw) return '';
      return DATA_FIELD_TYPE_LABELS[normalizeDataFieldType(raw)] ?? '';
    },
    [columnTypes]
  );

  // ── Config ──
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

  const columns: string[] = (node.config?.columns as string[]) ?? [];
  const keep = (node.config?.keep as string) ?? 'first';
  const orderBy: SortKeyEntry[] = (node.config?.orderBy as SortKeyEntry[]) ?? [];

  // ── Field search ──
  const [search, setSearch] = useState('');

  const filteredFields = useMemo(() => {
    const lower = search.toLowerCase().trim();
    if (!lower) return fieldCompletions;
    return fieldCompletions.filter((c) => {
      if (c.toLowerCase().includes(lower)) return true;
      const raw = columnTypes[c];
      if (!raw) return false;
      const label = DATA_FIELD_TYPE_LABELS[normalizeDataFieldType(raw)] ?? '';
      return label.includes(lower);
    });
  }, [fieldCompletions, search, columnTypes]);

  const allFilteredSelected =
    filteredFields.length > 0 && filteredFields.every((c) => columns.includes(c));

  // ── Scroll preservation ──
  const listRef = useRef<HTMLDivElement | null>(null);
  const savedScrollRef = useRef(0);

  const setListRef = useCallback((el: HTMLDivElement | null) => {
    listRef.current = el;
    if (el && savedScrollRef.current > 0 && el.scrollHeight > savedScrollRef.current) {
      el.scrollTop = savedScrollRef.current;
    }
  }, []);

  const commitColumns = useCallback(
    (next: string[]) => {
      savedScrollRef.current = listRef.current?.scrollTop ?? 0;
      updateConfig((cfg) => ({
        ...cfg,
        strategy: next.length > 0 ? 'by_columns' : 'all_columns',
        columns: next.length > 0 ? next : undefined,
      }));
    },
    [updateConfig]
  );

  useLayoutEffect(() => {
    const el = listRef.current;
    const saved = savedScrollRef.current;
    if (!el || saved <= 0 || el.scrollHeight <= saved) return;
    el.scrollTop = saved;
  });

  // ── Field selection actions ──
  const toggleAll = useCallback(() => {
    if (filteredFields.length === 0) return;
    if (allFilteredSelected) {
      const filteredSet = new Set(filteredFields);
      commitColumns(columns.filter((c) => !filteredSet.has(c)));
    } else {
      const toAdd = filteredFields.filter((c) => !columns.includes(c));
      commitColumns([...columns, ...toAdd]);
    }
  }, [filteredFields, allFilteredSelected, columns, commitColumns]);

  const toggleColumn = useCallback(
    (col: string) => {
      if (columns.includes(col)) {
        commitColumns(columns.filter((c) => c !== col));
      } else {
        commitColumns([...columns, col]);
      }
    },
    [columns, commitColumns]
  );

  const removeColumn = useCallback(
    (col: string) => {
      commitColumns(columns.filter((c) => c !== col));
    },
    [columns, commitColumns]
  );

  const clearAll = useCallback(() => {
    commitColumns([]);
  }, [commitColumns]);

  // ── Sort key actions ──
  const commitSortKeys = useCallback(
    (next: SortKeyEntry[]) => {
      const valid = next.filter((k) => k.field !== '');
      updateConfig((cfg) => ({
        ...cfg,
        orderBy: valid.length > 0 ? valid : undefined,
      }));
    },
    [updateConfig]
  );

  // Ensure at least one empty row for display
  const displaySortKeys: SortKeyEntry[] = orderBy.length > 0 ? orderBy : [{ ...DEFAULT_SORT_KEY }];

  // ── Drag-to-reorder state ──
  const dragIndexRef = useRef<number | null>(null);
  const [dragKeys, setDragKeys] = useState<SortKeyEntry[] | null>(null);

  // Sync dragKeys from config when not dragging
  useEffect(() => {
    if (dragIndexRef.current === null) setDragKeys(null);
  }, [displaySortKeys]);

  const activeKeys = dragKeys ?? displaySortKeys;

  const updateSortKey = useCallback(
    (index: number, patch: Partial<SortKeyEntry>) => {
      const next = activeKeys.map((k, i) => (i === index ? { ...k, ...patch } : k));
      commitSortKeys(next);
    },
    [activeKeys, commitSortKeys]
  );

  const addSortKeyAfter = useCallback(
    (index: number) => {
      const next = [...activeKeys];
      next.splice(index + 1, 0, { ...DEFAULT_SORT_KEY });
      commitSortKeys(next);
    },
    [activeKeys, commitSortKeys]
  );

  const removeSortKey = useCallback(
    (index: number) => {
      if (activeKeys.length <= 1) {
        commitSortKeys([{ ...DEFAULT_SORT_KEY }]);
        return;
      }
      commitSortKeys(activeKeys.filter((_, i) => i !== index));
    },
    [activeKeys, commitSortKeys]
  );

  const handleDragStart = useCallback(
    (index: number) => {
      dragIndexRef.current = index;
      setDragKeys([...displaySortKeys]);
    },
    [displaySortKeys]
  );

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndexRef.current === null || dragIndexRef.current === index) return;
    const from = dragIndexRef.current;
    setDragKeys((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(index, 0, moved);
      return next;
    });
    dragIndexRef.current = index;
  }, []);

  const handleDragEnd = useCallback(() => {
    if (dragKeys && dragIndexRef.current !== null) {
      commitSortKeys(dragKeys);
    }
    dragIndexRef.current = null;
    setDragKeys(null);
  }, [dragKeys, commitSortKeys]);

  // Duplicate sort field check
  const usedSortFields = useMemo(() => {
    const used = new Set<string>();
    for (const k of activeKeys) {
      if (k.field) used.add(k.field);
    }
    return used;
  }, [activeKeys]);

  return (
    <div className="flex flex-col min-h-0 overflow-hidden" style={{ height: '100%' }}>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* ── 已选字段（全宽） ── */}
        {columns.length > 0 && (
          <div
            className="rounded-lg border border-border-muted bg-background/60 px-2.5 py-1.5 mb-2 overflow-hidden"
            style={{ maxHeight: '2.25rem' }}
          >
            <div className="flex flex-nowrap gap-1 overflow-x-auto">
              {columns.map((col) => (
                <span
                  key={col}
                  className="inline-flex items-center gap-1 rounded bg-accent/10 px-2 py-0.5 text-[12px] font-medium text-accent flex-shrink-0"
                >
                  {col}
                  <button
                    type="button"
                    onClick={() => removeColumn(col)}
                    className="inline-flex h-3 w-3 items-center justify-center rounded-full hover:bg-accent/20"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
        {columns.length === 0 && (
          <p className="text-[11px] text-error/80 mb-2">
            {tr('dedupMustSelectField', '请至少选择一个去重字段')}
          </p>
        )}

        <div className="grid grid-cols-[46fr_54fr] gap-3 min-h-full">
          {/* ═══ LEFT: 选择字段 ═══ */}
          <div className="flex min-h-0 flex-col rounded-lg border border-border-muted bg-background/60">
            {/* Search + count */}
            <div className="flex items-center gap-1.5 border-b border-border-subtle px-2.5 py-1">
              <div className="flex flex-1 items-center gap-1 rounded border border-border-muted bg-background/42 px-1.5 py-0.5">
                <Search className="h-3 w-3 flex-shrink-0 text-text-muted" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={tr('searchField', '搜索字段')}
                  className="h-5 w-full bg-transparent text-[12px] text-text-primary outline-none placeholder:text-text-muted"
                />
              </div>
              <span className="text-[11px] text-text-muted tabular-nums flex-shrink-0">
                {tr('dedupByFields', '已选择 {{count}} 个').replace(
                  '{{count}}',
                  String(columns.length)
                )}
              </span>
              {columns.length > 0 && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-[11px] text-text-muted hover:text-error transition-colors flex-shrink-0"
                >
                  {tr('clearAll', '清空')}
                </button>
              )}
            </div>

            {/* Field table header */}
            <div className="flex items-center gap-2 border-b border-border-subtle px-2.5 py-0.5 text-[10px] font-medium text-text-muted">
              <label
                className="flex cursor-pointer items-center gap-1.5 flex-1 min-w-0"
                onMouseDown={(e) => e.preventDefault()}
              >
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={toggleAll}
                  className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
                />
                <span>{tr('selectAll', '全选')}</span>
              </label>
              <span className="w-14 flex-shrink-0 text-right">{tr('dataType', '数据类型')}</span>
            </div>

            {/* Field list */}
            <div ref={setListRef} className="flex-1 min-h-0 overflow-y-auto">
              {filteredFields.length === 0 ? (
                <div className="px-3 py-8 text-center text-[12px] text-text-muted">
                  {search ? tr('noMatch', '无匹配字段') : tr('noFields', '暂无可用字段')}
                </div>
              ) : (
                filteredFields.map((col) => {
                  const checked = columns.includes(col);
                  return (
                    <label
                      key={col}
                      className={`flex cursor-pointer items-center gap-2 px-2.5 py-[4px] text-[12px] transition-colors hover:bg-surface-hover ${
                        checked ? 'text-text-primary' : 'text-text-secondary'
                      }`}
                      onMouseDown={(e) => e.preventDefault()}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleColumn(col)}
                        className="h-3.5 w-3.5 rounded border-border-muted accent-accent flex-shrink-0"
                      />
                      <span className="flex-1 min-w-0 truncate">{col}</span>
                      <span className="w-14 flex-shrink-0 text-right text-[11px] text-text-muted tabular-nums">
                        {typeLabel(col)}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          {/* ═══ RIGHT: 保留策略 + 排序设置 ═══ */}
          <div className="grid content-start gap-2 min-h-0">
            {/* ── 保留策略 ── */}
            <div className="flex items-center gap-2 text-[12px] text-text-secondary">
              <span>{tr('dedupKeepStrategy', '保留策略')}</span>
              <label
                className="flex items-center gap-1 cursor-pointer"
                onMouseDown={(e) => e.preventDefault()}
              >
                <input
                  type="radio"
                  name="keepStrategy"
                  checked={keep === 'first'}
                  onChange={() => updateConfig((cfg) => ({ ...cfg, keep: 'first' }))}
                  className="h-3.5 w-3.5 accent-accent"
                />
                <span className={keep === 'first' ? 'text-text-primary font-medium' : ''}>
                  {tr('first', '第一条')}
                </span>
              </label>
              <label
                className="flex items-center gap-1 cursor-pointer"
                onMouseDown={(e) => e.preventDefault()}
              >
                <input
                  type="radio"
                  name="keepStrategy"
                  checked={keep === 'last'}
                  onChange={() => updateConfig((cfg) => ({ ...cfg, keep: 'last' }))}
                  className="h-3.5 w-3.5 accent-accent"
                />
                <span className={keep === 'last' ? 'text-text-primary font-medium' : ''}>
                  {tr('last', '最后一条')}
                </span>
              </label>
            </div>

            {/* ── 排序设置 ── */}
            <div className="rounded-lg border border-border-muted bg-background/60 p-2">
              <div className="space-y-1">
                {activeKeys.map((key, i) => {
                  const isDuplicate =
                    key.field &&
                    usedSortFields.has(key.field) &&
                    activeKeys.findIndex((k) => k.field === key.field) !== i;
                  const isFirstDuplicate =
                    key.field && activeKeys.findIndex((k) => k.field === key.field) === i;

                  return (
                    <div key={i} className="flex items-center gap-1 px-0.5">
                      {/* Drag handle */}
                      <div
                        draggable
                        onDragStart={() => handleDragStart(i)}
                        onDragOver={(e) => handleDragOver(e, i)}
                        onDragEnd={handleDragEnd}
                        className="flex-shrink-0 cursor-grab active:cursor-grabbing text-text-muted hover:text-text-secondary transition-colors"
                      >
                        <GripVertical className="h-4 w-4" />
                      </div>

                      {/* Sort field */}
                      <select
                        value={key.field}
                        onChange={(e) => updateSortKey(i, { field: e.target.value })}
                        className={`h-6 flex-[4] min-w-0 text-center rounded border bg-background/60 px-1.5 text-[11px] outline-none ${
                          isDuplicate && !isFirstDuplicate
                            ? 'border-warning/40 text-text-primary'
                            : 'border-border-muted text-text-primary'
                        }`}
                        title={
                          isDuplicate && !isFirstDuplicate
                            ? tr('dedupFieldAlreadyUsed', '该字段已在排序规则中使用')
                            : undefined
                        }
                      >
                        <option value="" disabled>
                          {tr('sortSelectField', '请选择字段')}
                        </option>
                        {fieldCompletions.map((col) => (
                          <option key={col} value={col}>
                            {col}
                          </option>
                        ))}
                      </select>

                      {/* Sort direction */}
                      <select
                        value={key.direction}
                        onChange={(e) =>
                          updateSortKey(i, { direction: e.target.value as 'asc' | 'desc' })
                        }
                        className="h-6 flex-[2] min-w-0 text-center rounded border border-border-muted bg-background/60 px-1 text-[11px] text-text-secondary outline-none"
                      >
                        <option value="asc">{tr('asc', '升序')}</option>
                        <option value="desc">{tr('desc', '降序')}</option>
                      </select>

                      {/* NULL handling */}
                      <select
                        value={key.nulls ?? ''}
                        onChange={(e) =>
                          updateSortKey(i, {
                            nulls: (e.target.value || undefined) as 'first' | 'last' | undefined,
                          })
                        }
                        className="h-6 flex-[3] min-w-0 text-center rounded border border-border-muted bg-background/60 px-1 text-[11px] text-text-secondary outline-none"
                      >
                        <option value="">{tr('nullsDefault', '默认')}</option>
                        <option value="first">{tr('nullsFirst', 'NULL 置前')}</option>
                        <option value="last">{tr('nullsLast', 'NULL 置后')}</option>
                      </select>

                      {/* Add sort key */}
                      <button
                        type="button"
                        onClick={() => {
                          if (!key.field) {
                            // Could show a toast or inline warning, but for now skip silently
                            return;
                          }
                          addSortKeyAfter(i);
                        }}
                        disabled={!key.field}
                        className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-text-muted hover:text-accent hover:bg-accent/10 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                        title={
                          !key.field
                            ? tr('dedupCompleteSortRow', '请先选择当前行的排序字段')
                            : tr('sortAddKey', '添加排序键')
                        }
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>

                      {/* Delete sort key */}
                      <button
                        type="button"
                        onClick={() => removeSortKey(i)}
                        className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-text-muted hover:text-error hover:bg-error/10 transition-colors"
                        title={tr('filterDeleteCondition', '删除')}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
