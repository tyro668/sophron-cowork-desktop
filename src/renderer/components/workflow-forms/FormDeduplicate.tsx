import { useCallback, useMemo } from 'react';
import { X } from 'lucide-react';

import type { OperatorFormProps } from './index';
import { GlassFieldMultiDropdown } from './shared/GlassFieldMultiDropdown';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import { GlassSegmentedControl } from './shared/GlassSegmentedControl';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import type { SortKey } from '../../../shared/operator-schemas';

export default function FormDeduplicate({
  node,
  taskId,
  fieldCompletions,
  sourceNode,
  onNodeChange,
}: OperatorFormProps) {
  const tr = useFormTranslation('deduplicate');
  const columnTypes = useWorkflowNodeColumnTypes({ taskId, sourceNode });
  const updateConfig = useUpdateConfig(onNodeChange);

  const strategy: 'by_columns' | 'all_columns' =
    node.config?.strategy === 'all_columns' ? 'all_columns' : 'by_columns';
  const columns = useMemo(() => (node.config?.columns as string[]) ?? [], [node.config?.columns]);
  const keep: 'first' | 'last' = node.config?.keep === 'last' ? 'last' : 'first';
  const orderBy = useMemo(() => (node.config?.orderBy as SortKey[]) ?? [], [node.config?.orderBy]);
  const orderField = orderBy[0]?.field ?? '';
  const orderDirection: 'asc' | 'desc' = orderBy[0]?.direction === 'desc' ? 'desc' : 'asc';

  const setStrategy = useCallback(
    (next: 'by_columns' | 'all_columns') => {
      updateConfig((cfg) => ({
        ...cfg,
        strategy: next,
        columns: next === 'all_columns' ? undefined : cfg.columns,
      }));
    },
    [updateConfig]
  );

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

  const commitOrderField = useCallback(
    (field: string) => {
      updateConfig((cfg) => {
        if (!field) return { ...cfg, orderBy: undefined };
        const prev = (cfg.orderBy as SortKey[] | undefined)?.[0];
        return { ...cfg, orderBy: [{ ...prev, field, direction: prev?.direction ?? 'asc' }] };
      });
    },
    [updateConfig]
  );

  const commitOrderDirection = useCallback(
    (direction: 'asc' | 'desc') => {
      updateConfig((cfg) => {
        const prev = (cfg.orderBy as SortKey[] | undefined)?.[0];
        if (!prev?.field) return cfg;
        return { ...cfg, orderBy: [{ ...prev, direction }] };
      });
    },
    [updateConfig]
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-3">
      <div className="flex items-center gap-2">
        <GlassFormLabel>{tr('dedupBasis')}</GlassFormLabel>
        <GlassSegmentedControl
          value={strategy}
          options={[
            { value: 'by_columns', label: tr('dedupByFields') },
            { value: 'all_columns', label: tr('dedupWholeRow') },
          ]}
          onChange={setStrategy}
          ariaLabel={tr('dedupBasis')}
        />
        <div className="min-w-0 flex-1">
          <GlassFieldMultiDropdown
            columns={fieldCompletions}
            selected={columns}
            onChange={commitColumns}
            placeholder={tr('fieldPicker.selectField')}
            columnTypes={columnTypes}
            disabled={strategy === 'all_columns'}
            className="w-full"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <GlassFormLabel>{tr('dedupDuplicates')}</GlassFormLabel>
        <GlassOptionSingleSelect
          value={keep}
          groups={[
            {
              key: 'keep',
              items: [
                { value: 'first', label: tr('dedupKeepOne') },
                { value: 'last', label: tr('dedupKeepLastOne') },
              ],
            },
          ]}
          onChange={(value) => updateConfig((cfg) => ({ ...cfg, keep: value }))}
          className="h-9 w-[240px] max-w-full"
        />
      </div>

      <div className="flex items-center gap-2">
        <GlassFormLabel>{tr('dedupKeepWhich')}</GlassFormLabel>
        <GlassFieldSingleSelect
          value={orderField}
          options={fieldCompletions}
          columnTypes={columnTypes}
          onChange={commitOrderField}
          placeholder={tr('sortKeys.sortSelectField')}
          searchPlaceholder={tr('fieldPicker.searchField')}
          emptyText={tr('fieldPicker.noMatch')}
          className="h-9 flex-1"
        />
        <button
          type="button"
          onClick={() => commitOrderField('')}
          disabled={!orderField}
          className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-text-muted outline-none transition-colors hover:bg-surface-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-accent/30 ${
            orderField ? '' : 'invisible'
          }`}
          title={tr('fieldPicker.clearAll')}
          aria-label={tr('fieldPicker.clearAll')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <GlassOptionSingleSelect
          value={orderDirection}
          groups={[
            {
              key: 'direction',
              items: [
                { value: 'asc', label: tr('sortKeys.asc') },
                { value: 'desc', label: tr('sortKeys.desc') },
              ],
            },
          ]}
          onChange={(value) => commitOrderDirection(value as 'asc' | 'desc')}
          disabled={!orderField}
          className="h-9 flex-1"
        />
      </div>
    </div>
  );
}
