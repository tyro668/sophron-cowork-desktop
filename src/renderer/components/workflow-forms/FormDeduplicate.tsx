import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Plus, Trash2, GripVertical } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFieldCombo } from './shared/GlassFieldCombo';
import { GlassFieldSelector } from './shared/GlassFieldSelector';
import { GlassDirectionToggle } from './shared/GlassDirectionToggle';
import { GlassNullsSelect } from './shared/GlassNullsSelect';

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
      .catch(() => {
        setColumnTypes({});
      });
  }, [taskId, sourceNode?.id, sourceNode?.type, sourceNode?.config]);

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

  const commitColumns = useCallback(
    (next: string[]) => {
      updateConfig((cfg) => ({
        ...cfg,
        strategy: next.length > 0 ? 'by_columns' : 'all_columns',
        columns: next.length > 0 ? next : undefined,
      }));
    },
    [updateConfig]
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
      updateConfig((cfg) => ({
        ...cfg,
        orderBy: next,
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
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {/* ── 已选字段（全宽） ── */}
        {columns.length > 0 && (
          <div
            className="rounded-lg border border-border-muted bg-background/60 px-2.5 py-1.5 mb-2 overflow-hidden"
            style={{ maxHeight: '2.25rem' }}
          >
            <div className="flex flex-nowrap gap-1 overflow-x-auto">
              <button
                type="button"
                onClick={clearAll}
                className="inline-flex flex-shrink-0 items-center justify-center rounded px-1 text-text-muted hover:text-error hover:bg-error/10 transition-colors"
                title={tr('clearAll', '清空字段')}
                aria-label={tr('clearAll', '清空字段')}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              {columns.map((col) => (
                <span
                  key={col}
                  className="inline-flex items-center gap-1 rounded bg-accent/10 px-2 py-0.5 text-[12px] font-medium text-accent flex-shrink-0"
                >
                  {col}
                  <button
                    type="button"
                    onClick={() => removeColumn(col)}
                    className="inline-flex h-3 w-3 cursor-pointer items-center justify-center rounded-full hover:bg-accent/20 transition-colors"
                    aria-label={tr('removeField', '移除字段')}
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

        <div className="grid grid-cols-[40fr_60fr] gap-3 flex-1 min-h-0">
          {/* ═══ LEFT: 选择字段 ═══ */}
          <GlassFieldSelector
            columns={fieldCompletions}
            selected={columns}
            onChange={commitColumns}
            columnTypes={columnTypes}
            maxHeight="none"
          />

          {/* ═══ RIGHT: 保留策略 + 排序设置 ═══ */}
          <div className="overflow-y-auto min-h-0">
            <div className="grid content-start gap-2">
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
              <div className="rounded-lg border border-border-muted bg-background/60">
                {/* Column headers */}
                <div className="flex items-center gap-1 border-b border-border-subtle px-2.5 py-1.5 text-[11px] font-medium text-text-muted">
                  <span className="w-4 flex-shrink-0" aria-hidden="true" />
                  <span className="flex-[4] min-w-0 text-center">
                    {tr('sortFieldHeader', '排序字段')}
                  </span>
                  <span className="flex-[2] min-w-0 text-center">
                    {tr('sortDirectionHeader', '排序方式')}
                  </span>
                  <span className="flex-[3] min-w-0 text-center">
                    {tr('sortNullsHeader', '空值处理')}
                  </span>
                  <span className="w-[3.25rem] flex-shrink-0" aria-hidden="true" />
                </div>

                <div className="space-y-1 p-2">
                  {activeKeys.map((key, i) => {
                    const disabledSortFields = new Set(usedSortFields);
                    if (key.field) disabledSortFields.delete(key.field);

                    return (
                      <div key={i} className="flex items-center gap-1 px-0.5">
                        {/* Drag handle */}
                        <div
                          draggable
                          onDragStart={() => handleDragStart(i)}
                          onDragOver={(e) => handleDragOver(e, i)}
                          onDragEnd={handleDragEnd}
                          className="flex-shrink-0 cursor-grab active:cursor-grabbing text-text-muted hover:text-text-secondary transition-colors"
                          title={tr('dragToReorder', '拖拽排序')}
                          aria-label={tr('dragToReorder', '拖拽排序')}
                        >
                          <GripVertical className="h-4 w-4" />
                        </div>

                        {/* Sort field */}
                        <GlassFieldCombo
                          value={key.field}
                          options={fieldCompletions}
                          columnTypes={columnTypes}
                          onChange={(value) => updateSortKey(i, { field: value })}
                          placeholder={tr('sortSelectField', '请选择字段')}
                          searchPlaceholder={tr('searchField', '搜索字段')}
                          emptyText={tr('noMatch', '无匹配字段')}
                          disabledOptions={disabledSortFields}
                          className="flex-[4] min-w-0"
                        />

                        {/* Sort direction */}
                        <GlassDirectionToggle
                          value={key.direction}
                          onChange={(v) => updateSortKey(i, { direction: v })}
                          className="h-6 flex-[2] min-w-0 px-1 text-[11px]"
                        />

                        {/* Null handling */}
                        <GlassNullsSelect
                          value={key.nulls}
                          onChange={(v) => updateSortKey(i, { nulls: v })}
                          className="h-6 flex-[3] min-w-0 text-center rounded border border-border-muted bg-background/60 px-1 text-[11px] text-text-secondary outline-none"
                        />

                        {/* Add sort key */}
                        <button
                          type="button"
                          onClick={() => addSortKeyAfter(i)}
                          className="inline-flex h-6 w-6 flex-shrink-0 cursor-pointer items-center justify-center rounded text-text-muted hover:text-accent hover:bg-accent/10 transition-colors"
                          title={tr('sortAddKey', '添加排序键')}
                          aria-label={tr('sortAddKey', '添加排序键')}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>

                        {/* Delete sort key */}
                        <button
                          type="button"
                          onClick={() => removeSortKey(i)}
                          className="inline-flex h-6 w-6 flex-shrink-0 cursor-pointer items-center justify-center rounded text-text-muted hover:text-error hover:bg-error/10 transition-colors"
                          title={tr('filterDeleteCondition', '删除')}
                          aria-label={tr('filterDeleteCondition', '删除')}
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
    </div>
  );
}
