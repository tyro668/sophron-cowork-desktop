import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OperatorFormProps } from './index';
import { GlassFieldCombo } from './shared/GlassFieldCombo';
import { GlassDirectionToggle } from './shared/GlassDirectionToggle';
import { GlassNullsSelect } from './shared/GlassNullsSelect';
import { GlassRowList } from './shared/GlassRowList';

interface SortKey {
  field: string;
  direction: 'asc' | 'desc';
  nulls?: 'first' | 'last';
}

const DEFAULT_SORT_KEY: SortKey = { field: '', direction: 'asc' };

export default function FormSort({
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

  const keys = useMemo<SortKey[]>(() => (node.config.keys as SortKey[]) ?? [], [node.config.keys]);

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

  const commitKeys = useCallback(
    (next: SortKey[]) => {
      updateConfig((cfg) => ({ ...cfg, keys: next.length > 0 ? next : undefined }));
    },
    [updateConfig]
  );

  // Ensure at least one empty row for display
  const displayKeys = useMemo<SortKey[]>(() => {
    return keys.length > 0 ? keys : [{ ...DEFAULT_SORT_KEY }];
  }, [keys]);

  // ── Drag-to-reorder state ──
  const dragIndexRef = useRef<number | null>(null);
  const [dragKeys, setDragKeys] = useState<SortKey[] | null>(null);

  // Sync dragKeys from config when not dragging
  useEffect(() => {
    if (dragIndexRef.current === null) setDragKeys(null);
  }, [displayKeys]);

  const activeKeys = dragKeys ?? displayKeys;

  const updateKey = useCallback(
    (index: number, patch: Partial<SortKey>) => {
      // Auto-resolve duplicate sort fields: clear the previous occurrence.
      if ('field' in patch && patch.field) {
        const existing = activeKeys.findIndex((k, i) => i !== index && k.field === patch.field);
        if (existing !== -1) {
          const next = activeKeys.map((k, i) => {
            if (i === index) return { ...k, ...patch };
            if (i === existing) return { ...k, field: '' };
            return k;
          });
          commitKeys(next);
          return;
        }
      }
      const next = activeKeys.map((k, i) => (i === index ? { ...k, ...patch } : k));
      commitKeys(next);
    },
    [activeKeys, commitKeys]
  );

  const addKeyAfter = useCallback(
    (index: number) => {
      const next = [...activeKeys];
      next.splice(index + 1, 0, { ...DEFAULT_SORT_KEY });
      commitKeys(next);
    },
    [activeKeys, commitKeys]
  );

  const removeKey = useCallback(
    (index: number) => {
      if (activeKeys.length <= 1) {
        commitKeys([]);
        return;
      }
      commitKeys(activeKeys.filter((_, i) => i !== index));
    },
    [activeKeys, commitKeys]
  );

  const handleDragStart = useCallback(
    (index: number) => {
      dragIndexRef.current = index;
      setDragKeys([...displayKeys]);
    },
    [displayKeys]
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
      commitKeys(dragKeys);
    }
    dragIndexRef.current = null;
    setDragKeys(null);
  }, [dragKeys, commitKeys]);

  // Fields already chosen in other rows (for disabling in the dropdown)
  const usedFields = useMemo(() => {
    const used = new Set<string>();
    for (const k of activeKeys) {
      if (k.field) used.add(k.field);
    }
    return used;
  }, [activeKeys]);

  const realKeys = useMemo(() => activeKeys.filter((k) => k.field), [activeKeys]);

  return (
    <div className="grid h-full grid-cols-[7fr_3fr] overflow-hidden">
      {/* Left: sort keys */}
      <div className="flex min-h-0 flex-col overflow-hidden border-r border-border-muted">
        <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pr-3 pb-2 pt-1">
          <GlassRowList
            items={activeKeys}
            columns={[
              {
                flex: 'flex-[4]',
                header: tr('sortFieldHeader', '待排序字段'),
                render: (key: SortKey, i) => {
                  const disabledOptions = new Set(usedFields);
                  if (key.field) disabledOptions.delete(key.field);
                  return (
                    <GlassFieldCombo
                      value={key.field}
                      options={fieldCompletions}
                      columnTypes={columnTypes}
                      onChange={(value) => updateKey(i, { field: value })}
                      placeholder={tr('sortSelectField', '选择字段')}
                      searchPlaceholder={tr('searchField', '搜索字段')}
                      emptyText={tr('noMatch', '无匹配字段')}
                      disabledOptions={disabledOptions}
                      className="w-full"
                    />
                  );
                },
              },
              {
                flex: 'flex-[2]',
                header: tr('sortDirectionHeader', '排序方式'),
                render: (key: SortKey, i) => (
                  <GlassDirectionToggle
                    value={key.direction}
                    onChange={(v) => updateKey(i, { direction: v })}
                    className="h-6 w-full px-1.5 text-[12px]"
                  />
                ),
              },
              {
                flex: 'flex-[3]',
                header: tr('sortNullsHeader', '空值处理方式'),
                render: (key: SortKey, i) => (
                  <GlassNullsSelect
                    value={key.nulls}
                    onChange={(v) => updateKey(i, { nulls: v })}
                    className="h-6 w-full text-center rounded border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-secondary outline-none focus:border-accent"
                  />
                ),
              },
            ]}
            onAdd={addKeyAfter}
            onRemove={removeKey}
            addTitle={tr('sortAddKey', '添加排序键')}
            removeTitle={tr('sortRemoveKey', '删除排序键')}
            draggable
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            getRowOpacity={(i) => !!(dragKeys && dragIndexRef.current === i)}
            dragTitle={tr('dragToReorder', '拖拽排序')}
          />
        </div>
      </div>

      {/* Right: summary */}
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-2 pb-2 pt-1 pl-3">
        <div>
          <h5 className="mb-2 text-[11px] font-medium text-text-muted">
            {tr('sortCurrentDescTitle', '当前排序规则')}
          </h5>
          {realKeys.length === 0 ? (
            <p className="text-[12px] leading-5 text-text-secondary">
              {tr('sortNoKeysDesc', '未设置排序规则，请在左侧添加。')}
            </p>
          ) : (
            <ol className="space-y-1.5">
              {realKeys.map((k, i) => (
                <li key={i} className="flex items-start gap-2 text-[12px]">
                  <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded bg-surface text-[10px] font-medium tabular-nums text-text-muted">
                    {i + 1}
                  </span>
                  <span className="leading-4 text-text-primary">
                    {k.field}
                    <span className="text-text-secondary">
                      {' '}
                      · {k.direction === 'asc' ? tr('asc', '升序') : tr('desc', '降序')}
                    </span>
                    {k.nulls && (
                      <span className="text-text-secondary">
                        {' '}
                        ·{' '}
                        {k.nulls === 'first'
                          ? tr('sortNullsFirst', '空值在前')
                          : tr('sortNullsLast', '空值在后')}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="rounded-md border border-border-muted bg-background/42 px-2.5 py-2">
          <p className="text-[11px] leading-4 text-text-muted">
            {tr('sortHint', '提示：拖拽左侧排序键可调整优先级，顺序越靠前优先级越高。')}
          </p>
        </div>
      </div>
    </div>
  );
}
