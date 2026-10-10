/** Dashboard aggregate reads. */
import type {
  DataDashboard,
  DataDashboardQuery,
  DataPipelineStatusCounts,
} from '../../../../shared/contracts';
import { toNumber, normalizeListWindow } from '../../operators';
import { DataStoreContext } from '../data-store-context';
import {
  DataRawTableRow,
  DataGroupRow,
  storedRawTableSourceKindSql,
  mapRawTableRow,
  mapGroupRow,
  mapResultTableRow,
  resultTableConfigPredicateSql,
  DataPipelineRow,
  mapPipelineRow,
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
    const includePipelines = query.includePipelines !== false;
    const includeRawTables = query.includeRawTables !== false;
    const includeResultTables = query.includeResultTables === true;
    const rawTableSourceKind =
      query.rawTableSourceKind && query.rawTableSourceKind !== 'all'
        ? query.rawTableSourceKind
        : '';
    const pipelineWindow = normalizeListWindow(query.pipelineOffset, query.pipelineLimit);
    const rawTableWindow = normalizeListWindow(query.rawTableOffset, query.rawTableLimit);
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
              FROM data_pipelines
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
    const pipelineCountRows = includePipelines
      ? await this.ctx.metaQueryRows<{ count: number | string }>(
          `
              SELECT count(*) AS count
              FROM data_pipelines
              WHERE $query = ''
                OR lower(name) LIKE $like ESCAPE '\\'
                OR lower(coalesce(source_path, '')) LIKE $like ESCAPE '\\'
            `,
          { query: normalizedQuery, like }
        )
      : [{ count: includeSummary ? summary.task_count : 0 }];
    const pipelineGroupIdSet = query.pipelineGroupId !== undefined ? 1 : 0;
    const pipelineGroupId = query.pipelineGroupId ?? null;
    const pipelinePerGroupLimit = query.pipelinePerGroupLimit ?? 0;
    const useGroupedPipelineQuery = pipelineGroupIdSet === 1 || pipelinePerGroupLimit > 0;
    const pipelineRows = includePipelines
      ? useGroupedPipelineQuery
        ? await this.ctx.metaQueryRows<DataPipelineRow>(
            `
              WITH matched AS (
                SELECT
                  t.id, t.name, t.status, t.group_id, t.node_count, t.source_path,
                  t.source_raw_table_id, t.result_table, t.row_count, t.column_count, t.error,
                  t.scheduled_for, t.created_at, t.updated_at, t.last_run_at,
                  g.sort_index, g.name AS group_name,
                  ROW_NUMBER() OVER (PARTITION BY t.group_id ORDER BY t.updated_at DESC, t.created_at DESC) AS group_rn
                FROM data_pipelines t
                LEFT JOIN data_groups g ON g.id = t.group_id AND g.scope = 'pipeline'
                WHERE ($query = ''
                  OR lower(t.name) LIKE $like ESCAPE '\\'
                  OR lower(coalesce(t.source_path, '')) LIKE $like ESCAPE '\\')
                  AND ($pipelineGroupIdSet = 0 OR t.group_id IS NOT DISTINCT FROM $pipelineGroupId)
                ORDER BY t.group_id IS NULL, g.sort_index, g.name,
                  t.updated_at DESC, t.created_at DESC
              )
              SELECT
                id, name, status, group_id, node_count, source_path,
                source_raw_table_id, result_table, row_count, column_count, error,
                scheduled_for, created_at, updated_at, last_run_at
              FROM matched
              WHERE $pipelineGroupIdSet = 1 OR ($pipelinePerGroupLimit > 0 AND group_rn <= $pipelinePerGroupLimit)
              LIMIT ${pipelineGroupIdSet ? pipelineWindow.limit : Number.MAX_SAFE_INTEGER} OFFSET ${pipelineGroupIdSet ? pipelineWindow.offset : 0}
            `,
            {
              query: normalizedQuery,
              like,
              pipelineGroupIdSet,
              pipelineGroupId,
              pipelinePerGroupLimit,
            }
          )
        : await this.ctx.metaQueryRows<DataPipelineRow>(
            `
              SELECT
                t.id, t.name, t.status, t.group_id, t.node_count, t.source_path,
                t.source_raw_table_id, t.result_table, t.row_count, t.column_count, t.error,
                t.scheduled_for, t.created_at, t.updated_at, t.last_run_at
              FROM data_pipelines t
              LEFT JOIN data_groups g ON g.id = t.group_id AND g.scope = 'pipeline'
              WHERE $query = ''
                OR lower(t.name) LIKE $like ESCAPE '\\'
                OR lower(coalesce(t.source_path, '')) LIKE $like ESCAPE '\\'
              ORDER BY t.group_id IS NULL, g.sort_index, g.name,
                t.updated_at DESC, t.created_at DESC
              LIMIT ${pipelineWindow.limit} OFFSET ${pipelineWindow.offset}
            `,
            { query: normalizedQuery, like }
          )
      : [];
    const pipelineGroupCounts: Record<string, number> = {};
    if (includePipelines && useGroupedPipelineQuery) {
      const pipelineCountRowsByGroup = await this.ctx.metaQueryRows<{
        group_id: string | null;
        count: number | string;
      }>(
        `
          SELECT t.group_id, count(*) AS count
          FROM data_pipelines t
          LEFT JOIN data_groups g ON g.id = t.group_id AND g.scope = 'pipeline'
          WHERE ($query = ''
            OR lower(t.name) LIKE $like ESCAPE '\\'
            OR lower(coalesce(t.source_path, '')) LIKE $like ESCAPE '\\')
            AND ($pipelineGroupIdSet = 0 OR t.group_id IS NOT DISTINCT FROM $pipelineGroupId)
          GROUP BY t.group_id
        `,
        { query: normalizedQuery, like, pipelineGroupIdSet, pipelineGroupId }
      );
      for (const row of pipelineCountRowsByGroup) {
        const key = row.group_id ? `g:${row.group_id}` : 'ungrouped';
        pipelineGroupCounts[key] = toNumber(row.count);
      }
    }
    const rawTableCountRows = includeRawTables
      ? await this.ctx.metaQueryRows<{ count: number | string }>(
          `
              SELECT count(*) AS count
              FROM data_raw_tables
              WHERE ($query = ''
                OR lower(name) LIKE $like ESCAPE '\\'
                OR lower(source_path) LIKE $like ESCAPE '\\')
                AND ${storedRawTableSourceKindSql()} <> 'output'
                AND (
                  $sourceKind = ''
                  OR ${storedRawTableSourceKindSql()} = $sourceKind
                )
            `,
          { query: normalizedQuery, like, sourceKind: rawTableSourceKind }
        )
      : [{ count: 0 }];
    const rawTableGroupIdSet = query.rawTableGroupId !== undefined ? 1 : 0;
    const rawTableGroupId = query.rawTableGroupId ?? null;
    const rawTablePerGroupLimit = query.rawTablePerGroupLimit ?? 0;
    const useGroupedRawTableQuery = rawTableGroupIdSet === 1 || rawTablePerGroupLimit > 0;
    const rawTableRows = includeRawTables
      ? useGroupedRawTableQuery
        ? await this.ctx.metaQueryRows<DataRawTableRow>(
            `
              WITH matched AS (
                SELECT d.*, g.sort_index, g.name AS group_name,
                  ROW_NUMBER() OVER (PARTITION BY d.group_id ORDER BY d.updated_at DESC, d.created_at DESC) AS group_rn
                FROM data_raw_tables d
                LEFT JOIN data_groups g ON g.id = d.group_id AND g.scope = 'input'
                WHERE ($query = ''
                  OR lower(d.name) LIKE $like ESCAPE '\\'
                  OR lower(d.source_path) LIKE $like ESCAPE '\\')
                  AND ${storedRawTableSourceKindSql('d')} <> 'output'
                  AND (
                    $sourceKind = ''
                    OR ${storedRawTableSourceKindSql('d')} = $sourceKind
                  )
                  AND ($rawTableGroupIdSet = 0 OR d.group_id IS NOT DISTINCT FROM $rawTableGroupId)
                ORDER BY d.group_id IS NULL, g.sort_index, g.name,
                  d.updated_at DESC, d.created_at DESC
              )
              SELECT
                matched.*,
                ${this.ctx.rawTableRelatedPipelineNamesSql('matched')} AS related_task_names
              FROM matched
              WHERE $rawTableGroupIdSet = 1 OR ($rawTablePerGroupLimit > 0 AND group_rn <= $rawTablePerGroupLimit)
              LIMIT ${rawTableGroupIdSet ? rawTableWindow.limit : Number.MAX_SAFE_INTEGER} OFFSET ${rawTableGroupIdSet ? rawTableWindow.offset : 0}
            `,
            {
              query: normalizedQuery,
              like,
              sourceKind: rawTableSourceKind,
              rawTableGroupIdSet,
              rawTableGroupId,
              rawTablePerGroupLimit,
            }
          )
        : await this.ctx.metaQueryRows<DataRawTableRow>(
            `
              WITH page AS (
                SELECT d.*
                FROM data_raw_tables d
                LEFT JOIN data_groups g ON g.id = d.group_id AND g.scope = 'input'
                WHERE ($query = ''
                  OR lower(d.name) LIKE $like ESCAPE '\\'
                  OR lower(d.source_path) LIKE $like ESCAPE '\\')
                  AND ${storedRawTableSourceKindSql('d')} <> 'output'
                  AND (
                    $sourceKind = ''
                    OR ${storedRawTableSourceKindSql('d')} = $sourceKind
                  )
                ORDER BY d.group_id IS NULL, g.sort_index, g.name,
                  d.updated_at DESC, d.created_at DESC
                LIMIT ${rawTableWindow.limit} OFFSET ${rawTableWindow.offset}
              )
              SELECT
                page.*,
                ${this.ctx.rawTableRelatedPipelineNamesSql('page')} AS related_task_names
              FROM page
            `,
            { query: normalizedQuery, like, sourceKind: rawTableSourceKind }
          )
      : [];
    const rawTableGroupCounts: Record<string, number> = {};
    if (includeRawTables && useGroupedRawTableQuery) {
      const rawTableCountRowsByGroup = await this.ctx.metaQueryRows<{
        group_id: string | null;
        count: number | string;
      }>(
        `
          SELECT d.group_id, count(*) AS count
          FROM data_raw_tables d
          LEFT JOIN data_groups g ON g.id = d.group_id AND g.scope = 'input'
          WHERE ($query = ''
            OR lower(d.name) LIKE $like ESCAPE '\\'
            OR lower(d.source_path) LIKE $like ESCAPE '\\')
            AND ${storedRawTableSourceKindSql('d')} <> 'output'
            AND (
              $sourceKind = ''
              OR ${storedRawTableSourceKindSql('d')} = $sourceKind
            )
            AND ($rawTableGroupIdSet = 0 OR d.group_id IS NOT DISTINCT FROM $rawTableGroupId)
          GROUP BY d.group_id
        `,
        {
          query: normalizedQuery,
          like,
          sourceKind: rawTableSourceKind,
          rawTableGroupIdSet,
          rawTableGroupId,
        }
      );
      for (const row of rawTableCountRowsByGroup) {
        const key = row.group_id ? `g:${row.group_id}` : 'ungrouped';
        rawTableGroupCounts[key] = toNumber(row.count);
      }
    }
    const outputCountRows = includeResultTables
      ? await this.ctx.metaQueryRows<{ count: number | string }>(
          `
              SELECT count(*) AS count
              FROM data_raw_tables
              WHERE ($query = ''
                OR lower(name) LIKE $like ESCAPE '\\'
                OR lower(table_name) LIKE $like ESCAPE '\\')
                AND ${resultTableConfigPredicateSql()}
            `,
          { query: normalizedQuery, like }
        )
      : [{ count: 0 }];
    const outputGroupIdSet = query.outputGroupId !== undefined ? 1 : 0;
    const outputGroupId = query.outputGroupId ?? null;
    const outputPerGroupLimit = query.outputPerGroupLimit ?? 0;
    const useGroupedOutputQuery = outputGroupIdSet === 1 || outputPerGroupLimit > 0;
    const outputRows = includeResultTables
      ? useGroupedOutputQuery
        ? await this.ctx.metaQueryRows<DataRawTableRow>(
            `
              WITH matched AS (
                SELECT d.*, g.sort_index, g.name AS group_name,
                  ROW_NUMBER() OVER (PARTITION BY d.group_id ORDER BY d.updated_at DESC, d.created_at DESC) AS group_rn
                FROM data_raw_tables d
                LEFT JOIN data_groups g ON g.id = d.group_id AND g.scope = 'output'
                WHERE ($query = ''
                  OR lower(d.name) LIKE $like ESCAPE '\\'
                  OR lower(d.table_name) LIKE $like ESCAPE '\\')
                  AND ${resultTableConfigPredicateSql('d')}
                  AND ($outputGroupIdSet = 0 OR d.group_id IS NOT DISTINCT FROM $outputGroupId)
                ORDER BY d.group_id IS NULL, g.sort_index, g.name,
                  d.updated_at DESC, d.created_at DESC
              )
              SELECT
                matched.*,
                ${this.ctx.resultTableRelatedPipelineNamesSql('matched')} AS related_task_names,
                ${this.ctx.resultTableRelatedPipelineIdsSql('matched')} AS related_pipeline_ids
              FROM matched
              WHERE $outputGroupIdSet = 1 OR ($outputPerGroupLimit > 0 AND group_rn <= $outputPerGroupLimit)
              LIMIT ${outputGroupIdSet ? outputWindow.limit : Number.MAX_SAFE_INTEGER} OFFSET ${outputGroupIdSet ? outputWindow.offset : 0}
            `,
            { query: normalizedQuery, like, outputGroupIdSet, outputGroupId, outputPerGroupLimit }
          )
        : await this.ctx.metaQueryRows<DataRawTableRow>(
            `
              SELECT
                d.*,
                ${this.ctx.resultTableRelatedPipelineNamesSql('d')} AS related_task_names,
                ${this.ctx.resultTableRelatedPipelineIdsSql('d')} AS related_pipeline_ids
              FROM data_raw_tables d
              LEFT JOIN data_groups g ON g.id = d.group_id AND g.scope = 'output'
              WHERE ($query = ''
                OR lower(d.name) LIKE $like ESCAPE '\\'
                OR lower(d.table_name) LIKE $like ESCAPE '\\')
                AND ${resultTableConfigPredicateSql('d')}
              ORDER BY d.group_id IS NULL, g.sort_index, g.name,
                d.updated_at DESC, d.created_at DESC
              LIMIT ${outputWindow.limit} OFFSET ${outputWindow.offset}
            `,
            { query: normalizedQuery, like }
          )
      : [];
    const outputGroupCounts: Record<string, number> = {};
    if (includeResultTables && useGroupedOutputQuery) {
      const outputCountRowsByGroup = await this.ctx.metaQueryRows<{
        group_id: string | null;
        count: number | string;
      }>(
        `
          SELECT d.group_id, count(*) AS count
          FROM data_raw_tables d
          LEFT JOIN data_groups g ON g.id = d.group_id AND g.scope = 'output'
          WHERE ($query = ''
            OR lower(d.name) LIKE $like ESCAPE '\\'
            OR lower(d.table_name) LIKE $like ESCAPE '\\')
            AND ${resultTableConfigPredicateSql('d')}
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
    const statusCounts: DataPipelineStatusCounts = {
      running: toNumber(summary.running_count),
      completed: toNumber(summary.completed_count),
      stopped: toNumber(summary.stopped_count),
      draft: toNumber(summary.draft_count),
      pending: toNumber(summary.pending_count),
      failed: toNumber(summary.failed_count),
    };

    return {
      summary: {
        pipelineCount: toNumber(summary.task_count),
        workflowNodeCount: toNumber(summary.workflow_node_count),
        runningCount: statusCounts.running,
        todayScheduleCount: toNumber(summary.today_schedule_count),
        statusCounts,
      },
      pipelines: pipelineRows.map(mapPipelineRow),
      rawTables: rawTableRows.map(mapRawTableRow),
      resultTables: outputRows.map(mapResultTableRow),
      groups: groupRows.map(mapGroupRow),
      totalPipelines: toNumber(pipelineCountRows[0]?.count),
      totalRawTables: toNumber(rawTableCountRows[0]?.count),
      totalResultTables: toNumber(outputCountRows[0]?.count),
      pipelineGroupCounts,
      rawTableGroupCounts,
      outputGroupCounts,
    };
  }
}
