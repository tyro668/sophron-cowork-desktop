import { useCallback, useMemo, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { GlassFieldSingleSelect } from './GlassFieldSingleSelect';
import { AddRow, Cell, GridRow, HintRow, RowActionsCell, SegmentCells } from './FormGrid';
import { useGridRowDrag } from './useGridRowDrag';
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
  /** Columns the field select spans (sort: 1, limit: 3). */
  fieldSpan?: number;
  /** Rows rendered between the add row and the hint (e.g. limit's ties toggle). */
  extraRows?: ReactNode;
  /** Field column header (defaults to 「待排序字段」). */
  fieldHeader?: string;
  /** Override the generated rule sentence. */
  hint?: ReactNode;
}

/** Grid rows rendered by SortKeysEditor for a given key list (for label rowSpan). */
export function sortKeysEditorRowCount(keys: SortKey[], extraRows = 0): number {
  return Math.max(keys.length, 1) + 3 + extraRows;
}

/** Shared sort-key editor (field / direction / nulls) rendered as FormGrid
 *  cells: field (fieldSpan) | 升序 降序 | 空值默认 在前 在后 | actions. Used by
 *  sort and limit. Commit semantics: removing the last key commits `[]`; callers
 *  decide how to persist an empty list. */
export function SortKeysEditor({
  keys,
  fieldCompletions,
  columnTypes,
  onChange,
  copyable = true,
  fieldSpan = 1,
  extraRows,
  hint,
  fieldHeader,
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

  const { activeItems, rowProps, dragHandle } = useGridRowDrag(displayKeys, commitKeys);

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

  const total = fieldSpan + 6;
  const canAdd = activeItems.length < fieldCompletions.length;
  const rowLabels = {
    add: tr('sortAddKey'),
    copy: tr('rowList.copyRow'),
    remove: tr('sortRemoveKey'),
    drag: tr('rowList.dragToReorder'),
  };
  const configured = activeItems.filter((k) => k.field);
  const describe = (k: SortKey) => {
    const dir = k.direction === 'desc' ? tr('desc') : tr('asc');
    const nulls =
      k.nulls === 'first'
        ? tr('sortHintNullsFirst')
        : k.nulls === 'last'
          ? tr('sortHintNullsLast')
          : '';
    return tr('sortHintKey', { field: k.field, dir }) + nulls;
  };
  const generatedHint =
    configured.length === 0
      ? tr('sortHintEmpty')
      : configured
          .map((k, i) => (i === 0 ? tr('sortHintFirst') : tr('sortHintThen')) + describe(k))
          .join(tr('sortHintSeparator'));

  return (
    <>
      <Cell span={fieldSpan} v={['th']}>
        {fieldHeader ?? tr('sortFieldHeader')}
      </Cell>
      <Cell span={2} v={['th']}>
        {tr('sortDirectionHeader')}
      </Cell>
      <Cell span={3} v={['th']}>
        {tr('sortNullsHeader')}
      </Cell>
      <Cell v={['th']} />
      {activeItems.map((key, i) => {
        const disabledOptions = new Set(usedFields);
        if (key.field) disabledOptions.delete(key.field);
        return (
          <GridRow key={key.id ?? `sort-key-${i}`} {...rowProps(i)} testId={`sort-key-row-${i}`}>
            <Cell span={fieldSpan} v={['ctl']}>
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
            </Cell>
            <SegmentCells
              value={key.direction === 'desc' ? 'desc' : 'asc'}
              options={[
                { value: 'asc', label: tr('asc') },
                { value: 'desc', label: tr('desc') },
              ]}
              onChange={(v) => updateKey(i, { direction: v })}
              ariaLabel={tr('sortDirectionHeader')}
            />
            <SegmentCells
              value={(key.nulls ?? 'default') as 'default' | 'first' | 'last'}
              options={[
                { value: 'default', label: tr('sortNullsDefault') },
                { value: 'first', label: tr('sortNullsFirst') },
                { value: 'last', label: tr('sortNullsLast') },
              ]}
              onChange={(v) => updateKey(i, { nulls: v === 'default' ? undefined : v })}
              ariaLabel={tr('sortNullsHeader')}
            />
            <RowActionsCell
              labels={rowLabels}
              onAdd={() => addKeyAfter(i)}
              onCopy={copyable ? () => copyKeyAfter(i) : undefined}
              onRemove={() => removeKey(i)}
              canAdd={canAdd}
              dragHandle={dragHandle(i)}
            />
          </GridRow>
        );
      })}
      <AddRow
        span={total}
        label={tr('sortAddKey')}
        onClick={() => addKeyAfter(activeItems.length - 1)}
        disabled={!canAdd}
      />
      {extraRows}
      <HintRow span={total}>
        <Info className="opg-ic h-3.5 w-3.5" />
        {hint ?? generatedHint}
      </HintRow>
    </>
  );
}
