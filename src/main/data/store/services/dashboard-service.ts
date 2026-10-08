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
    const taskGroupIdSet = query.taskGroupId !== undefined ? 1 : 0;
    const taskGroupId = query.taskGroupId ?? null;
    const taskPerGroupLimit = query.taskPerGroupLimit ?? 0;
    const useGroupedTaskQuery = taskGroupIdSet === 1 || taskPerGroupLimit > 0;
    const taskRows = includeTasks
      ? useGroupedTaskQuery
        ? await this.ctx.metaQueryRows<DataTaskRow>(
            `
              WITH matched AS (
                SELECT
                  t.id, t.name, t.status, t.group_id, t.node_count, t.source_path,
                  t.source_dataset_id, t.output_table, t.row_count, t.column_count, t.error,
                  t.scheduled_for, t.created_at, t.updated_at, t.last_run_at,
                  g.sort_index, g.name AS group_name,
                  ROW_NUMBER() OVER (PARTITION BY t.group_id ORDER BY t.updated_at DESC, t.created_at DESC) AS group_rn
                FROM data_cleaning_tasks t
                LEFT JOIN data_groups g ON g.id = t.group_id AND g.scope = 'task'
                WHERE ($query = ''
                  OR lower(t.name) LIKE $like ESCAPE '\\'
                  OR lower(coalesce(t.source_path, '')) LIKE $like ESCAPE '\\')
                  AND ($taskGroupIdSet = 0 OR t.group_id IS NOT DISTINCT FROM $taskGroupId)
                ORDER BY t.group_id IS NULL, g.sort_index, g.name,
                  t.updated_at DESC, t.created_at DESC
              )
              SELECT
                id, name, status, group_id, node_count, source_path,
                source_dataset_id, output_table, row_count, column_count, error,
                scheduled_for, created_at, updated_at, last_run_at
              FROM matched
              WHERE $taskGroupIdSet = 1 OR ($taskPerGroupLimit > 0 AND group_rn <= $taskPerGroupLimit)
              LIMIT ${taskGroupIdSet ? taskWindow.limit : Number.MAX_SAFE_INTEGER} OFFSET ${taskGroupIdSet ? taskWindow.offset : 0}
            `,
            { query: normalizedQuery, like, taskGroupIdSet, taskGroupId, taskPerGroupLimit }
          )
        : await this.ctx.metaQueryRows<DataTaskRow>(
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
    const taskGroupCounts: Record<string, number> = {};
    if (includeTasks && useGroupedTaskQuery) {
      const taskCountRowsByGroup = await this.ctx.metaQueryRows<{
        group_id: string | null;
        count: number | string;
      }>(
        `
          SELECT t.group_id, count(*) AS count
          FROM data_cleaning_tasks t
          LEFT JOIN data_groups g ON g.id = t.group_id AND g.scope = 'task'
          WHERE ($query = ''
            OR lower(t.name) LIKE $like ESCAPE '\\'
            OR lower(coalesce(t.source_path, '')) LIKE $like ESCAPE '\\')
            AND ($taskGroupIdSet = 0 OR t.group_id IS NOT DISTINCT FROM $taskGroupId)
          GROUP BY t.group_id
        `,
        { query: normalizedQuery, like, taskGroupIdSet, taskGroupId }
      );
      for (const row of taskCountRowsByGroup) {
        const key = row.group_id ? `g:${row.group_id}` : 'ungrouped';
        taskGroupCounts[key] = toNumber(row.count);
      }
    }
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
    const datasetGroupIdSet = query.datasetGroupId !== undefined ? 1 : 0;
    const datasetGroupId = query.datasetGroupId ?? null;
    const datasetPerGroupLimit = query.datasetPerGroupLimit ?? 0;
    const useGroupedDatasetQuery = datasetGroupIdSet === 1 || datasetPerGroupLimit > 0;
    const datasetRows = includeDatasets
      ? useGroupedDatasetQuery
        ? await this.ctx.metaQueryRows<DataDatasetRow>(
            `
              WITH matched AS (
                SELECT d.*, g.sort_index, g.name AS group_name,
                  ROW_NUMBER() OVER (PARTITION BY d.group_id ORDER BY d.updated_at DESC, d.created_at DESC) AS group_rn
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
                  AND ($datasetGroupIdSet = 0 OR d.group_id IS NOT DISTINCT FROM $datasetGroupId)
                ORDER BY d.group_id IS NULL, g.sort_index, g.name,
                  d.updated_at DESC, d.created_at DESC
              )
              SELECT
                matched.*,
                ${this.ctx.inputTableRelatedTaskNamesSql('matched')} AS related_task_names
              FROM matched
              WHERE $datasetGroupIdSet = 1 OR ($datasetPerGroupLimit > 0 AND group_rn <= $datasetPerGroupLimit)
              LIMIT ${datasetGroupIdSet ? datasetWindow.limit : Number.MAX_SAFE_INTEGER} OFFSET ${datasetGroupIdSet ? datasetWindow.offset : 0}
            `,
            {
              query: normalizedQuery,
              like,
              sourceKind: datasetSourceKind,
              datasetGroupIdSet,
              datasetGroupId,
              datasetPerGroupLimit,
            }
          )
        : await this.ctx.metaQueryRows<DataDatasetRow>(
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
    const datasetGroupCounts: Record<string, number> = {};
    if (includeDatasets && useGroupedDatasetQuery) {
      const datasetCountRowsByGroup = await this.ctx.metaQueryRows<{
        group_id: string | null;
        count: number | string;
      }>(
        `
          SELECT d.group_id, count(*) AS count
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
            AND ($datasetGroupIdSet = 0 OR d.group_id IS NOT DISTINCT FROM $datasetGroupId)
          GROUP BY d.group_id
        `,
        {
          query: normalizedQuery,
          like,
          sourceKind: datasetSourceKind,
          datasetGroupIdSet,
          datasetGroupId,
        }
      );
      for (const row of datasetCountRowsByGroup) {
        const key = row.group_id ? `g:${row.group_id}` : 'ungrouped';
        datasetGroupCounts[key] = toNumber(row.count);
      }
    }
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
    const outputGroupIdSet = query.outputGroupId !== undefined ? 1 : 0;
    const outputGroupId = query.outputGroupId ?? null;
    const outputPerGroupLimit = query.outputPerGroupLimit ?? 0;
    const useGroupedOutputQuery = outputGroupIdSet === 1 || outputPerGroupLimit > 0;
    const outputRows = includeOutputTables
      ? useGroupedOutputQuery
        ? await this.ctx.metaQueryRows<DataDatasetRow>(
            `
              WITH matched AS (
                SELECT d.*, g.sort_index, g.name AS group_name,
                  ROW_NUMBER() OVER (PARTITION BY d.group_id ORDER BY d.updated_at DESC, d.created_at DESC) AS group_rn
                FROM data_datasets d
                LEFT JOIN data_groups g ON g.id = d.group_id AND g.scope = 'output'
                WHERE ($query = ''
                  OR lower(d.name) LIKE $like ESCAPE '\\'
                  OR lower(d.table_name) LIKE $like ESCAPE '\\')
                  AND ${outputTableConfigPredicateSql('d')}
                  AND ($outputGroupIdSet = 0 OR d.group_id IS NOT DISTINCT FROM $outputGroupId)
                ORDER BY d.group_id IS NULL, g.sort_index, g.name,
                  d.updated_at DESC, d.created_at DESC
              )
              SELECT
                matched.*,
                ${this.ctx.outputTableRelatedTaskNamesSql('matched')} AS related_task_names,
                ${this.ctx.outputTableRelatedTaskIdsSql('matched')} AS related_task_ids
              FROM matched
              WHERE $outputGroupIdSet = 1 OR ($outputPerGroupLimit > 0 AND group_rn <= $outputPerGroupLimit)
              LIMIT ${outputGroupIdSet ? outputWindow.limit : Number.MAX_SAFE_INTEGER} OFFSET ${outputGroupIdSet ? outputWindow.offset : 0}
            `,
            { query: normalizedQuery, like, outputGroupIdSet, outputGroupId, outputPerGroupLimit }
          )
        : await this.ctx.metaQueryRows<DataDatasetRow>(
            `
              SELECT
                d.*,
                ${this.ctx.outputTableRelatedTaskNamesSql('d')} AS related_task_names,
                ${this.ctx.outputTableRelatedTaskIdsSql('d')} AS related_task_ids
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
    const outputGroupCounts: Record<string, number> = {};
    if (includeOutputTables && useGroupedOutputQuery) {
      const outputCountRowsByGroup = await this.ctx.metaQueryRows<{
        group_id: string | null;
        count: number | string;
      }>(
        `
          SELECT d.group_id, count(*) AS count
          FROM data_datasets d
          LEFT JOIN data_groups g ON g.id = d.group_id AND g.scope = 'output'
          WHERE ($query = ''
            OR lower(d.name) LIKE $like ESCAPE '\\'
            OR lower(d.table_name) LIKE $like ESCAPE '\\')
            AND ${outputTableConfigPredicateSql('d')}
            AND ($outputGroupIdSet = 0 OR d.group_id IS NOT DISTINCT FROM $outputGroupId)
          GROUP BY d.group_id
        `,
        { query: normalizedQuery, like, outputGroupIdSet, outputGroupId }
      );
      for (const row of outputCountRowsByGroup) {
        const key = row.group_id ? `g:${row.group_id}` : 'ungrouped';
        outputGroupCounts[key] = toNumber(row.count);
      }
    }
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
      taskGroupCounts,
      datasetGroupCounts,
      outputGroupCounts,
    };
  }
}
