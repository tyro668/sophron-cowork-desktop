import { createContext, useContext } from 'react';
import type { DataWorkflowSaveInput } from '../types';

export interface WorkflowDataContextValue {
  /**
   * Bumped after each workflow run — field/type/value lookups refetch so they
   * reflect freshly materialized node caches.
   */
  version: number;
  /**
   * Live (possibly unsaved) canvas graph, kept stable across pure position
   * changes. Sent with node-data lookups so the backend can infer schemas for
   * draft edits instead of falling back to the saved workflow.
   */
  workflow: DataWorkflowSaveInput | null;
}

export const WorkflowDataContext = createContext<WorkflowDataContextValue>({
  version: 0,
  workflow: null,
});

export function useWorkflowDataContext(): WorkflowDataContextValue {
  return useContext(WorkflowDataContext);
}
