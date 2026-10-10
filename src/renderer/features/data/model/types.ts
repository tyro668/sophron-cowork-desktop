/**
 * Data-feature view model types — the shapes the data workspace's server
 * state, editor state, and UI state are built from. Pure types only; no
 * component or IPC logic lives here.
 */
import type { DataDashboard, DataRawTable, DataResultTable } from '../../../types';

export type DataTab = 'pipelines' | 'raw_tables' | 'result_tables' | 'cloud_analysis';
export type RawTableSourceKind = 'excel' | 'csv' | 'folder' | 'cloud' | 'file' | 'draft';

/** Locally-drafted input table not yet imported into the store. */
export interface RawTableDraft {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

/** Which stored table the preview dialog is showing. */
export type StoredPreviewTarget =
  { kind: 'raw'; rawTable: DataRawTable } | { kind: 'result'; resultTable: DataResultTable };

export const EMPTY_DASHBOARD: DataDashboard = {
  summary: {
    pipelineCount: 0,
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
  pipelines: [],
  rawTables: [],
  resultTables: [],
  groups: [],
  totalPipelines: 0,
  totalRawTables: 0,
  totalResultTables: 0,
  pipelineGroupCounts: {},
  rawTableGroupCounts: {},
  outputGroupCounts: {},
};
