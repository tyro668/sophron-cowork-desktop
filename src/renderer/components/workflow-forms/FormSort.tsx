import { useCallback, useEffect, useMemo } from 'react';
import type { OperatorFormProps } from './index';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import { GlassDirectionToggle } from './shared/GlassDirectionToggle';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import { GlassRowList } from './shared/GlassRowList';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
import { useDragReorder } from '../../hooks/useDragReorder';
import { useEnsureOneRow } from '../../hooks/useEnsureOneRow';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { computeUsedFields } from './shared/used-fields';
import type { SortKey } from '../../../shared/operator-schemas';

const DEFAULT_SORT_KEY: SortKey = { field: '', direction: 'asc' };

export default function FormSort({
  node,
  taskId,
  fieldCompletions,
  sourceNode,
  onNodeChange,
}: OperatorFormProps) {
  const tr = useFormTranslation();
  const updateConfig = useUpdateConfig(onNodeChange);

  const keys = useMemo<SortKey[]>(() => (node.config.keys as SortKey[]) ?? [], [node.config.keys]);

  const columnTypes = useWorkflowNodeColumnTypes({ taskId, sourceNode });

  const commitKeys = useCallback(
    (next: SortKey[]) => {
      updateConfig((cfg) => ({ ...cfg, keys: next.length > 0 ? next : undefined }));
    },
    [updateConfig]
  );

  useEnsureOneRow(keys, commitKeys, () => ({ ...DEFAULT_SORT_KEY }));

  const {
    activeItems: activeKeys,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    resetDrag,
    isDragging,
    dragIndexRef,
  } = useDragReorder(keys, commitKeys);

  const updateKey = useCallback(
    (index: number, patch: Partial<SortKey>) => {
      const next = activeKeys.map((k, i) => (i === index ? { ...k, ...patch } : k));
      commitKeys(next);
    },
    [activeKeys, commitKeys]
  );

  const addKeyAfter = useCallback(
    (index: number) => {
      const hasEmpty = activeKeys.some((k) => !k.field);
      if (hasEmpty || activeKeys.length >= fieldCompletions.length) return;
      const next = [...activeKeys];
      next.splice(index + 1, 0, { ...DEFAULT_SORT_KEY });
      commitKeys(next);
    },
    [activeKeys, fieldCompletions.length, commitKeys]
  );

  const removeKey = useCallback(
    (index: number) => {
      if (activeKeys.length <= 1) {
        commitKeys([{ ...DEFAULT_SORT_KEY }]);
        return;
      }
      commitKeys(activeKeys.filter((_, i) => i !== index));
    },
    [activeKeys, commitKeys]
  );

  // Sync drag state from config when not dragging
  useEffect(() => {
    if (!isDragging) resetDrag();
  }, [keys, isDragging, resetDrag]);

  // Fields already chosen in other rows (for disabling in the dropdown)
  const usedFields = useMemo(() => computeUsedFields(activeKeys, (k) => k.field), [activeKeys]);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: sort keys */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex-1 space-y-1 overflow-y-auto px-2 pr-3 pb-2 pt-1">
          <GlassRowList
            headerClassName="text-[12px]"
            items={activeKeys}
            columns={[
              {
                flex: 'flex-[4]',
                header: tr('sortFieldHeader', '待排序字段'),
                render: (key: SortKey, i) => {
                  const disabledOptions = new Set(usedFields);
                  if (key.field) disabledOptions.delete(key.field);
                  return (
                    <GlassFieldSingleSelect
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
                      updateKey(i, { nulls: (v || undefined) as 'first' | 'last' | undefined })
                    }
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
            getRowOpacity={(i) => !!(isDragging && dragIndexRef.current === i)}
            dragTitle={tr('dragToReorder', '拖拽排序')}
          />
        </div>
      </div>
    </div>
  );
}
