import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronsDown, ChevronsUp, GripVertical, Search, X } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFieldSelector } from './shared/GlassFieldSelector';
import { dataFieldTypeLabel } from '@/shared/data-field-types';
import { useConfirmDialog } from '../../components/ConfirmDialog';

export default function FormFieldSelect({
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
  const { confirm } = useConfirmDialog();

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

  const columns = useMemo(
    () => (node.config.columns as string[] | undefined) ?? [],
    [node.config.columns]
  );

  const commitColumns = useCallback(
    (next: string[]) => {
      updateConfig((cfg) => ({
        ...cfg,
        mode: 'include',
        columns: next.length > 0 ? next : undefined,
      }));
    },
    [updateConfig]
  );

  const handleSelectionChange = useCallback(
    (next: string[]) => {
      const existing = columns.filter((c) => next.includes(c));
      const added = next.filter((c) => !columns.includes(c));
      updateConfig((cfg) => ({
        ...cfg,
        mode: 'include',
        columns: [...existing, ...added],
      }));
    },
    [columns, updateConfig]
  );

  const removeColumn = useCallback(
    (col: string) => {
      commitColumns(columns.filter((c) => c !== col));
    },
    [columns, commitColumns]
  );

  const moveToTop = useCallback(
    (col: string) => {
      const next = columns.filter((c) => c !== col);
      next.unshift(col);
      commitColumns(next);
    },
    [columns, commitColumns]
  );

  const moveToBottom = useCallback(
    (col: string) => {
      const next = columns.filter((c) => c !== col);
      next.push(col);
      commitColumns(next);
    },
    [columns, commitColumns]
  );

  const clearAll = useCallback(async () => {
    const ok = await confirm({
      title: tr('clearAllConfirm', '确认清空？'),
      message: tr('clearAllConfirmMessage', '将移除所有已选字段'),
      confirmLabel: tr('clearAll', '清空'),
      cancelLabel: tr('cancel', '取消'),
    });
    if (ok) commitColumns([]);
  }, [commitColumns, confirm, tr]);

  const [rightSearch, setRightSearch] = useState('');
  const dragIndexRef = useRef<number | null>(null);
  const dropTargetRef = useRef<string | null>(null);
  const [dragList, setDragList] = useState<string[] | null>(null);

  const displayList = dragList ?? columns;

  const filteredList = useMemo(() => {
    if (!rightSearch.trim()) return displayList;
    const lower = rightSearch.toLowerCase().trim();
    return displayList.filter((c) => c.toLowerCase().includes(lower));
  }, [displayList, rightSearch]);

  const typeStats = useMemo(() => {
    const stats: Record<string, number> = {};
    for (const col of columns) {
      const type = columnTypes?.[col] ?? 'unknown';
      stats[type] = (stats[type] || 0) + 1;
    }
    return stats;
  }, [columns, columnTypes]);

  const handleDragStart = useCallback(
    (col: string) => {
      const index = columns.indexOf(col);
      if (index === -1) return;
      dragIndexRef.current = index;
      setDragList([...columns]);
    },
    [columns]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, targetCol: string) => {
      e.preventDefault();
      dropTargetRef.current = targetCol;
      const from = dragIndexRef.current;
      if (from === null) return;
      const to = columns.indexOf(targetCol);
      if (to === -1 || from === to) return;
      setDragList((prev) => {
        if (!prev) return prev;
        const next = [...prev];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
      dragIndexRef.current = to;
    },
    [columns]
  );

  const handleDragEnd = useCallback(() => {
    if (dragList && dragIndexRef.current !== null) {
      commitColumns(dragList);
    }
    dragIndexRef.current = null;
    dropTargetRef.current = null;
    setDragList(null);
  }, [dragList, commitColumns]);

  return (
    <div className="flex flex-col min-h-0 overflow-hidden" style={{ height: '100%' }}>
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {/* Title bar */}
        <div className="flex items-center justify-between py-1.5">
          <div className="flex items-center gap-3 text-[12px] text-text-muted">
            <span>
              {tr('fieldSelectCount', '已选 {{n}}/{{total}} 个字段')
                .replace('{{n}}', String(columns.length))
                .replace('{{total}}', String(fieldCompletions.length))}
            </span>
            {columns.length > 0 && (
              <div className="flex items-center gap-2">
                {Object.entries(typeStats).map(([type, count]) => (
                  <span key={type} className="text-[11px] text-text-muted">
                    {dataFieldTypeLabel(type)}: {count}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {columns.length > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="text-[12px] text-text-muted hover:text-error transition-colors"
              >
                {tr('clearAll', '清空')}
              </button>
            )}
          </div>
        </div>

        {/* Dual-pane layout */}
        <div className="grid grid-cols-2 gap-3 flex-1 min-h-0">
          {/* Left: field library */}
          <GlassFieldSelector
            columns={fieldCompletions}
            selected={columns}
            onChange={handleSelectionChange}
            columnTypes={columnTypes}
            maxHeight="none"
          />

          {/* Right: selected fields */}
          <div className="flex min-h-0 flex-col rounded-lg border border-border-subtle bg-background/24">
            <div className="flex items-center justify-between border-b border-border-subtle px-2.5 py-1.5">
              <span className="text-[12px] font-medium text-text-secondary">
                {tr('selectedFields', '已选字段')}
                {columns.length > 0 && (
                  <span className="ml-1.5 text-[11px] font-normal text-text-muted">
                    · {tr('reorderHint', '可拖拽调整字段顺序')}
                  </span>
                )}
              </span>
            </div>

            {columns.length > 0 && (
              <div className="flex items-center gap-1.5 border-b border-border-subtle px-2 py-1">
                <Search className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
                <input
                  type="text"
                  value={rightSearch}
                  onChange={(e) => setRightSearch(e.target.value)}
                  placeholder={tr('searchField', '搜索字段...')}
                  className="h-5 flex-1 min-w-0 bg-transparent text-[12px] text-text-primary outline-none placeholder:text-text-muted"
                />
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-1.5 py-1">
              {filteredList.length === 0 ? (
                <div className="flex h-full items-center justify-center text-[12px] text-text-muted">
                  {rightSearch
                    ? tr('noMatch', '无匹配字段')
                    : tr('noFieldsSelected', '暂未选择字段')}
                </div>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {filteredList.map((col) => {
                    const isDragging =
                      dragIndexRef.current !== null &&
                      columns.indexOf(col) === dragIndexRef.current;
                    const isDropTarget =
                      dropTargetRef.current === col &&
                      dragIndexRef.current !== null &&
                      columns.indexOf(col) !== dragIndexRef.current;
                    return (
                      <div
                        key={col}
                        className={`flex items-center gap-1.5 rounded px-1.5 py-1 text-[13px] transition-colors hover:bg-surface-hover/40 ${
                          isDragging ? 'opacity-50' : ''
                        } ${isDropTarget ? 'bg-accent/5 ring-1 ring-inset ring-accent/30' : ''}`}
                        onDragOver={(e) => handleDragOver(e, col)}
                      >
                        <div
                          draggable
                          onDragStart={() => handleDragStart(col)}
                          onDragEnd={handleDragEnd}
                          className="flex h-5 w-4 flex-shrink-0 cursor-grab items-center justify-center text-text-muted transition-colors hover:text-text-secondary active:cursor-grabbing"
                          title={tr('dragToReorder', '拖拽排序')}
                          aria-label={tr('dragToReorder', '拖拽排序')}
                        >
                          <GripVertical className="h-3.5 w-3.5" />
                        </div>

                        <span className="flex-1 min-w-0 truncate text-text-primary">{col}</span>

                        {columnTypes?.[col] && (
                          <span className="flex-shrink-0 rounded bg-background/60 px-1.5 py-0.5 text-[11px] text-text-muted">
                            {dataFieldTypeLabel(columnTypes[col])}
                          </span>
                        )}

                        <button
                          type="button"
                          onClick={() => moveToTop(col)}
                          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:text-accent hover:bg-accent/10"
                          title={tr('moveToTop', '置顶')}
                          aria-label={tr('moveToTop', '置顶')}
                        >
                          <ChevronsUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveToBottom(col)}
                          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:text-accent hover:bg-accent/10"
                          title={tr('moveToBottom', '置底')}
                          aria-label={tr('moveToBottom', '置底')}
                        >
                          <ChevronsDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeColumn(col)}
                          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:text-error hover:bg-error/10"
                          title={tr('removeField', '移除字段')}
                          aria-label={tr('removeField', '移除字段')}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
