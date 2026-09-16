import { useCallback, useMemo } from 'react';
import type { OperatorFormProps } from './types';
import { SortKeysEditor } from './shared/SortKeysEditor';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
import type { SortKey } from '../../../shared/operator-schemas';

export default function FormSort({
  node,
  taskId,
  fieldCompletions,
  sourceNode,
  onNodeChange,
}: OperatorFormProps) {
  const updateConfig = useUpdateConfig(onNodeChange);

  const keys = useMemo<SortKey[]>(() => (node.config.keys as SortKey[]) ?? [], [node.config.keys]);

  const columnTypes = useWorkflowNodeColumnTypes({ taskId, sourceNode });

  const commitKeys = useCallback(
    (next: SortKey[]) => {
      updateConfig((cfg) => ({ ...cfg, keys: next.length > 0 ? next : undefined }));
    },
    [updateConfig]
  );

  return (
    <div className="scrollbar-hover h-full min-h-0 overflow-y-auto p-3">
      <SortKeysEditor
        keys={keys}
        fieldCompletions={fieldCompletions}
        columnTypes={columnTypes}
        onChange={commitKeys}
      />
    </div>
  );
}
