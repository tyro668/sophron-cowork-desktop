import { useCallback, useEffect, useMemo } from 'react';
import { GripVertical, Plus, Trash2 } from 'lucide-react';

import type { OperatorFormProps } from './index';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import { GlassFieldCompactSelect } from './shared/GlassFieldCompactSelect';
import { GlassDirectionToggle } from './shared/GlassDirectionToggle';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import { GlassRadioSelect } from './shared/GlassRadioSelect';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
import { useDragReorder } from '../../hooks/useDragReorder';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { computeUsedFields } from '../../../shared/collections/used-fields';
import type { SortKey } from '../../../shared/operator-schemas';

const DEFAULT_SORT_KEY: SortKey = { field: '', direction: 'asc' };

export default function FormDeduplicate({
  node,
  taskId,
  fieldCompletions,
  sourceNode,
  onNodeChange,
}: OperatorFormProps) {
  const tr = useFormTranslation();
  const columnTypes = useWorkflowNodeColumnTypes({ taskId, sourceNode });
  const updateConfig = useUpdateConfig(onNodeChange);

  const columns = useMemo(() => (node.config?.columns as string[]) ?? [], [node.config?.columns]);
  const keep = (node.config?.keep as string) ?? 'first';
  const orderBy = useMemo(() => (node.config?.orderBy as SortKey[]) ?? [], [node.config?.orderBy]);

  const commitColumns = useCallback(
    (next: string[]) => {
      updateConfig((cfg) => ({
        ...cfg,
        strategy: 'by_columns',
        columns: next.length > 0 ? next : undefined,
      }));
    },
    [updateConfig]
  );

  // ── Sort key actions ──
  const commitSortKeys = useCallback(
    (next: SortKey[]) => {
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
    (index: number, patch: Partial<SortKey>) => {
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
        commitSortKeys([]);
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
    <div className="flex h-full min-h-0 overflow-hidden">
      <div className="flex gap-2.5 flex-1 min-h-0">
        {/* ═══ LEFT: 选择字段 ═══ */}
        <section className="operator-section flex-[4] content-start flex flex-col min-h-0">
          <div className="flex-1 min-h-0 px-3 pb-3 flex flex-col">
            <div className="mb-3 px-0.5 pt-1">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-text-primary">
                <span className="h-2 w-2 rounded-full bg-blue-500" />
                {tr('dedupDimensionsLabel')}
              </div>
              <p className="mt-1 text-[12px] leading-5 text-text-muted">
                {tr('dedupDimensionsHint')}
              </p>
            </div>
            <GlassFieldCompactSelect
              columns={fieldCompletions}
              selected={columns}
              onChange={commitColumns}
              columnTypes={columnTypes}
              maxHeight="none"
            />
          </div>
        </section>

        {/* ═══ RIGHT: 保留策略 + 排序设置 ═══ */}
        <section className="operator-section flex-[6] content-start flex flex-col min-h-0">
          <div className="flex-1 min-h-0 overflow-y-auto border-l border-border-subtle/70 pl-3 pr-3">
            <div className="grid content-start gap-3">
              <div className="flex items-start justify-between gap-3 px-0.5 pt-1">
                <div>
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-text-primary">
                    <span className="h-2 w-2 rounded-full bg-accent" />
                    {tr('dedupConfigLabel')}
                  </div>
                  <p className="mt-1 text-[12px] leading-5 text-text-muted">
                    {tr('dedupConfigHint')}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={activeKeys.some((key) => !key.field)}
                  onClick={() => addSortKeyAfter(activeKeys.length - 1)}
                  className="flex h-9 flex-none items-center gap-1.5 rounded-lg border border-accent px-3 text-[12px] font-medium text-accent transition-colors hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {tr('sortAddKey')}
                </button>
              </div>
              {/* ── 保留策略 ── */}
              <GlassRadioSelect
                value={keep}
                options={[
                  { value: 'first', label: tr('first') },
                  { value: 'last', label: tr('last') },
                ]}
                onChange={(v) => updateConfig((cfg) => ({ ...cfg, keep: v }))}
                label={tr('dedupKeepStrategy')}
                direction="horizontal"
              />

              {/* ── 排序设置 ── */}
              <div className="grid grid-cols-[28px_minmax(0,1.5fr)_minmax(88px,0.8fr)_minmax(96px,0.9fr)_28px] items-center gap-2 px-3 text-[12px] font-medium text-text-muted">
                <span />
                <span>{tr('sortFieldHeader')}</span>
                <span>{tr('sortDirectionHeader')}</span>
                <span>{tr('sortNullsHeader')}</span>
                <span />
              </div>

              <div className="grid gap-2">
                {activeKeys.map((key, index) => {
                  const dragging = isDragging && dragIndexRef.current === index;
                  const disabledSortFields = new Set(usedSortFields);
                  if (key.field) disabledSortFields.delete(key.field);
                  return (
                    <div
                      key={index}
                      onDragOver={(event) => handleDragOver(event, index)}
                      className={`grid min-h-10 grid-cols-[28px_minmax(0,1.5fr)_minmax(88px,0.8fr)_minmax(96px,0.9fr)_28px] items-center gap-2 rounded-lg border border-border-muted bg-background px-3 py-1.5 transition-opacity ${
                        dragging ? 'opacity-50' : ''
                      }`}
                    >
                      <div
                        draggable
                        onDragStart={() => handleDragStart(index)}
                        onDragEnd={handleDragEnd}
                        className="flex h-7 w-7 cursor-grab items-center justify-center text-text-muted transition-colors hover:text-text-secondary active:cursor-grabbing"
                        title={tr('dragToReorder')}
                      >
                        <GripVertical className="h-4 w-4" />
                      </div>
                      <GlassFieldSingleSelect
                        value={key.field}
                        options={fieldCompletions}
                        columnTypes={columnTypes}
                        onChange={(value) => updateSortKey(index, { field: value })}
                        placeholder={tr('sortSelectField')}
                        searchPlaceholder={tr('searchField')}
                        emptyText={tr('noMatch')}
                        disabledOptions={disabledSortFields}
                        className="w-full"
                      />
                      <GlassDirectionToggle
                        value={key.direction}
                        onChange={(v) => updateSortKey(index, { direction: v })}
                        variant="highlight"
                        className="h-7 w-full px-1 text-[11px]"
                      />
                      <GlassOptionSingleSelect
                        value={key.nulls ?? ''}
                        groups={[
                          {
                            key: 'nulls',
                            items: [
                              { value: '', label: tr('sortNullsDefault') },
                              { value: 'first', label: tr('sortNullsFirst') },
                              { value: 'last', label: tr('sortNullsLast') },
                            ],
                          },
                        ]}
                        onChange={(v) =>
                          updateSortKey(index, {
                            nulls: (v || undefined) as 'first' | 'last' | undefined,
                          })
                        }
                        className="h-7 w-full text-center rounded border border-border-muted bg-background/60 px-1 text-[11px] text-text-secondary outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => removeSortKey(index)}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-error/10 hover:text-error"
                        title={tr('filterDeleteCondition')}
                        aria-label={tr('filterDeleteCondition')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
