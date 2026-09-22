/** Dashboard aggregate reads. */
import type {
  DataDashboard,
  DataDashboardQuery,
  DataTaskStatusCounts,
} from '../../../../shared/contracts';
import { toNumber, normalizeListWindow } from '../../operators';
import { DataStoreContext } from '../data-store-context';
import {
  DataDatasetRow,
  DataGroupRow,
  storedDatasetSourceKindSql,
  mapDatasetRow,
  mapGroupRow,
  mapOutputTableRow,
  outputTableConfigPredicateSql,
  DataTaskRow,
  mapTaskRow,
  DashboardSummaryRow,
  startOfToday,
} from '../data-store-records';
export class DashboardService {
  constructor(private readonly ctx: DataStoreContext) {}
  async getDashboard(query: DataDashboardQuery = {}): Promise<DataDashboard> {
    await this.ctx.ensureMetadataReady();
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
    const todayStart = startOfToday(this.ctx.now());
    const todayEnd = todayStart + 86_400_000;
    const summaryRows = includeSummary
      ? await this.ctx.metaQueryRows<DashboardSummaryRow>(
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
      ? await this.ctx.metaQueryRows<{ count: number | string }>(
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
      ? await this.ctx.metaQueryRows<DataTaskRow>(
          `
              SELECT
                t.id, t.name, t.status, t.group_id, t.node_count, t.source_path,
                t.source_dataset_id, t.output_table, t.row_count, t.column_count, t.error,
                t.scheduled_for, t.created_at, t.updated_at, t.last_run_at
              FROM data_cleaning_tasks t
              LEFT JOIN data_groups g ON g.id = t.group_id AND g.scope = 'task'
              WHERE $query = ''
                OR lower(t.name) LIKE $like ESCAPE '\\'
                OR lower(coalesce(t.source_path, '')) LIKE $like ESCAPE '\\'
              ORDER BY t.group_id IS NULL, g.sort_index, g.name,
                t.updated_at DESC, t.created_at DESC
              LIMIT ${taskWindow.limit} OFFSET ${taskWindow.offset}
            `,
          { query: normalizedQuery, like }
        )
      : [];
    const datasetCountRows = includeDatasets
      ? await this.ctx.metaQueryRows<{ count: number | string }>(
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
      ? await this.ctx.metaQueryRows<DataDatasetRow>(
          `
              WITH page AS (
                SELECT d.*
                FROM data_datasets d
                LEFT JOIN data_groups g ON g.id = d.group_id AND g.scope = 'input'
                WHERE ($query = ''
                  OR lower(d.name) LIKE $like ESCAPE '\\'
                  OR lower(d.source_path) LIKE $like ESCAPE '\\')
                  AND ${storedDatasetSourceKindSql('d')} <> 'output'
                  AND (
                    $sourceKind = ''
                    OR ${storedDatasetSourceKindSql('d')} = $sourceKind
                  )
                ORDER BY d.group_id IS NULL, g.sort_index, g.name,
                  d.updated_at DESC, d.created_at DESC
                LIMIT ${datasetWindow.limit} OFFSET ${datasetWindow.offset}
              )
              SELECT
                page.*,
                ${this.ctx.inputTableRelatedTaskNamesSql('page')} AS related_task_names
              FROM page
            `,
          { query: normalizedQuery, like, sourceKind: datasetSourceKind }
        )
      : [];
    const outputCountRows = includeOutputTables
      ? await this.ctx.metaQueryRows<{ count: number | string }>(
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
      ? await this.ctx.metaQueryRows<DataDatasetRow>(
          `
              SELECT
                d.*,
                ${this.ctx.outputTableRelatedTaskNamesSql('d')} AS related_task_names
              FROM data_datasets d
              LEFT JOIN data_groups g ON g.id = d.group_id AND g.scope = 'output'
              WHERE ($query = ''
                OR lower(d.name) LIKE $like ESCAPE '\\'
                OR lower(d.table_name) LIKE $like ESCAPE '\\')
                AND ${outputTableConfigPredicateSql('d')}
              ORDER BY d.group_id IS NULL, g.sort_index, g.name,
                d.updated_at DESC, d.created_at DESC
              LIMIT ${outputWindow.limit} OFFSET ${outputWindow.offset}
            `,
          { query: normalizedQuery, like }
        )
      : [];
    const groupRows = await this.ctx.metaQueryRows<DataGroupRow>(
      'SELECT * FROM data_groups ORDER BY scope, sort_index, created_at, name'
    );
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
      groups: groupRows.map(mapGroupRow),
      totalTasks: toNumber(taskCountRows[0]?.count),
      totalDatasets: toNumber(datasetCountRows[0]?.count),
      totalOutputTables: toNumber(outputCountRows[0]?.count),
    };
  }
}
