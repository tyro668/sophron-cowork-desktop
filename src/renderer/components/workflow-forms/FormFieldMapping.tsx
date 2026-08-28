import { useCallback, useEffect, useMemo } from 'react';
import type { OperatorFormProps } from './index';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import { GlassRowList, type GlassRowListColumn, type RowAction } from './shared/GlassRowList';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useDragReorder } from '../../hooks/useDragReorder';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
import { computeUsedFields } from '../../../shared/collections/used-fields';
import {
  computeFieldMappingTarget,
  EMPTY_FIELD_MAPPING,
  normalizeFieldMappingEntry,
} from '../../../shared/operator-config';
import type { FieldMappingEntry } from '../../../shared/operator-schemas';

export default function FormFieldMapping({
  node,
  taskId,
  fieldCompletions,
  sourceNode,
  onNodeChange,
}: OperatorFormProps) {
  const tr = useFormTranslation('fieldMapping');
  const updateConfig = useUpdateConfig(onNodeChange);
  const columnTypes = useWorkflowNodeColumnTypes({ taskId, sourceNode });

  const mappings = useMemo<FieldMappingEntry[]>(
    () =>
      ((node.config.mappings as Record<string, unknown>[]) ?? []).map(normalizeFieldMappingEntry),
    [node.config.mappings]
  );
  const editableMappings = useMemo(
    () => (mappings.length > 0 ? mappings : [{ ...EMPTY_FIELD_MAPPING }]),
    [mappings]
  );

  const commitMappings = useCallback(
    (next: FieldMappingEntry[]) => {
      updateConfig((cfg) => ({ ...cfg, mappings: next.length > 0 ? next : undefined }));
    },
    [updateConfig]
  );

  const {
    activeItems: activeMappings,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    isDragging,
    resetDrag,
    dragIndexRef,
  } = useDragReorder(editableMappings, commitMappings);

  useEffect(() => {
    if (!isDragging) resetDrag();
  }, [mappings, isDragging, resetDrag]);

  const usedFields = useMemo(
    () => computeUsedFields(activeMappings, (m) => m.source),
    [activeMappings]
  );

  const updateMapping = useCallback(
    (index: number, patch: Partial<FieldMappingEntry>) => {
      const next = activeMappings.map((m, i) => (i === index ? { ...m, ...patch } : m));
      commitMappings(next);
    },
    [activeMappings, commitMappings]
  );

  const addMappingAfter = useCallback(
    (index: number) => {
      if (activeMappings.length >= fieldCompletions.length) return;
      const next = [...activeMappings];
      next.splice(index + 1, 0, { ...EMPTY_FIELD_MAPPING });
      commitMappings(next);
    },
    [activeMappings, fieldCompletions.length, commitMappings]
  );

  const copyMapping = useCallback(
    (index: number) => {
      if (activeMappings.length >= fieldCompletions.length) return;
      const source = activeMappings[index];
      const next = [...activeMappings];
      next.splice(index + 1, 0, {
        source: '',
        targetMode: source.targetMode,
        targetValue: source.targetValue,
      } as FieldMappingEntry);
      commitMappings(next);
    },
    [activeMappings, fieldCompletions.length, commitMappings]
  );

  const removeMapping = useCallback(
    (index: number) => {
      if (activeMappings.length <= 1) {
        commitMappings([]);
        return;
      }
      commitMappings(activeMappings.filter((_, i) => i !== index));
    },
    [activeMappings, commitMappings]
  );

  const targetModeOptions = useMemo(
    () => [
      { value: 'prefix', label: tr('fieldMappingModePrefix') },
      { value: 'suffix', label: tr('fieldMappingModeSuffix') },
      { value: 'rename', label: tr('fieldMappingModeRename') },
    ],
    [tr]
  );

  const columns = useMemo<GlassRowListColumn<FieldMappingEntry>[]>(
    () => [
      {
        flex: 'flex-[1]',
        header: tr('fieldMappingSourceField'),
        render: (item, i) => {
          const disabledFields = new Set(usedFields);
          if (item.source) disabledFields.delete(item.source);
          return (
            <GlassFieldSingleSelect
              value={item.source}
              options={fieldCompletions}
              columnTypes={columnTypes}
              onChange={(value) => updateMapping(i, { source: value })}
              placeholder={tr('fieldMappingSelectField')}
              searchPlaceholder={tr('fieldPicker.searchField')}
              emptyText={tr('fieldPicker.noMatch')}
              disabledOptions={disabledFields}
              className="flex-1 min-w-0 h-7"
            />
          );
        },
      },
      {
        flex: 'flex-[1]',
        header: tr('fieldMappingMode'),
        render: (item, i) => (
          <GlassOptionSingleSelect
            value={item.targetMode}
            onChange={(v) => updateMapping(i, { targetMode: v as FieldMappingEntry['targetMode'] })}
            groups={[{ key: 'mode', items: targetModeOptions }]}
            variant="highlight"
            className="h-7 w-full text-[12px]"
          />
        ),
      },
      {
        flex: 'flex-[1]',
        header: tr('fieldMappingValue'),
        render: (item, i) => (
          <GlassFormTextInput
            value={item.targetValue}
            onChange={(v) => updateMapping(i, { targetValue: v })}
            placeholder={
              item.targetMode === 'rename'
                ? tr('fieldMappingRenamePlaceholder')
                : item.targetMode === 'prefix'
                  ? tr('fieldMappingPrefixPlaceholder')
                  : tr('fieldMappingSuffixPlaceholder')
            }
            className="h-7 px-1.5 text-[12px] w-full"
          />
        ),
      },
      {
        flex: 'flex-[1]',
        header: tr('fieldMappingTargetField'),
        render: (item, _i) => {
          const target = computeFieldMappingTarget(item);
          return (
            <span
              className="truncate w-full rounded border border-border-subtle/80 bg-surface-hover/45 px-1.5 py-1 text-[12px] text-text-muted"
              title={target}
            >
              {target || '—'}
            </span>
          );
        },
      },
    ],
    [columnTypes, fieldCompletions, usedFields, tr, updateMapping, targetModeOptions]
  );

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="scrollbar-hover flex-1 overflow-y-auto px-2 pr-3 pb-2 pt-1">
          <GlassRowList
            headerClassName=""
            items={activeMappings}
            columns={columns}
            actions={['add', 'copy', 'remove']}
            onAdd={addMappingAfter}
            onRemove={removeMapping}
            onCopy={copyMapping}
            addTitle={tr('fieldMappingAdd')}
            removeTitle={tr('fieldMappingRemove')}
            canAct={(action: RowAction) =>
              action === 'copy'
                ? activeMappings.length < fieldCompletions.length
                : action === 'add'
                  ? activeMappings.length < fieldCompletions.length
                  : true
            }
            draggable
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            getRowOpacity={(i) => !!(isDragging && dragIndexRef.current === i)}
            dragTitle={tr('rowList.dragToReorder')}
          />
        </div>
      </div>
    </div>
  );
}
