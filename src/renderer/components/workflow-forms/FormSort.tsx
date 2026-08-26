import { useCallback, useEffect, useMemo } from 'react';
import type { OperatorFormProps } from './index';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import { GlassDirectionToggle } from './shared/GlassDirectionToggle';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import { GlassRowList } from './shared/GlassRowList';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
import { useDragReorder } from '../../hooks/useDragReorder';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { computeUsedFields } from '../../../shared/collections/used-fields';
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
  const editableKeys = useMemo(() => (keys.length > 0 ? keys : [{ ...DEFAULT_SORT_KEY }]), [keys]);

  const columnTypes = useWorkflowNodeColumnTypes({ taskId, sourceNode });

  const commitKeys = useCallback(
    (next: SortKey[]) => {
      updateConfig((cfg) => ({ ...cfg, keys: next.length > 0 ? next : undefined }));
    },
    [updateConfig]
  );

  const {
    activeItems: activeKeys,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    resetDrag,
    isDragging,
    dragIndexRef,
  } = useDragReorder(editableKeys, commitKeys);

  const updateKey = useCallback(
    (index: number, patch: Partial<SortKey>) => {
      const next = activeKeys.map((k, i) => (i === index ? { ...k, ...patch } : k));
      commitKeys(next);
    },
    [activeKeys, commitKeys]
  );

  const addKeyAfter = useCallback(
    (index: number) => {
      if (activeKeys.length >= fieldCompletions.length) return;
      const next = [...activeKeys];
      next.splice(index + 1, 0, { ...DEFAULT_SORT_KEY });
      commitKeys(next);
    },
    [activeKeys, fieldCompletions.length, commitKeys]
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

  const copyKeyAfter = useCallback(
    (index: number) => {
      if (activeKeys.length >= fieldCompletions.length) return;
      const source = activeKeys[index];
      const next = [...activeKeys];
      next.splice(index + 1, 0, { field: '', direction: source.direction, nulls: source.nulls });
      commitKeys(next);
    },
    [activeKeys, fieldCompletions.length, commitKeys]
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
            headerClassName=""
            items={activeKeys}
            columns={[
              {
                flex: 'flex-[4]',
                header: tr('sortFieldHeader'),
                render: (key: SortKey, i) => {
                  const disabledOptions = new Set(usedFields);
                  if (key.field) disabledOptions.delete(key.field);
                  return (
                    <GlassFieldSingleSelect
                      value={key.field}
                      options={fieldCompletions}
                      columnTypes={columnTypes}
                      onChange={(value) => updateKey(i, { field: value })}
                      placeholder={tr('sortSelectField')}
                      searchPlaceholder={tr('searchField')}
                      emptyText={tr('noMatch')}
                      disabledOptions={disabledOptions}
                      className="w-full"
                    />
                  );
                },
              },
              {
                flex: 'flex-[2]',
                header: tr('sortDirectionHeader'),
                align: 'center',
                render: (key: SortKey, i) => (
                  <GlassDirectionToggle
                    value={key.direction}
                    onChange={(v) => updateKey(i, { direction: v })}
                    variant="highlight"
                    className="h-7 w-full px-1.5 text-[12px]"
                  />
                ),
              },
              {
                flex: 'flex-[3]',
                header: tr('sortNullsHeader'),
                render: (key: SortKey, i) => (
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
                      updateKey(i, { nulls: (v || undefined) as 'first' | 'last' | undefined })
                    }
                    className="h-7 w-full text-center rounded border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-secondary outline-none focus:border-accent"
                  />
                ),
              },
            ]}
            onAdd={addKeyAfter}
            onRemove={removeKey}
            onCopy={copyKeyAfter}
            actions={['add', 'copy', 'remove']}
            addTitle={tr('sortAddKey')}
            removeTitle={tr('sortRemoveKey')}
            copyTitle={tr('fieldMappingCopy')}
            draggable
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            getRowOpacity={(i) => !!(isDragging && dragIndexRef.current === i)}
            dragTitle={tr('dragToReorder')}
          />
        </div>
      </div>
    </div>
  );
}
