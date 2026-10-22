import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpToLine, GripVertical, Search } from 'lucide-react';
import type { OperatorFormProps } from './types';
import { Cell, FormGrid, FormScroll, GridRow, SegmentCells } from './shared/FormGrid';
import { FIELD_SELECT_GRID_COLUMNS } from './shared/gridColumns';
import { DataTypeIcon } from './shared/DataTypeIcon';
import { useDataFieldTypeLabel } from '../../hooks/useDataFieldTypeLabel';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
import { useDragReorder } from '../../hooks/useDragReorder';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { mergeSelectedFields } from '../../../shared/operator-config';

export default function FormFieldSelect({
  node,
  pipelineId,
  fieldCompletions,
  sourceNode,
  onNodeChange,
}: OperatorFormProps) {
  const tr = useFormTranslation('fieldSelect');
  const dataTypeLabel = useDataFieldTypeLabel();

  const columnTypes = useWorkflowNodeColumnTypes({ pipelineId, sourceNode });
  const updateConfig = useUpdateConfig(onNodeChange);

  const columns = useMemo(
    () => (node.config.fields as string[] | undefined) ?? [],
    [node.config.fields]
  );
  const mode = node.config.selection === 'exclude' ? 'exclude' : 'include';

  const commitColumns = useCallback(
    (next: string[]) => {
      updateConfig((cfg) => ({
        ...cfg,
        selection: mode,
        fields: next.length > 0 ? next : undefined,
      }));
    },
    [mode, updateConfig]
  );

  const orderedFields = useMemo(() => {
    const selectedSet = new Set(columns);
    return [...columns, ...fieldCompletions.filter((field) => !selectedSet.has(field))];
  }, [columns, fieldCompletions]);

  const commitReorder = useCallback(
    (next: string[]) => {
      const selectedSet = new Set(columns);
      commitColumns(next.filter((field) => selectedSet.has(field)));
    },
    [columns, commitColumns]
  );

  const moveToTop = useCallback(
    (col: string) => {
      commitReorder([col, ...orderedFields.filter((candidate) => candidate !== col)]);
    },
    [commitReorder, orderedFields]
  );

  const moveToBottom = useCallback(
    (col: string) => {
      commitReorder([...orderedFields.filter((candidate) => candidate !== col), col]);
    },
    [commitReorder, orderedFields]
  );

  const [rightSearch, setRightSearch] = useState('');

  const visibleFields = useMemo(() => {
    const query = rightSearch.toLowerCase().trim();
    if (!query) return orderedFields;
    return orderedFields.filter((field) => {
      if (field.toLowerCase().includes(query)) return true;
      const type = columnTypes?.[field];
      return Boolean(
        type &&
        (type.toLowerCase().includes(query) || dataTypeLabel(type).toLowerCase().includes(query))
      );
    });
  }, [columnTypes, dataTypeLabel, orderedFields, rightSearch]);

  const allVisibleSelected =
    visibleFields.length > 0 && visibleFields.every((field) => columns.includes(field));
  const someVisibleSelected = visibleFields.some((field) => columns.includes(field));
  const selectAllIndeterminate = someVisibleSelected && !allVisibleSelected;

  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectAllIndeterminate;
    }
  }, [selectAllIndeterminate]);

  const { handleDragStart, handleDragOver, handleDragEnd, isDragging, resetDrag, dragIndexRef } =
    useDragReorder(orderedFields, commitReorder);

  useEffect(() => {
    if (!isDragging) resetDrag();
  }, [orderedFields, isDragging, resetDrag]);

  const modeOptions = [
    {
      value: 'include' as const,
      label: tr('fieldSelectIncludeMode'),
      tip: tr('fieldSelectIncludeModeTip'),
    },
    {
      value: 'exclude' as const,
      label: tr('fieldSelectExcludeMode'),
      tip: tr('fieldSelectExcludeModeTip'),
    },
  ];

  const handleSelectAll = () => {
    if (allVisibleSelected) {
      const visibleSet = new Set(visibleFields);
      commitColumns(columns.filter((field) => !visibleSet.has(field)));
    } else {
      commitColumns(mergeSelectedFields(columns, visibleFields));
    }
  };

  return (
    <FormScroll>
      <FormGrid columns={FIELD_SELECT_GRID_COLUMNS} testId="field-select-form-grid">
        <Cell v={['ctr']}>
          <input
            ref={selectAllRef}
            type="checkbox"
            checked={allVisibleSelected}
            onChange={handleSelectAll}
            aria-label={tr('fieldPicker.selectAll')}
            title={tr('fieldPicker.selectAll')}
            className="opg-cbx"
          />
        </Cell>
        <SegmentCells
          value={mode}
          options={modeOptions.map((option) => ({
            value: option.value,
            label: option.label,
            title: option.tip,
          }))}
          onChange={(value) => updateConfig((cfg) => ({ ...cfg, selection: value }))}
          ariaLabel={tr('fieldSelectMode')}
        />
        <Cell v={['ctl']}>
          <label className="flex min-w-0 flex-1 items-center gap-2 pl-2.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            <input
              type="text"
              value={rightSearch}
              onChange={(event) => setRightSearch(event.target.value)}
              placeholder={tr('fieldSelectSearchPlaceholder')}
              aria-label={tr('fieldPicker.searchField')}
              className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-muted"
            />
          </label>
        </Cell>
        <Cell v={['muted', 'ctr']}>
          {tr('fieldSelectCountShort', {
            n: String(columns.length),
            total: String(fieldCompletions.length),
          })}
        </Cell>
        {visibleFields.length === 0 ? (
          <Cell span={5} v={['muted', 'ctr']}>
            {rightSearch ? tr('fieldPicker.noMatch') : tr('fieldPicker.noFields')}
          </Cell>
        ) : null}
        {visibleFields.map((field, i) => {
          const selected = columns.includes(field);
          const orderIndex = orderedFields.indexOf(field);
          const missing = !fieldCompletions.includes(field);
          const dragging = Boolean(isDragging && dragIndexRef.current === orderIndex);
          return (
            <GridRow
              key={field}
              dragging={dragging}
              hover
              compact
              onDragOver={(event) => handleDragOver(event, orderIndex)}
              testId={`field-select-row-${i}`}
            >
              <Cell v={['ctr']}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() =>
                    commitColumns(
                      selected
                        ? columns.filter((candidate) => candidate !== field)
                        : [...columns, field]
                    )
                  }
                  aria-label={field}
                  className="opg-cbx"
                />
              </Cell>
              <Cell span={3}>
                <DataTypeIcon type={columnTypes?.[field]} />
                <span
                  className={`min-w-0 truncate ${missing ? 'text-error' : 'text-text-primary'}`}
                >
                  {field}
                </span>
                {missing ? (
                  <span
                    className={`shrink-0 text-[11px] ${fieldCompletions.length ? 'text-error' : 'text-text-muted'}`}
                  >
                    {fieldCompletions.length
                      ? tr('fieldPicker.fieldNotFoundShort')
                      : tr('fieldPicker.fieldPendingInference')}
                  </span>
                ) : null}
              </Cell>
              <Cell v={['acts']}>
                <button
                  type="button"
                  className="opg-act"
                  onClick={() => moveToTop(field)}
                  disabled={orderedFields[0] === field}
                  title={tr('rowList.toTop')}
                  aria-label={tr('rowList.toTop')}
                >
                  <ArrowUpToLine className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="opg-act"
                  onClick={() => moveToBottom(field)}
                  disabled={orderedFields[orderedFields.length - 1] === field}
                  title={tr('rowList.toBottom')}
                  aria-label={tr('rowList.toBottom')}
                >
                  <ArrowDownToLine className="h-3.5 w-3.5" />
                </button>
                <span
                  role="button"
                  tabIndex={0}
                  draggable
                  className="opg-act cursor-grab"
                  onDragStart={(event) => {
                    event.dataTransfer?.setData('text/plain', field);
                    handleDragStart(orderIndex);
                  }}
                  onDragEnd={handleDragEnd}
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                    event.preventDefault();
                    const adjacentField = visibleFields[event.key === 'ArrowUp' ? i - 1 : i + 1];
                    if (!adjacentField) return;
                    const next = [...orderedFields];
                    const adjacentIndex = next.indexOf(adjacentField);
                    [next[orderIndex], next[adjacentIndex]] = [
                      next[adjacentIndex],
                      next[orderIndex],
                    ];
                    commitReorder(next);
                  }}
                  title={tr('rowList.dragToReorder')}
                  aria-label={tr('rowList.dragToReorder')}
                  aria-keyshortcuts="ArrowUp ArrowDown"
                >
                  <GripVertical className="h-3.5 w-3.5" />
                </span>
              </Cell>
            </GridRow>
          );
        })}
      </FormGrid>
    </FormScroll>
  );
}
