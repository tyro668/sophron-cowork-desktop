import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassRadioSelect } from './shared/GlassRadioSelect';
import { GlassRowList, type RowAction } from './shared/GlassRowList';
import { DataTypeIcon } from './shared/DataTypeIcon';
import { useDataFieldTypeLabel } from '../../hooks/useDataFieldTypeLabel';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
import { useDragReorder } from '../../hooks/useDragReorder';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { mergeSelectedFields } from '../../../shared/operator-config';

export default function FormFieldSelect({
  node,
  taskId,
  fieldCompletions,
  sourceNode,
  onNodeChange,
}: OperatorFormProps) {
  const tr = useFormTranslation();
  const dataTypeLabel = useDataFieldTypeLabel();

  const columnTypes = useWorkflowNodeColumnTypes({ taskId, sourceNode });
  const updateConfig = useUpdateConfig(onNodeChange);

  const columns = useMemo(
    () => (node.config.columns as string[] | undefined) ?? [],
    [node.config.columns]
  );
  const mode = node.config.mode === 'exclude' ? 'exclude' : 'include';

  const commitColumns = useCallback(
    (next: string[]) => {
      updateConfig((cfg) => ({
        ...cfg,
        mode,
        columns: next.length > 0 ? next : undefined,
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

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <div className="scrollbar-hover flex w-[180px] shrink-0 flex-col overflow-y-auto border-r border-border-muted bg-surface/40 p-3.5">
        <GlassRadioSelect
          value={mode}
          options={[
            {
              value: 'include',
              label: tr('fieldSelectIncludeMode'),
              tip: tr('fieldSelectIncludeModeTip'),
            },
            {
              value: 'exclude',
              label: tr('fieldSelectExcludeMode'),
              tip: tr('fieldSelectExcludeModeTip'),
            },
          ]}
          onChange={(value) =>
            updateConfig((cfg) => ({
              ...cfg,
              mode: value as 'include' | 'exclude',
            }))
          }
          label={tr('fieldSelectMode')}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
        <div className="flex min-h-0 w-2/3 min-w-0 flex-col overflow-hidden">
          <div className="flex min-h-9 items-center gap-2 rounded-md border border-border-muted bg-background/60 px-2.5 py-1">
            <Search className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            <input
              type="text"
              value={rightSearch}
              onChange={(event) => setRightSearch(event.target.value)}
              placeholder={tr('searchField')}
              className="h-7 min-w-0 flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-secondary"
            />
            <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[12px] text-text-secondary hover:text-text-primary">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allVisibleSelected}
                onChange={() => {
                  if (allVisibleSelected) {
                    const visibleSet = new Set(visibleFields);
                    commitColumns(columns.filter((field) => !visibleSet.has(field)));
                  } else {
                    commitColumns(mergeSelectedFields(columns, visibleFields));
                  }
                }}
                className="h-3.5 w-3.5 accent-accent"
              />
              {tr('selectAll')}
            </label>
            <span className="text-[12px] text-text-secondary">
              {tr('fieldSelectCount')
                .replace('{{n}}', String(columns.length))
                .replace('{{total}}', String(fieldCompletions.length))}
            </span>
          </div>

          <div className="scrollbar-hover mt-2 flex-1 min-h-0 overflow-y-auto">
            {visibleFields.length === 0 ? (
              <div className="flex h-full items-center justify-center text-[12px] text-text-muted">
                {rightSearch ? tr('noMatch') : tr('noFields')}
              </div>
            ) : (
              <GlassRowList
                items={visibleFields}
                hideHeader
                draggable
                onDragStart={(i) => {
                  const field = visibleFields[i];
                  handleDragStart(orderedFields.indexOf(field));
                }}
                onDragOver={(e, i) => {
                  const field = visibleFields[i];
                  handleDragOver(e, orderedFields.indexOf(field));
                }}
                onDragEnd={handleDragEnd}
                getRowOpacity={(i) => {
                  const field = visibleFields[i];
                  return !!(isDragging && dragIndexRef.current === orderedFields.indexOf(field));
                }}
                dragTitle={tr('dragToReorder')}
                actions={['toTop', 'toBottom']}
                onToTop={(i) => moveToTop(visibleFields[i])}
                onToBottom={(i) => moveToBottom(visibleFields[i])}
                toTopTitle={tr('toTop')}
                toBottomTitle={tr('toBottom')}
                canAct={(action: RowAction, i) => {
                  const field = visibleFields[i];
                  if (action === 'toTop') return orderedFields[0] !== field;
                  if (action === 'toBottom')
                    return orderedFields[orderedFields.length - 1] !== field;
                  return true;
                }}
                columns={[
                  {
                    flex: 'w-8',
                    header: '',
                    render: (field: string) => {
                      const selected = columns.includes(field);
                      return (
                        <label className="flex h-7 cursor-pointer items-center justify-center">
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
                            className="h-3.5 w-3.5 accent-accent"
                          />
                        </label>
                      );
                    },
                  },
                  {
                    flex: 'flex-[1]',
                    header: '',
                    render: (field: string) => (
                      <div className="flex min-w-0 items-center gap-2">
                        <DataTypeIcon type={columnTypes?.[field]} />
                        <span className="min-w-0 truncate text-text-primary">{field}</span>
                      </div>
                    ),
                  },
                ]}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
