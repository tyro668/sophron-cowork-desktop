import { useCallback, useEffect, useMemo } from 'react';
import { GlassRowList } from './GlassRowList';
import { GlassFieldSingleSelect } from './GlassFieldSingleSelect';
import { GlassDirectionToggle } from './GlassDirectionToggle';
import { GlassOptionSingleSelect } from './GlassOptionSingleSelect';
import { useDragReorder } from '../../../hooks/useDragReorder';
import { useFormTranslation } from '../../../hooks/useFormTranslation';
import { computeUsedFields } from '../../../../shared/collections/used-fields';
import type { SortKey } from '../../../../shared/operator-schemas';
import { createStableRowId, ensureStableRowIds } from './rowListOperations';

const EMPTY_SORT_KEY: SortKey = { field: '', direction: 'asc' };

interface SortKeysEditorProps {
  /** Raw config keys; a display-only empty row is shown when the list is empty. */
  keys: SortKey[];
  fieldCompletions: string[];
  columnTypes: Record<string, string>;
  onChange: (keys: SortKey[]) => void;
  /** Whether rows offer a copy action (sort keeps it; deduplicate hides it). */
  copyable?: boolean;
  /** Hide the column header row (limit form keeps rows headerless). */
  hideHeader?: boolean;
}

/** Shared sort-key editor (field / direction / nulls) used by sort and
 *  deduplicate. Commit semantics: removing the last key commits `[]`; callers
 *  decide how to persist an empty list. */
export function SortKeysEditor({
  keys,
  fieldCompletions,
  columnTypes,
  onChange,
  copyable = true,
  hideHeader,
}: SortKeysEditorProps) {
  const tr = useFormTranslation('sortKeys');
  const displayKeys = useMemo(
    () =>
      keys.length > 0 ? ensureStableRowIds(keys) : [{ ...EMPTY_SORT_KEY, id: createStableRowId() }],
    [keys]
  );
  const commitKeys = useCallback(
    (next: SortKey[]) => onChange(ensureStableRowIds(next)),
    [onChange]
  );

  const {
    activeItems,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleKeyboardMove,
    resetDrag,
    isDragging,
    dragIndexRef,
  } = useDragReorder(displayKeys, commitKeys);

  useEffect(() => {
    if (!isDragging) resetDrag();
  }, [displayKeys, isDragging, resetDrag]);

  const updateKey = useCallback(
    (index: number, patch: Partial<SortKey>) => {
      commitKeys(activeItems.map((k, i) => (i === index ? { ...k, ...patch } : k)));
    },
    [activeItems, commitKeys]
  );

  const addKeyAfter = useCallback(
    (index: number) => {
      if (activeItems.length >= fieldCompletions.length) return;
      const next = [...activeItems];
      next.splice(index + 1, 0, { ...EMPTY_SORT_KEY, id: createStableRowId() });
      commitKeys(next);
    },
    [activeItems, commitKeys, fieldCompletions.length]
  );

  const removeKey = useCallback(
    (index: number) => {
      if (activeItems.length <= 1) {
        onChange([]);
        return;
      }
      commitKeys(activeItems.filter((_, i) => i !== index));
    },
    [activeItems, commitKeys, onChange]
  );

  const copyKeyAfter = useCallback(
    (index: number) => {
      if (activeItems.length >= fieldCompletions.length) return;
      const source = activeItems[index];
      if (!source) return;
      const next = [...activeItems];
      next.splice(index + 1, 0, {
        id: createStableRowId(),
        field: '',
        direction: source.direction,
        nulls: source.nulls,
      });
      commitKeys(next);
    },
    [activeItems, commitKeys, fieldCompletions.length]
  );

  const usedFields = useMemo(() => computeUsedFields(activeItems, (k) => k.field), [activeItems]);

  return (
    <GlassRowList
      headerClassName=""
      hideHeader={hideHeader}
      rowPaddingClassName="px-0"
      items={activeItems}
      getKey={(item, index) => item.id ?? `sort-key-${index}`}
      columns={[
        {
          flex: 'flex-[2]',
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
                searchPlaceholder={tr('fieldPicker.searchField')}
                emptyText={tr('fieldPicker.noMatch')}
                disabledOptions={disabledOptions}
                className="w-full"
              />
            );
          },
        },
        {
          flex: 'flex-[1]',
          header: tr('sortDirectionHeader'),
          render: (key: SortKey, i) => (
            <GlassDirectionToggle
              value={key.direction}
              onChange={(v) => updateKey(i, { direction: v })}
              variant="highlight"
              className="h-8 w-full px-1.5 text-[12px]"
            />
          ),
        },
        {
          flex: 'flex-[1]',
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
              className="h-8 w-full text-center rounded border border-border-muted bg-surface px-1.5 text-[12px] text-text-secondary outline-none focus:border-accent"
            />
          ),
        },
      ]}
      onAdd={addKeyAfter}
      onRemove={removeKey}
      onCopy={copyKeyAfter}
      actions={copyable ? ['add', 'copy', 'remove'] : ['add', 'remove']}
      addTitle={tr('sortAddKey')}
      removeTitle={tr('sortRemoveKey')}
      draggable
      dragHandlePosition="end"
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onKeyboardMove={handleKeyboardMove}
      getRowOpacity={(i) => !!(isDragging && dragIndexRef.current === i)}
      getDropMarker={(i) => (isDragging && dragIndexRef.current === i ? 'before' : null)}
    />
  );
}
