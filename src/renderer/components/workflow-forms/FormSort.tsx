import { useCallback, useMemo } from 'react';
import type { OperatorFormProps } from './index';
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
    <div className="flex h-full overflow-hidden">
      {/* Left: sort keys */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="scrollbar-hover flex-1 space-y-1 overflow-y-auto px-2 pr-3 pb-2 pt-1">
          <SortKeysEditor
            keys={keys}
            fieldCompletions={fieldCompletions}
            columnTypes={columnTypes}
            onChange={commitKeys}
          />
        </div>
      </div>
    </div>
  );
}
