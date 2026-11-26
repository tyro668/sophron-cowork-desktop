import { usePipelineActions } from './use-pipeline-actions';
import { useRawTableActions } from './use-raw-table-actions';
import { useResultTableActions } from './use-result-table-actions';
import { useGroupActions } from './use-group-actions';
import type { DataActionsDeps } from './data-action-deps';
export type { DataActionsDeps } from './data-action-deps';

export function useDataActions(deps: DataActionsDeps) {
  const pipeline = usePipelineActions(deps);
  const rawTable = useRawTableActions(deps);
  const resultTable = useResultTableActions(deps);
  const group = useGroupActions(deps);
  return { ...pipeline, ...rawTable, ...resultTable, ...group };
}

export type DataActions = ReturnType<typeof useDataActions>;
