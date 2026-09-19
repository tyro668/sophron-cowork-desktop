import { useEffect, useMemo, useState } from 'react';
import type { OperatorFormProps } from './types';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassFieldMultiDropdown } from './shared/GlassFieldMultiDropdown';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';

export default function FormUnpivot({
  node,
  taskId,
  fieldCompletions,
  sourceNode,
  onNodeChange,
}: OperatorFormProps) {
  const tr = useFormTranslation('unpivot');
  const updateConfig = useUpdateConfig(onNodeChange);
  const columnTypes = useWorkflowNodeColumnTypes({ taskId, sourceNode });

  const mode = (node.config.mode as string) ?? 'include';
  const nameColumn = (node.config.nameColumn as string) ?? '';
  const valueColumn = (node.config.valueColumn as string) ?? '';
  const includeNulls = !!node.config.includeNulls;
  const rawColumns = useMemo(() => (node.config.columns as string[]) ?? [], [node.config.columns]);

  const columns = useMemo(
    () =>
      mode === 'except'
        ? fieldCompletions.filter((c) => !rawColumns.includes(c))
        : // Keep configured columns even when unresolved — the picker flags
          // them as missing/pending instead of silently dropping the config.
          rawColumns,
    [mode, rawColumns, fieldCompletions]
  );

  const [localNameCol, setLocalNameCol] = useState(nameColumn);
  const [localValueCol, setLocalValueCol] = useState(valueColumn);

  useEffect(() => {
    setLocalNameCol(nameColumn);
    setLocalValueCol(valueColumn);
  }, [nameColumn, valueColumn]);

  return (
    <div className="scrollbar-hover flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-3">
      <div className="flex items-center gap-2">
        <GlassFormLabel>{tr('unpivotDimensionsLabel')}</GlassFormLabel>
        <div className="min-w-0 flex-1">
          <GlassFieldMultiDropdown
            columns={fieldCompletions}
            selected={columns}
            onChange={(selected) =>
              updateConfig((cfg) => ({
                ...cfg,
                mode: 'include',
                columns: selected,
              }))
            }
            columnTypes={columnTypes}
            placeholder={tr('common.selectColumns')}
            maxHeight="300px"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <GlassFormLabel>{tr('unpivotNameCol')}</GlassFormLabel>
        <GlassFormTextInput
          value={localNameCol}
          onChange={(v) => {
            setLocalNameCol(v);
            updateConfig((cfg) => ({ ...cfg, nameColumn: v }));
          }}
          placeholder={tr('unpivotNameColPlaceholder')}
          className="h-8 w-60 rounded-md px-2"
        />
      </div>

      <div className="flex items-center gap-2">
        <GlassFormLabel>{tr('unpivotValueCol')}</GlassFormLabel>
        <GlassFormTextInput
          value={localValueCol}
          onChange={(v) => {
            setLocalValueCol(v);
            updateConfig((cfg) => ({ ...cfg, valueColumn: v }));
          }}
          placeholder={tr('unpivotValueColPlaceholder')}
          className="h-8 w-60 rounded-md px-2"
        />
      </div>

      <div className="flex items-center gap-2">
        <GlassFormLabel>{tr('unpivotNullsLabel')}</GlassFormLabel>
        <label className="flex h-8 cursor-pointer items-center gap-1.5 text-[13px] text-text-secondary">
          <input
            type="checkbox"
            checked={includeNulls}
            onChange={(e) => updateConfig((cfg) => ({ ...cfg, includeNulls: e.target.checked }))}
            className="h-3.5 w-3.5 accent-accent"
          />
          {tr('unpivotIncludeNulls')}
        </label>
      </div>
    </div>
  );
}
