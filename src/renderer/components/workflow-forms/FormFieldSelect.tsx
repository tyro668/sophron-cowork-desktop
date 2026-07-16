import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFieldMultiSelect } from './shared/GlassFieldMultiSelect';
import { GlassRowList } from './shared/GlassRowList';
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
  const [dragList, setDragList] = useState<string[] | null>(null);

  const filteredList = useMemo(() => {
    const source = dragList ?? columns;
    if (!rightSearch.trim()) return source;
    const lower = rightSearch.toLowerCase().trim();
    return source.filter((c) => c.toLowerCase().includes(lower));
  }, [columns, dragList, rightSearch]);

  const displayItems = dragList ?? filteredList;

  const typeStats = useMemo(() => {
    const stats: Record<string, number> = {};
    for (const col of columns) {
      const type = columnTypes?.[col] ?? 'unknown';
      stats[type] = (stats[type] || 0) + 1;
    }
    return stats;
  }, [columns, columnTypes]);

  const handleDragStart = useCallback(
    (index: number) => {
      dragIndexRef.current = index;
      setDragList([...displayItems]);
    },
    [displayItems]
  );

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndexRef.current === null || dragIndexRef.current === index) return;
    const from = dragIndexRef.current;
    setDragList((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(index, 0, moved);
      return next;
    });
    dragIndexRef.current = index;
  }, []);

  const handleDragEnd = useCallback(() => {
    if (dragList && dragIndexRef.current !== null) {
      commitColumns(dragList);
    }
    dragIndexRef.current = null;
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
          <GlassFieldMultiSelect
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
              {displayItems.length === 0 ? (
                <div className="flex h-full items-center justify-center text-[12px] text-text-muted">
                  {rightSearch
                    ? tr('noMatch', '无匹配字段')
                    : tr('noFieldsSelected', '暂未选择字段')}
                </div>
              ) : (
                <GlassRowList
                  items={displayItems}
                  columns={[
                    {
                      flex: 'flex-1',
                      header: '',
                      render: (col: string) => (
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="flex-1 min-w-0 truncate text-[12px] text-text-primary">
                            {col}
                          </span>
                          {columnTypes?.[col] && (
                            <span className="shrink-0 rounded bg-background/60 px-1.5 py-0.5 text-[11px] text-text-muted">
                              {dataFieldTypeLabel(columnTypes[col])}
                            </span>
                          )}
                        </div>
                      ),
                    },
                  ]}
                  actions={['toTop', 'toBottom', 'remove']}
                  onToTop={(i) => moveToTop(displayItems[i])}
                  onToBottom={(i) => moveToBottom(displayItems[i])}
                  onRemove={(i) => removeColumn(displayItems[i])}
                  removeTitle={tr('removeField', '移除字段')}
                  draggable
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDragEnd={handleDragEnd}
                  getRowOpacity={(i) => !!(dragList && dragIndexRef.current === i)}
                  dragTitle={tr('dragToReorder', '拖拽排序')}
                  hideHeader
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
