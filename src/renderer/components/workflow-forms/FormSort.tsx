import { useCallback, useMemo } from 'react';
import type { OperatorFormProps } from './types';
import { SortKeysEditor } from './shared/SortKeysEditor';
import { FormGrid, FormScroll } from './shared/FormGrid';
import { SORT_GRID_COLUMNS } from './shared/gridColumns';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
import type { SortKey } from '../../../shared/operator-schemas';

export default function FormSort({
  node,
  pipelineId,
  fieldCompletions,
  sourceNode,
  onNodeChange,
}: OperatorFormProps) {
  const updateConfig = useUpdateConfig(onNodeChange);

  const keys = useMemo<SortKey[]>(
    () => (node.config.orderBy as SortKey[]) ?? [],
    [node.config.orderBy]
  );

  const columnTypes = useWorkflowNodeColumnTypes({ pipelineId, sourceNode });

  const commitKeys = useCallback(
    (next: SortKey[]) => {
      updateConfig((cfg) => ({ ...cfg, orderBy: next.length > 0 ? next : undefined }));
    },
    [updateConfig]
  );

  return (
    <FormScroll>
      <FormGrid columns={SORT_GRID_COLUMNS} testId="sort-form-grid">
        <SortKeysEditor
          keys={keys}
          fieldCompletions={fieldCompletions}
          columnTypes={columnTypes}
          onChange={commitKeys}
        />
      </FormGrid>
    </FormScroll>
  );
}
