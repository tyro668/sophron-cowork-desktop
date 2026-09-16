/**
 * Data-feature view model types — the shapes the data workspace's server
 * state, editor state, and UI state are built from. Pure types only; no
 * component or IPC logic lives here.
 */
import type { DataDashboard, DataDataset, DataOutputTable } from '../../../types';

export type DataTab = 'tasks' | 'input_tables' | 'output_tables' | 'cloud_analysis';
export type InputTableSourceFilter = 'all' | 'excel' | 'csv' | 'folder';
export type InputTableSourceKind = Exclude<InputTableSourceFilter, 'all'> | 'file' | 'draft';

/** Locally-drafted input table not yet imported into the store. */
export interface InputTableDraft {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

/** Which stored table the preview dialog is showing. */
export type StoredPreviewTarget =
  | { kind: 'input'; dataset: DataDataset }
  | { kind: 'output'; outputTable: DataOutputTable };

export const EMPTY_DASHBOARD: DataDashboard = {
  summary: {
    taskCount: 0,
    workflowNodeCount: 0,
    runningCount: 0,
    todayScheduleCount: 0,
    statusCounts: {
      running: 0,
      completed: 0,
      stopped: 0,
      draft: 0,
      pending: 0,
      failed: 0,
    },
  },
  tasks: [],
  datasets: [],
  outputTables: [],
  totalTasks: 0,
  totalDatasets: 0,
  totalOutputTables: 0,
};
