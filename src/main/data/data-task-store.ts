import type { DataDashboard, DataDashboardQuery, DataTaskStatusCounts } from '../../renderer/types';
import {
  DashboardSummaryRow,
  DataDatasetRow,
  DataTaskRow,
  DataTaskStoreOptions,
  mapDatasetRow,
  mapOutputTableRow,
  mapTaskRow,
  outputTableConfigPredicateSql,
  startOfToday,
  storedDatasetSourceKindSql,
} from './store/data-store-records';
import { normalizeListWindow, toNumber } from './operators';
import { TaskWorkflowStore } from './store/task-workflow-store';

export class DataTaskStore extends TaskWorkflowStore {
  async getDashboard(query: DataDashboardQuery = {}): Promise<DataDashboard> {
    await this.ensureMetadataReady();
    if (query.includeOutputTables === true) {
      await this.cleanupOutputTableMetadata();
    }
    const normalizedQuery = (query.query ?? '').trim().toLowerCase();
    const like = `%${normalizedQuery.replace(/[%_\\]/g, '\\$&')}%`;
    const includeSummary = query.includeSummary !== false;
    const includeTasks = query.includeTasks !== false;
    const includeDatasets = query.includeDatasets !== false;
    const includeOutputTables = query.includeOutputTables === true;
    const datasetSourceKind =
      query.datasetSourceKind && query.datasetSourceKind !== 'all' ? query.datasetSourceKind : '';
    const taskWindow = normalizeListWindow(query.taskOffset, query.taskLimit);
    const datasetWindow = normalizeListWindow(query.datasetOffset, query.datasetLimit);
    const outputWindow = normalizeListWindow(query.outputOffset, query.outputLimit);
    const todayStart = startOfToday(this.now());
    const todayEnd = todayStart + 86_400_000;
    const summaryRows = includeSummary
      ? await this.metaQueryRows<DashboardSummaryRow>(
          `
              SELECT
                count(*) AS task_count,
                coalesce(sum(node_count), 0) AS workflow_node_count,
                coalesce(sum(CASE WHEN status = 'running' THEN 1 ELSE 0 END), 0) AS running_count,
                coalesce(sum(CASE WHEN scheduled_for >= $todayStart AND scheduled_for < $todayEnd THEN 1 ELSE 0 END), 0) AS today_schedule_count,
                coalesce(sum(CASE WHEN status = 'draft' THEN 1 ELSE 0 END), 0) AS draft_count,
                coalesce(sum(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count,
                coalesce(sum(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_count,
                coalesce(sum(CASE WHEN status = 'stopped' THEN 1 ELSE 0 END), 0) AS stopped_count,
                coalesce(sum(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed_count
              FROM data_cleaning_tasks
            `,
          { todayStart, todayEnd }
        )
      : [];
    const summary = summaryRows[0] ?? {
      task_count: 0,
      workflow_node_count: 0,
      running_count: 0,
      today_schedule_count: 0,
      draft_count: 0,
      pending_count: 0,
      completed_count: 0,
      stopped_count: 0,
      failed_count: 0,
    };
    const taskCountRows = includeTasks
      ? await this.metaQueryRows<{ count: number | string }>(
          `
              SELECT count(*) AS count
              FROM data_cleaning_tasks
              WHERE $query = ''
                OR lower(name) LIKE $like ESCAPE '\\'
                OR lower(coalesce(source_path, '')) LIKE $like ESCAPE '\\'
            `,
          { query: normalizedQuery, like }
        )
      : [{ count: includeSummary ? summary.task_count : 0 }];
    const taskRows = includeTasks
      ? await this.metaQueryRows<DataTaskRow>(
          `
              SELECT
                id, name, status, node_count, source_path, source_dataset_id, output_table,
                row_count, column_count, error, scheduled_for, created_at, updated_at, last_run_at
              FROM data_cleaning_tasks
              WHERE $query = ''
                OR lower(name) LIKE $like ESCAPE '\\'
                OR lower(coalesce(source_path, '')) LIKE $like ESCAPE '\\'
              ORDER BY updated_at DESC, created_at DESC
              LIMIT ${taskWindow.limit} OFFSET ${taskWindow.offset}
            `,
          { query: normalizedQuery, like }
        )
      : [];
    const datasetCountRows = includeDatasets
      ? await this.metaQueryRows<{ count: number | string }>(
          `
              SELECT count(*) AS count
              FROM data_datasets
              WHERE ($query = ''
                OR lower(name) LIKE $like ESCAPE '\\'
                OR lower(source_path) LIKE $like ESCAPE '\\')
                AND ${storedDatasetSourceKindSql()} <> 'output'
                AND (
                  $sourceKind = ''
                  OR ${storedDatasetSourceKindSql()} = $sourceKind
                )
            `,
          { query: normalizedQuery, like, sourceKind: datasetSourceKind }
        )
      : [{ count: 0 }];
    const datasetRows = includeDatasets
      ? await this.metaQueryRows<DataDatasetRow>(
          `
              WITH page AS (
                SELECT d.*
                FROM data_datasets d
                WHERE ($query = ''
                  OR lower(d.name) LIKE $like ESCAPE '\\'
                  OR lower(d.source_path) LIKE $like ESCAPE '\\')
                  AND ${storedDatasetSourceKindSql('d')} <> 'output'
                  AND (
                    $sourceKind = ''
                    OR ${storedDatasetSourceKindSql('d')} = $sourceKind
                  )
                ORDER BY d.updated_at DESC, d.created_at DESC
                LIMIT ${datasetWindow.limit} OFFSET ${datasetWindow.offset}
              )
              SELECT
                page.*,
                ${this.inputTableRelatedTaskNamesSql('page')} AS related_task_names
              FROM page
            `,
          { query: normalizedQuery, like, sourceKind: datasetSourceKind }
        )
      : [];
    const outputCountRows = includeOutputTables
      ? await this.metaQueryRows<{ count: number | string }>(
          `
              SELECT count(*) AS count
              FROM data_datasets
              WHERE ($query = ''
                OR lower(name) LIKE $like ESCAPE '\\'
                OR lower(table_name) LIKE $like ESCAPE '\\')
                AND ${outputTableConfigPredicateSql()}
            `,
          { query: normalizedQuery, like }
        )
      : [{ count: 0 }];
    const outputRows = includeOutputTables
      ? await this.metaQueryRows<DataDatasetRow>(
          `
              SELECT
                d.*,
                ${this.outputTableRelatedTaskNamesSql('d')} AS related_task_names
              FROM data_datasets d
              WHERE ($query = ''
                OR lower(d.name) LIKE $like ESCAPE '\\'
                OR lower(d.table_name) LIKE $like ESCAPE '\\')
                AND ${outputTableConfigPredicateSql('d')}
              ORDER BY d.updated_at DESC, d.created_at DESC
              LIMIT ${outputWindow.limit} OFFSET ${outputWindow.offset}
            `,
          { query: normalizedQuery, like }
        )
      : [];
    const statusCounts: DataTaskStatusCounts = {
      running: toNumber(summary.running_count),
      completed: toNumber(summary.completed_count),
      stopped: toNumber(summary.stopped_count),
      draft: toNumber(summary.draft_count),
      pending: toNumber(summary.pending_count),
      failed: toNumber(summary.failed_count),
    };

    return {
      summary: {
        taskCount: toNumber(summary.task_count),
        workflowNodeCount: toNumber(summary.workflow_node_count),
        runningCount: statusCounts.running,
        todayScheduleCount: toNumber(summary.today_schedule_count),
        statusCounts,
      },
      tasks: taskRows.map(mapTaskRow),
      datasets: datasetRows.map(mapDatasetRow),
      outputTables: outputRows.map(mapOutputTableRow),
      totalTasks: toNumber(taskCountRows[0]?.count),
      totalDatasets: toNumber(datasetCountRows[0]?.count),
      totalOutputTables: toNumber(outputCountRows[0]?.count),
    };
  }
}

export function createDataTaskStore(dbPath: string, options?: DataTaskStoreOptions): DataTaskStore {
  return new DataTaskStore(dbPath, options);
}

export type { DataDatasetCsvExport } from './store/data-store-records';
