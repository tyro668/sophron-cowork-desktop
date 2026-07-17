import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { OperatorFormProps } from './index';
import { GlassTagBar } from './shared/GlassTagBar';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import { GlassFieldMultiSelect } from './shared/GlassFieldMultiSelect';
import { GlassDirectionToggle } from './shared/GlassDirectionToggle';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import { GlassRadioSelect } from './shared/GlassRadioSelect';
import { GlassRowList } from './shared/GlassRowList';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
import { useDragReorder } from '../../hooks/useDragReorder';
import { computeUsedFields } from './shared/used-fields';

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

  const columnTypes = useWorkflowNodeColumnTypes({ taskId, sourceNode });
  const updateConfig = useUpdateConfig(onNodeChange);

  const columns = useMemo(() => (node.config?.columns as string[]) ?? [], [node.config?.columns]);
  const keep = (node.config?.keep as string) ?? 'first';
  const orderBy = useMemo(
    () => (node.config?.orderBy as SortKeyEntry[]) ?? [],
    [node.config?.orderBy]
  );

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
  const displaySortKeys = useMemo(
    () => (orderBy.length > 0 ? orderBy : [{ ...DEFAULT_SORT_KEY }]),
    [orderBy]
  );

  const {
    activeItems: activeKeys,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    resetDrag,
    isDragging,
    dragIndexRef,
  } = useDragReorder(displaySortKeys, commitSortKeys);

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

  // Sync drag state from config when not dragging
  useEffect(() => {
    if (!isDragging) resetDrag();
  }, [displaySortKeys, isDragging, resetDrag]);

  // Duplicate sort field check
  const usedSortFields = useMemo(() => computeUsedFields(activeKeys, (k) => k.field), [activeKeys]);

  return (
    <div className="flex flex-col min-h-0 overflow-hidden" style={{ height: '100%' }}>
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {/* ── 已选字段（全宽�?── */}
        {columns.length > 0 && (
          <div className="mb-2">
            <GlassTagBar
              items={columns}
              onRemove={removeColumn}
              onClear={clearAll}
              open={false}
              onToggle={() => {}}
              toggleStyle="none"
              density="spacious"
            />
          </div>
        )}
        {columns.length === 0 && (
          <p className="text-[11px] text-error/80 mb-2">
            {tr('dedupMustSelectField', '请至少选择一个去重字段')}
          </p>
        )}

        <div className="grid grid-cols-[40fr_60fr] gap-3 flex-1 min-h-0">
          {/* ══�?LEFT: 选择字段 ══�?*/}
          <GlassFieldMultiSelect
            columns={fieldCompletions}
            selected={columns}
            onChange={commitColumns}
            columnTypes={columnTypes}
            maxHeight="none"
          />

          {/* ══�?RIGHT: 保留策略 + 排序设置 ══�?*/}
          <div className="overflow-y-auto min-h-0">
            <div className="grid content-start gap-2">
              {/* ── 保留策略 ── */}
              <GlassRadioSelect
                value={keep}
                options={[
                  { value: 'first', label: tr('first', '第一个') },
                  { value: 'last', label: tr('last', '最后一') },
                ]}
                onChange={(v) => updateConfig((cfg) => ({ ...cfg, keep: v }))}
                label={tr('dedupKeepStrategy', '保留策略')}
                direction="horizontal"
              />

              {/* ── 排序设置 ── */}
              <div className="rounded-lg border border-border-muted bg-background/60">
                <div className="p-2">
                  <GlassRowList
                    headerClassName="text-[12px]"
                    items={activeKeys}
                    columns={[
                      {
                        flex: 'flex-[4]',
                        header: tr('sortFieldHeader', '排序字段'),
                        render: (key: SortKeyEntry, i) => {
                          const disabledSortFields = new Set(usedSortFields);
                          if (key.field) disabledSortFields.delete(key.field);
                          return (
                            <GlassFieldSingleSelect
                              value={key.field}
                              options={fieldCompletions}
                              columnTypes={columnTypes}
                              onChange={(value) => updateSortKey(i, { field: value })}
                              placeholder={tr('sortSelectField', '请选择字段')}
                              searchPlaceholder={tr('searchField', '搜索字段')}
                              emptyText={tr('noMatch', '无匹配字段')}
                              disabledOptions={disabledSortFields}
                              className="w-full"
                            />
                          );
                        },
                      },
                      {
                        flex: 'flex-[2]',
                        header: tr('sortDirectionHeader', '排序方式'),
                        render: (key: SortKeyEntry, i) => (
                          <GlassDirectionToggle
                            value={key.direction}
                            onChange={(v) => updateSortKey(i, { direction: v })}
                            className="h-6 w-full px-1 text-[11px]"
                          />
                        ),
                      },
                      {
                        flex: 'flex-[3]',
                        header: tr('sortNullsHeader', '空值处理'),
                        render: (key: SortKeyEntry, i) => (
                          <GlassOptionSingleSelect
                            value={key.nulls ?? ''}
                            groups={[
                              {
                                key: 'nulls',
                                items: [
                                  { value: '', label: tr('sortNullsDefault', '空值默认') },
                                  { value: 'first', label: tr('sortNullsFirst', '空值在前') },
                                  { value: 'last', label: tr('sortNullsLast', '空值在后') },
                                ],
                              },
                            ]}
                            onChange={(v) =>
                              updateSortKey(i, {
                                nulls: (v || undefined) as 'first' | 'last' | undefined,
                              })
                            }
                            className="h-6 w-full text-center rounded border border-border-muted bg-background/60 px-1 text-[11px] text-text-secondary outline-none"
                          />
                        ),
                      },
                    ]}
                    onAdd={addSortKeyAfter}
                    onRemove={removeSortKey}
                    addTitle={tr('sortAddKey', '添加排序字段')}
                    removeTitle={tr('filterDeleteCondition', '删除条件')}
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
          </div>
        </div>
      </div>
    </div>
  );
}
