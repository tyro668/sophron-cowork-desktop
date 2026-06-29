import * as fs from 'fs';
import * as os from 'os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import type Database from 'better-sqlite3';
import * as XLSX from 'xlsx';
import type { DatabaseInstance } from '../db/database';
import type {
  DataColumnTypeInfo,
  DataCleaningTask,
  DataCreateTaskInput,
  DataCreateOutputTableInput,
  DataDashboard,
  DataDashboardQuery,
  DataDataset,
  DataOutputTable,
  DataInputTableConfig,
  DataInputTableExcelMergedCellSummary,
  DataInputTableNormalizerArtifact,
  DataInputTableNormalizerArtifactVersion,
  DataInputTablePreview,
  DataInputTableSourceFileSummary,
  DataInputTableSourceSummary,
  DataInputTableCsvConfig,
  DataInputTableExcelConfig,
  DataInputTableFolderConfig,
  DataInputTableHeaderCandidate,
  DataInputTableNormalizerVersionSaveResult,
  DataInputTableSourceKind,
  DataImportDatasetInput,
  DataPreviewDatasetInput,
  DataPreviewInputTableInput,
  DataPreviewInputTableNormalizerVersionInput,
  DataPreviewWorkflowNodeInput,
  DataRunTaskInput,
  DataSaveInputTableNormalizerDraftInput,
  DataSummarizeInputTableSourceInput,
  DataTaskStatus,
  DataTaskStatusCounts,
  DataTaskWorkflow,
  DataNormalizerArtifactVersionStatus,
  DataNormalizerLanguage,
  DataUpdateTaskInput,
  DataUpdateDatasetInput,
  DataUpdateOutputTableInput,
  DataWorkflowEdge,
  DataWorkflowEdgeInput,
  DataWorkflowNode,
  DataWorkflowNodeInput,
  DataWorkflowOperatorType,
  DataWorkflowSaveInput,
} from '../../renderer/types';
import {
  dataFieldTypeFromDuckDbType,
  duckDbTypeForDataFieldType,
  type DataFieldType,
} from '../../shared/data-field-types';
import { runInputTableNormalizerProject } from './input-table-normalizer-runner';
import {
  compileFieldSelectSql,
  compileFieldMappingSql,
  compileMissingValueSql,
  compileTypeConvertSql,
  compileDeduplicateSql,
  compileSortSql,
  compileCalculateFieldSql,
  compileAggregateSql,
  compileLimitSql,
  compilePivotSql,
  compileUnpivotSql,
  compileUnnestSql,
  compileFilterConditionExpression,
  compileSetOpSql,
  compileJoinConditionList,
  compileJoinProjection,
  compileAsofJoinSql,
  quoteIdentifier,
  quoteValueIdentifier,
  stringArray,
  isRecord,
  compileTypedProjection,
  normalizeStatus,
  normalizeListWindow,
  toNumber,
  toFiniteNumber,
} from './operators';

interface DataTaskStoreOptions {
  now?: () => number;
  metadataDb?: DatabaseInstance;
}

const OUTPUT_TABLE_CONFIG_KIND = 'output_table';
const WORKFLOW_TEMP_CACHE_TTL_MS = 86_400_000;

interface ParsedWorkbookRows {
  columns: string[];
  rows: Array<Array<string | number | boolean | null>>;
  sheetName: string;
  sheetNames: string[];
}

interface PreparedInputTableNormalizerSourceContext {
  directory: string;
  files: PreparedInputTableNormalizerSourceFile[];
}

interface PreparedInputTableNormalizerSourceFile {
  path: string;
  relativePath: string;
  originalPath: string;
  originalKind: 'excel' | 'csv';
  delimiter: ',';
  sheetName?: string;
  headerCandidates?: DataInputTableHeaderCandidate[];
  rowCountEstimate?: number;
  columnCountEstimate?: number;
}

interface PreparedInputTableImport {
  rowCount: number;
  columnCount: number;
  fileCount: number;
  config: DataInputTableConfig;
}

export interface DataDatasetCsvExport {
  tableKind: 'input' | 'output';
  id: string;
  name: string;
  tableName: string;
  columns: string[];
  rowCount: number;
  columnCount: number;
  csv: string;
}

interface DataTaskRow {
  id: string;
  name: string;
  status: string;
  node_count: number | string;
  source_path: string | null;
  source_dataset_id: string | null;
  output_table: string | null;
  row_count: number | string | null;
  column_count: number | string | null;
  error: string | null;
  scheduled_for: number | string | null;
  created_at: number | string;
  updated_at: number | string;
  last_run_at: number | string | null;
}

interface DataDatasetRow {
  id: string;
  name: string;
  source_path: string;
  source_kind: string | null;
  config_json: string | null;
  file_count: number | string | null;
  related_task_names?: string | null;
  table_name: string;
  row_count: number | string;
  column_count: number | string;
  created_at: number | string;
  updated_at: number | string;
}

interface DataInputTableNormalizerArtifactRow {
  id: string;
  name: string;
  description: string | null;
  source_kind: string;
  primary_language: string;
  active_version_id: string | null;
  created_at: number | string;
  updated_at: number | string;
}

interface DataInputTableNormalizerArtifactVersionRow {
  id: string;
  artifact_id: string;
  version: number | string;
  status: string;
  files_json: string;
  file_tree_hash: string;
  rule_prompt: string;
  source_summary_hash: string | null;
  entrypoint_json: string;
  dependency_prepare_json: string | null;
  runtime_json: string;
  dependencies_json: string | null;
  dependency_lock_hash: string | null;
  created_at: number | string;
  updated_at: number | string;
  published_at: number | string | null;
}

interface DataWorkflowNodeRow {
  id: string;
  task_id: string;
  node_key: string;
  label: string;
  ordinal: number | string;
  operator_type: string | null;
  x: number | string | null;
  y: number | string | null;
  config_json: string | null;
  created_at: number | string;
  updated_at: number | string | null;
}

interface DataWorkflowEdgeRow {
  id: string;
  task_id: string;
  source_node_id: string;
  target_node_id: string;
  source_handle: string | null;
  target_handle: string | null;
  created_at: number | string;
}

interface DataWorkflowNodeCacheRow {
  id: string;
  task_id: string;
  node_id: string;
  node_type: string;
  table_name: string;
  cache_scope: string;
  expires_at: number | string | null;
  created_at: number | string;
  updated_at: number | string;
}

interface RuntimeWorkflow {
  nodes: DataWorkflowNode[];
  edges: DataWorkflowEdge[];
}

type WorkflowOutputMode = 'persisted' | 'temporary';
type WorkflowCacheScope = 'permanent' | 'temporary';

interface DashboardSummaryRow {
  task_count: number | string;
  workflow_node_count: number | string | null;
  running_count: number | string | null;
  today_schedule_count: number | string | null;
  draft_count: number | string | null;
  pending_count: number | string | null;
  completed_count: number | string | null;
  stopped_count: number | string | null;
  failed_count: number | string | null;
}

const WORKFLOW_OPERATOR_TYPES: readonly DataWorkflowOperatorType[] = [
  'input_source',
  'filter',
  'field_select',
  'deduplicate',
  'missing_value',
  'type_convert',
  'sort',
  'join',
  'aggregate',
  'calculate_field',
  'field_mapping',
  'limit',
  'pivot',
  'unpivot',
  'set_op',
  'unnest',
  'output',
];

const WORKFLOW_OPERATOR_TYPE_SET = new Set<string>(WORKFLOW_OPERATOR_TYPES);

const DEFAULT_OPERATOR_LABELS: Record<DataWorkflowOperatorType, string> = {
  input_source: '输入',
  filter: '筛选',
  field_select: '字段选择',
  deduplicate: '去重',
  missing_value: '缺失值处理',
  type_convert: '类型转换',
  sort: '排序',
  join: '表连接',
  aggregate: '聚合',
  calculate_field: '计算字段',
  field_mapping: '字段映射',
  limit: '限制行数',
  pivot: '透视',
  unpivot: '反透视',
  set_op: '集合操作',
  unnest: '嵌套展开',
  output: '输出',
};

const LEGACY_DEFAULT_WORKFLOW_NODES: ReadonlyArray<{
  key: string;
  type: DataWorkflowOperatorType;
  label: string;
  x: number;
  y: number;
  config: Record<string, unknown>;
}> = [
  {
    key: 'source',
    type: 'input_source',
    label: DEFAULT_OPERATOR_LABELS.input_source,
    x: 48,
    y: 128,
    config: { output: 'raw_dataset' },
  },
  {
    key: 'filter',
    type: 'filter',
    label: DEFAULT_OPERATOR_LABELS.filter,
    x: 190,
    y: 128,
    config: { condition: '' },
  },
  {
    key: 'deduplicate',
    type: 'deduplicate',
    label: DEFAULT_OPERATOR_LABELS.deduplicate,
    x: 332,
    y: 128,
    config: { strategy: 'all_columns' },
  },
  {
    key: 'missing',
    type: 'missing_value',
    label: DEFAULT_OPERATOR_LABELS.missing_value,
    x: 474,
    y: 128,
    config: {
      strategy: 'by_column',
      rules: [
        { column: 'user_id', ratio: '0.02%', method: 'skip' },
        { column: 'device_id', ratio: '1.15%', method: 'skip' },
        { column: 'event_time', ratio: '3.24%', method: 'forward_fill' },
        { column: 'event_type', ratio: '0.85%', method: 'mode_fill' },
        { column: 'page_id', ratio: '12.41%', method: 'drop' },
      ],
    },
  },
  {
    key: 'calculate',
    type: 'calculate_field',
    label: DEFAULT_OPERATOR_LABELS.calculate_field,
    x: 190,
    y: 270,
    config: { expression: '' },
  },
  {
    key: 'mapping',
    type: 'field_mapping',
    label: DEFAULT_OPERATOR_LABELS.field_mapping,
    x: 474,
    y: 270,
    config: { mappings: [] },
  },
  {
    key: 'output',
    type: 'output',
    label: DEFAULT_OPERATOR_LABELS.output,
    x: 474,
    y: 412,
    config: { destination: 'duckdb_table' },
  },
];

const LEGACY_DEMO_TASK_NAMES = [
  '用户行为数据清洗',
  '销售数据汇总',
  '营销数据集成',
  '日志数据处理',
  '第三方数据加载',
  '客户分群清洗',
  '订单异常值处理',
  '库存日报清洗',
];

export class DataTaskStore {
  private readonly dbPath: string;
  private readonly now: () => number;
  private readonly metadataDb: Database.Database | null;
  private instance: DuckDBInstance | null = null;
  private connection: DuckDBConnection | null = null;
  private metadataInitPromise: Promise<void> | null = null;
  private duckInitPromise: Promise<void> | null = null;

  constructor(dbPath: string, options: DataTaskStoreOptions = {}) {
    this.dbPath = dbPath;
    this.now = options.now ?? (() => Date.now());
    if (options.metadataDb) {
      this.metadataDb = options.metadataDb.raw;
    } else {
      this.metadataDb = null;
    }
  }

  private getInputTableNormalizerStorageRoot(): string {
    return join(dirname(this.dbPath), 'input-table-normalizers');
  }

  private getInputTableNormalizerProjectDir(artifactId: string, versionId: string): string {
    return join(
      this.getInputTableNormalizerStorageRoot(),
      'projects',
      sanitizeNormalizerPathSegment(artifactId),
      sanitizeNormalizerPathSegment(versionId)
    );
  }

  private getInputTableNormalizerRunRoot(): string {
    return join(this.getInputTableNormalizerStorageRoot(), 'runs');
  }

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

  async saveInputTableNormalizerDraft(
    input: DataSaveInputTableNormalizerDraftInput
  ): Promise<DataInputTableNormalizerVersionSaveResult> {
    await this.ensureMetadataReady();
    const name = input.name.trim();
    const rulePrompt = input.rulePrompt.trim();
    const files = input.files.filter(
      (file) => file.path.trim().length > 0 && file.content !== undefined
    );
    if (!name) {
      throw new Error('Normalizer artifact name is required');
    }
    if (!rulePrompt) {
      throw new Error('Normalizer rule prompt is required');
    }
    if (files.length === 0) {
      throw new Error('Normalizer project files are required');
    }
    if (!input.fileTreeHash.trim()) {
      throw new Error('Normalizer file tree hash is required');
    }

    const now = this.now();
    const artifactId = input.artifactId?.trim() || uuidv4();
    const existingArtifact = input.artifactId
      ? await this.getInputTableNormalizerArtifact(artifactId)
      : null;
    if (input.artifactId && !existingArtifact) {
      throw new Error(`Normalizer artifact not found: ${artifactId}`);
    }

    if (existingArtifact) {
      await this.metaRunSql(
        `
          UPDATE data_input_table_normalizer_artifacts
          SET name = $name,
              description = $description,
              source_kind = $sourceKind,
              primary_language = $primaryLanguage,
              updated_at = $updatedAt
          WHERE id = $id
        `,
        {
          id: artifactId,
          name,
          description: input.description ?? null,
          sourceKind: input.sourceKind,
          primaryLanguage: input.primaryLanguage,
          updatedAt: now,
        }
      );
    } else {
      await this.metaRunSql(
        `
          INSERT INTO data_input_table_normalizer_artifacts (
            id, name, description, source_kind, primary_language, active_version_id,
            created_at, updated_at
          )
          VALUES (
            $id, $name, $description, $sourceKind, $primaryLanguage, NULL,
            $createdAt, $updatedAt
          )
        `,
        {
          id: artifactId,
          name,
          description: input.description ?? null,
          sourceKind: input.sourceKind,
          primaryLanguage: input.primaryLanguage,
          createdAt: now,
          updatedAt: now,
        }
      );
    }

    const nextVersionRows = await this.metaQueryRows<{ version: number | string }>(
      `
        SELECT coalesce(max(version), 0) + 1 AS version
        FROM data_input_table_normalizer_artifact_versions
        WHERE artifact_id = $artifactId
      `,
      { artifactId }
    );
    const versionNumber = toNumber(nextVersionRows[0]?.version);
    const versionId = uuidv4();
    const projectDir = this.getInputTableNormalizerProjectDir(artifactId, versionId);
    try {
      writeInputTableNormalizerProjectFiles(projectDir, files);
      await this.metaRunSql(
        `
          INSERT INTO data_input_table_normalizer_artifact_versions (
            id, artifact_id, version, status, files_json, file_tree_hash, rule_prompt,
            source_summary_hash, entrypoint_json, dependency_prepare_json, runtime_json,
            dependencies_json, dependency_lock_hash, created_at, updated_at, published_at
          )
          VALUES (
            $id, $artifactId, $version, 'draft', $filesJson, $fileTreeHash, $rulePrompt,
            $sourceSummaryHash, $entrypointJson, $dependencyPrepareJson, $runtimeJson,
            $dependenciesJson, $dependencyLockHash, $createdAt, $updatedAt, NULL
          )
        `,
        {
          id: versionId,
          artifactId,
          version: versionNumber,
          filesJson: JSON.stringify(files),
          fileTreeHash: input.fileTreeHash.trim(),
          rulePrompt,
          sourceSummaryHash: input.sourceSummaryHash ?? null,
          entrypointJson: JSON.stringify(input.entrypoint),
          dependencyPrepareJson: input.dependencyPrepare
            ? JSON.stringify(input.dependencyPrepare)
            : null,
          runtimeJson: JSON.stringify(input.runtime),
          dependenciesJson: JSON.stringify(input.dependencies ?? []),
          dependencyLockHash: input.dependencyLockHash ?? null,
          createdAt: now,
          updatedAt: now,
        }
      );
    } catch (error) {
      fs.rmSync(projectDir, { recursive: true, force: true });
      throw error;
    }

    return {
      artifact: await this.requireInputTableNormalizerArtifact(artifactId),
      version: await this.requireInputTableNormalizerArtifactVersion(versionId),
    };
  }

  async publishInputTableNormalizerArtifactVersion(
    versionId: string
  ): Promise<DataInputTableNormalizerVersionSaveResult> {
    await this.ensureMetadataReady();
    const version = await this.requireInputTableNormalizerArtifactVersion(versionId);
    const artifact = await this.requireInputTableNormalizerArtifact(version.artifactId);
    const now = this.now();
    await this.metaRunSql(
      `
        UPDATE data_input_table_normalizer_artifact_versions
        SET status = 'archived',
            updated_at = $updatedAt
        WHERE artifact_id = $artifactId
          AND status = 'published'
          AND id <> $versionId
      `,
      { artifactId: artifact.id, versionId, updatedAt: now }
    );
    await this.metaRunSql(
      `
        UPDATE data_input_table_normalizer_artifact_versions
        SET status = 'published',
            published_at = coalesce(published_at, $publishedAt),
            updated_at = $updatedAt
        WHERE id = $versionId
      `,
      { versionId, publishedAt: now, updatedAt: now }
    );
    await this.metaRunSql(
      `
        UPDATE data_input_table_normalizer_artifacts
        SET active_version_id = $versionId,
            updated_at = $updatedAt
        WHERE id = $artifactId
      `,
      { artifactId: artifact.id, versionId, updatedAt: now }
    );
    return {
      artifact: await this.requireInputTableNormalizerArtifact(artifact.id),
      version: await this.requireInputTableNormalizerArtifactVersion(versionId),
    };
  }

  async deleteInputTableNormalizerArtifactVersion(
    versionId: string
  ): Promise<{ success: boolean }> {
    await this.ensureMetadataReady();
    const version = await this.requireInputTableNormalizerArtifactVersion(versionId);
    if (version.status === 'published') {
      throw new Error('Published normalizer versions cannot be deleted');
    }
    const now = this.now();
    await this.metaRunSql(
      `
        DELETE FROM data_input_table_normalizer_artifact_versions
        WHERE id = $versionId
      `,
      { versionId }
    );
    await this.metaRunSql(
      `
        UPDATE data_input_table_normalizer_artifacts
        SET updated_at = $updatedAt
        WHERE id = $artifactId
      `,
      { artifactId: version.artifactId, updatedAt: now }
    );
    fs.rmSync(this.getInputTableNormalizerProjectDir(version.artifactId, version.id), {
      recursive: true,
      force: true,
    });
    return { success: true };
  }

  async createTask(input: DataCreateTaskInput): Promise<DataCleaningTask> {
    await this.ensureMetadataReady();
    const name = input.name.trim();
    if (!name) {
      throw new Error('Task name is required');
    }
    const sourcePath = input.sourcePath ? normalizeSourcePath(input.sourcePath) : null;
    const sourceDatasetId = input.sourceDatasetId
      ? (await this.requireInputDataset(input.sourceDatasetId)).id
      : null;
    const outputTable = input.outputTableId
      ? (await this.requireOutputTable(input.outputTableId)).tableName
      : null;
    const now = this.now();
    const id = uuidv4();
    const status: DataTaskStatus = sourcePath || sourceDatasetId ? 'pending' : 'draft';
    await this.metaRunSql(
      `
        INSERT INTO data_cleaning_tasks (
          id, name, status, node_count, source_path, source_dataset_id, output_table,
          row_count, column_count, error, scheduled_for, created_at, updated_at, last_run_at
        )
        VALUES (
          $id, $name, $status, $nodeCount, $sourcePath, $sourceDatasetId, $outputTable,
          NULL, NULL, NULL, NULL, $createdAt, $updatedAt, NULL
        )
      `,
      {
        id,
        name,
        status,
        nodeCount: 0,
        sourcePath,
        sourceDatasetId,
        outputTable,
        createdAt: now,
        updatedAt: now,
      }
    );
    return this.requireTask(id);
  }

  async updateTask(input: DataUpdateTaskInput): Promise<DataCleaningTask> {
    await this.ensureMetadataReady();
    const task = await this.requireTask(input.id);
    const name = input.name?.trim();
    if (name !== undefined && !name) {
      throw new Error('Task name is required');
    }
    const updatedAt = this.now();
    await this.metaRunSql(
      `
        UPDATE data_cleaning_tasks
        SET name = $name,
            updated_at = $updatedAt
        WHERE id = $id
      `,
      {
        id: task.id,
        name: name ?? task.name,
        updatedAt,
      }
    );
    return this.requireTask(task.id);
  }

  async runTask(id: string, input: DataRunTaskInput = {}): Promise<DataCleaningTask> {
    await this.ensureReady();
    await this.cleanupExpiredWorkflowNodeCaches();
    const task = await this.requireTask(id);
    const sourcePath = input.sourcePath ? normalizeSourcePath(input.sourcePath) : task.sourcePath;
    const startedAt = this.now();
    const runtimeWorkflow = input.workflow
      ? normalizeRuntimeWorkflowInput(task.id, input.workflow, startedAt)
      : await this.getRuntimeWorkflow(task.id);
    const outputMode: WorkflowOutputMode =
      input.outputMode === 'temporary' ? 'temporary' : 'persisted';
    if (!sourcePath && workflowRequiresTaskSource(runtimeWorkflow.nodes)) {
      const message = 'Data source file is required before running a cleaning task';
      await this.metaRunSql(
        `
          UPDATE data_cleaning_tasks
          SET status = 'failed',
              error = $error,
              updated_at = $updatedAt,
              last_run_at = $lastRunAt
          WHERE id = $id
        `,
        { id, error: message, updatedAt: startedAt, lastRunAt: startedAt }
      );
      throw new Error(message);
    }
    await this.metaRunSql(
      `
        UPDATE data_cleaning_tasks
        SET status = 'running',
            source_path = $sourcePath,
            error = NULL,
            updated_at = $updatedAt
        WHERE id = $id
      `,
      { id, sourcePath, updatedAt: startedAt }
    );

    try {
      const result = await this.cleanSourceIntoTaskOutput(
        task,
        sourcePath,
        runtimeWorkflow,
        outputMode
      );
      const completedAt = this.now();
      const nodeCount = await this.countWorkflowNodes(id);
      await this.metaRunSql(
        `
          UPDATE data_cleaning_tasks
          SET status = 'completed',
              node_count = $nodeCount,
              source_path = $sourcePath,
              source_dataset_id = $sourceDatasetId,
              output_table = $outputTable,
              row_count = $rowCount,
              column_count = $columnCount,
              last_run_at = $lastRunAt,
              updated_at = $updatedAt,
              error = NULL
          WHERE id = $id
        `,
        {
          id,
          nodeCount,
          sourcePath,
          sourceDatasetId: result.sourceDatasetId,
          outputTable: result.outputTable,
          rowCount: result.rowCount,
          columnCount: result.columnCount,
          lastRunAt: completedAt,
          updatedAt: completedAt,
        }
      );
      return this.requireTask(id);
    } catch (error) {
      const failedAt = this.now();
      const message = error instanceof Error ? error.message : String(error);
      await this.metaRunSql(
        `
          UPDATE data_cleaning_tasks
          SET status = 'failed',
              error = $error,
              updated_at = $updatedAt,
              last_run_at = $lastRunAt
          WHERE id = $id
        `,
        { id, error: message, updatedAt: failedAt, lastRunAt: failedAt }
      );
      throw error;
    }
  }

  async importDataset(input: DataImportDatasetInput): Promise<DataDataset> {
    await this.ensureReady();
    const sourcePath = normalizeImportSourcePath(input.filePath);
    const id = uuidv4();
    const tableName = tableNameFromId('dataset', id);
    try {
      const sourceKind = normalizeInputTableSourceKind(input.sourceKind, sourcePath);
      const prepared = await this.createDatasetTableFromSource(
        tableName,
        sourcePath,
        sourceKind,
        input.config
      );
      const now = this.now();
      const name = input.name?.trim() || datasetNameFromPath(sourcePath);
      await this.metaRunSql(
        `
          INSERT INTO data_datasets (
            id, name, source_path, source_kind, config_json, file_count,
            table_name, row_count, column_count, created_at, updated_at
          )
          VALUES (
            $id, $name, $sourcePath, $sourceKind, $configJson, $fileCount,
            $tableName, $rowCount, $columnCount, $createdAt, $updatedAt
          )
        `,
        {
          id,
          name,
          sourcePath,
          sourceKind,
          configJson: JSON.stringify(prepared.config),
          fileCount: prepared.fileCount,
          tableName,
          rowCount: prepared.rowCount,
          columnCount: prepared.columnCount,
          createdAt: now,
          updatedAt: now,
        }
      );
      return this.requireDataset(id);
    } catch (error) {
      await this.dropTableIfExists(tableName);
      throw error;
    }
  }

  async summarizeInputTableSource(
    input: DataSummarizeInputTableSourceInput
  ): Promise<DataInputTableSourceSummary> {
    const sourcePath = normalizeImportSourcePath(input.sourcePath);
    const sourceKind = normalizeInputTableSourceKind(input.sourceKind, sourcePath);
    const config = normalizeInputTableConfig(input.config, sourceKind, sourcePath);
    const maxFiles = clampSummaryLimit(input.maxFiles, 1, 20, 8);
    const maxSheetsPerFile = clampSummaryLimit(input.maxSheetsPerFile, 1, 12, 6);
    const maxRowsPerSheet = clampSummaryLimit(input.maxRowsPerSheet, 1, 20, 8);
    const maxColumnsPerRow = clampSummaryLimit(input.maxColumnsPerRow, 1, 80, 16);
    const allFiles = getImportSourceFiles(sourcePath, sourceKind, config);
    const sampledFiles = allFiles.slice(0, maxFiles);
    const files = sampledFiles.map((filePath) =>
      summarizeInputTableFile(filePath, sourcePath, {
        maxSheetsPerFile,
        maxRowsPerSheet,
        maxColumnsPerRow,
      })
    );
    const notes: string[] = [];
    if (allFiles.length > sampledFiles.length) {
      notes.push(`Sampled ${sampledFiles.length} of ${allFiles.length} files.`);
    }
    for (const file of files) {
      if (file.warning) {
        notes.push(`${file.relativePath}: ${file.warning}`);
      }
    }
    const hashPayload = {
      sourcePath,
      sourceKind,
      fileCount: allFiles.length,
      files,
    };
    return {
      sourcePath,
      sourceKind,
      generatedAt: this.now(),
      hash: createStableJsonHash(hashPayload),
      fileCount: allFiles.length,
      sampledFileCount: files.length,
      truncated: allFiles.length > sampledFiles.length,
      notes,
      files,
    };
  }

  async updateDataset(input: DataUpdateDatasetInput): Promise<DataDataset> {
    await this.ensureMetadataReady();
    const dataset = await this.requireDataset(input.id);
    const name = input.name?.trim();
    const shouldReimport =
      Boolean(input.filePath) || Boolean(input.config) || Boolean(input.sourceKind);
    const sourcePath = input.filePath
      ? normalizeImportSourcePath(input.filePath)
      : shouldReimport
        ? dataset.sourcePath
        : null;

    if (!sourcePath) {
      if (name && name !== dataset.name) {
        await this.metaRunSql(
          `
            UPDATE data_datasets
            SET name = $name,
                updated_at = $updatedAt
            WHERE id = $id
          `,
          {
            id: dataset.id,
            name,
            updatedAt: this.now(),
          }
        );
      }
      return this.requireDataset(dataset.id);
    }

    const replacementTable = tableNameFromId('dataset_update', uuidv4());
    try {
      await this.ensureReady();
      const sourceKind = normalizeInputTableSourceKind(
        input.sourceKind ?? dataset.sourceKind,
        sourcePath
      );
      const prepared = await this.createDatasetTableFromSource(
        replacementTable,
        sourcePath,
        sourceKind,
        input.config ?? dataset.inputConfig
      );
      const now = this.now();
      await this.runSql('BEGIN TRANSACTION');
      try {
        await this.dropTableIfExists(dataset.tableName);
        await this.runSql(
          `ALTER TABLE ${quoteIdentifier(replacementTable)} RENAME TO ${quoteIdentifier(dataset.tableName)}`
        );
        await this.runSql('COMMIT');
        await this.metaRunSql(
          `
            UPDATE data_datasets
            SET name = $name,
                source_path = $sourcePath,
                source_kind = $sourceKind,
                config_json = $configJson,
                file_count = $fileCount,
                row_count = $rowCount,
                column_count = $columnCount,
                updated_at = $updatedAt
            WHERE id = $id
          `,
          {
            id: dataset.id,
            name: name || dataset.name,
            sourcePath,
            sourceKind,
            configJson: JSON.stringify(prepared.config),
            fileCount: prepared.fileCount,
            rowCount: prepared.rowCount,
            columnCount: prepared.columnCount,
            updatedAt: now,
          }
        );
      } catch (error) {
        await this.runSql('ROLLBACK').catch(() => undefined);
        throw error;
      }
      return this.requireDataset(dataset.id);
    } catch (error) {
      await this.dropTableIfExists(replacementTable).catch(() => undefined);
      throw error;
    }
  }

  async createOutputTable(input: DataCreateOutputTableInput = {}): Promise<DataOutputTable> {
    await this.ensureMetadataReady();
    return this.createOutputTableMetadata(input.name?.trim() || 'Output table', this.now());
  }

  private async createOutputTableMetadata(
    name: string,
    timestamp: number
  ): Promise<DataOutputTable> {
    const id = uuidv4();
    const tableName = tableNameFromId('output', id);
    await this.metaRunSql(
      `
        INSERT INTO data_datasets (
          id, name, source_path, source_kind, config_json, file_count,
          table_name, row_count, column_count, created_at, updated_at
        )
        VALUES (
          $id, $name, $sourcePath, 'output', $configJson, 0,
          $tableName, 0, 0, $createdAt, $updatedAt
        )
      `,
      {
        id,
        name,
        sourcePath: `duckdb://outputs/${tableName}`,
        configJson: outputTableConfigJson(),
        tableName,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
    );
    return this.requireOutputTable(id);
  }

  async updateOutputTable(input: DataUpdateOutputTableInput): Promise<DataOutputTable> {
    await this.ensureMetadataReady();
    const outputTable = await this.requireOutputTable(input.id);
    const name = input.name?.trim();
    const nextName = name && name !== outputTable.name ? name : null;
    const hasSourceDatasetChange =
      Object.prototype.hasOwnProperty.call(input, 'sourceDatasetId') &&
      (input.sourceDatasetId ?? null) !== outputTable.sourceDatasetId;

    if (!nextName && !hasSourceDatasetChange) {
      return outputTable;
    }

    if (hasSourceDatasetChange && input.sourceDatasetId) {
      const sourceDataset = await this.requireInputDataset(input.sourceDatasetId);
      await this.ensureReady();
      if (!(await this.physicalTableExists(sourceDataset.tableName))) {
        throw new Error(`Input table is not materialized: ${sourceDataset.id}`);
      }
      await this.dropTableIfExists(outputTable.tableName);
      await this.runSql(
        `CREATE TABLE ${quoteIdentifier(outputTable.tableName)} AS SELECT * FROM ${quoteIdentifier(
          sourceDataset.tableName
        )}`
      );
      const rowCount = await this.countRows(outputTable.tableName);
      const columnCount = (await this.getTableColumns(outputTable.tableName)).length;
      await this.metaRunSql(
        `
          UPDATE data_datasets
          SET name = coalesce($name, name),
              source_path = $sourcePath,
              source_kind = 'output',
              config_json = $configJson,
              file_count = 0,
              row_count = $rowCount,
              column_count = $columnCount,
              updated_at = $updatedAt
          WHERE id = $id
        `,
        {
          id: outputTable.id,
          name: nextName,
          sourcePath: `input-table://${sourceDataset.id}`,
          configJson: outputTableConfigJson(sourceDataset.id),
          rowCount,
          columnCount,
          updatedAt: this.now(),
        }
      );
      return this.requireOutputTable(input.id);
    }

    if (hasSourceDatasetChange) {
      await this.metaRunSql(
        `
          UPDATE data_datasets
          SET name = coalesce($name, name),
              source_path = $sourcePath,
              source_kind = 'output',
              config_json = $configJson,
              file_count = 0,
              updated_at = $updatedAt
          WHERE id = $id
        `,
        {
          id: outputTable.id,
          name: nextName,
          sourcePath: `duckdb://outputs/${outputTable.tableName}`,
          configJson: outputTableConfigJson(),
          updatedAt: this.now(),
        }
      );
      return this.requireOutputTable(input.id);
    }

    if (nextName) {
      await this.metaRunSql(
        `
          UPDATE data_datasets
          SET name = $name,
              updated_at = $updatedAt
          WHERE id = $id
        `,
        { id: outputTable.id, name: nextName, updatedAt: this.now() }
      );
    }
    return this.requireOutputTable(input.id);
  }

  async previewInputTable(input: DataPreviewInputTableInput): Promise<DataInputTablePreview> {
    await this.ensureReady();
    const sourcePath = normalizeImportSourcePath(input.filePath);
    const sourceKind = normalizeInputTableSourceKind(input.sourceKind, sourcePath);
    const config = normalizeInputTableConfig(input.config, sourceKind, sourcePath);
    const limit = normalizePreviewLimit(input.limit);
    const offset = normalizePreviewOffset(input.offset);
    if (config.dataProcessing?.strategy === 'customize') {
      return this.previewPublishedInputTableNormalizerVersion({
        sourcePath,
        sourceKind,
        config,
        limit,
        offset,
      });
    }
    const tempTables: string[] = [];
    let previewTable: string | null = null;
    try {
      const importFiles = getImportSourceFiles(sourcePath, sourceKind, config);
      const forceVarchar = sourceKind === 'folder';
      for (const [index, filePath] of importFiles.entries()) {
        const tempTable = tableNameFromId('dataset_preview', `${uuidv4()}_${index}`);
        tempTables.push(tempTable);
        await this.createImportTempTable(tempTable, filePath, index, forceVarchar, config);
        if (sourceKind === 'folder') {
          const folderConfig = config.sourceKind === 'folder' ? config : defaultFolderConfig();
          if (folderConfig.skipEmptyFiles && (await this.countRows(tempTable)) === 0) {
            await this.dropTableIfExists(tempTable);
            tempTables.pop();
            continue;
          }
          if (folderConfig.keepSourceFileName) {
            await this.appendSourceFileNameColumn(tempTable, filePath);
          }
        }
      }
      if (tempTables.length === 0) {
        throw new Error('No Excel or CSV files were found for the input table');
      }

      const unionSql = buildUnionSqlFromTempTables(tempTables);
      previewTable = tableNameFromId('dataset_preview_union', uuidv4());
      await this.runSql(`CREATE TEMP TABLE ${quoteIdentifier(previewTable)} AS ${unionSql}`);
      const countRows = await this.queryRows<{ count: number | string }>(
        `SELECT count(*) AS count FROM ${quoteIdentifier(previewTable)}`
      );
      const totalRows = toNumber(countRows[0]?.count);
      const rows = await this.queryRows<Record<string, unknown>>(
        `SELECT * FROM ${quoteIdentifier(previewTable)} LIMIT ${limit} OFFSET ${offset}`
      );
      const columns = await this.getTableColumns(previewTable);
      return {
        columns,
        columnTypes: await this.inferTableColumnTypes(previewTable),
        rows: rows.map(normalizePreviewRow),
        fileCount: tempTables.length,
        limit,
        offset,
        totalRows,
      };
    } finally {
      if (previewTable) {
        await this.dropTableIfExists(previewTable).catch(() => undefined);
      }
      for (const tempTable of tempTables) {
        await this.dropTableIfExists(tempTable).catch(() => undefined);
      }
    }
  }

  async previewInputTableNormalizerVersion(
    input: DataPreviewInputTableNormalizerVersionInput
  ): Promise<DataInputTablePreview> {
    await this.ensureReady();
    const version = await this.requireInputTableNormalizerArtifactVersion(input.versionId);
    const sourcePath = normalizeImportSourcePath(input.sourcePath);
    const sourceKind = normalizeInputTableSourceKind(input.sourceKind, sourcePath);
    const config = normalizeInputTableConfig(input.config, sourceKind, sourcePath);
    const summary = await this.summarizeInputTableSource({
      sourcePath,
      sourceKind,
      config,
    });
    const limit = normalizePreviewLimit(input.limit);
    const offset = normalizePreviewOffset(input.offset);
    const tempTable = tableNameFromId('normalizer_preview', uuidv4());
    let workDir: string | null = null;
    let cleanupWorkDir = true;
    let preparedSources: PreparedInputTableNormalizerSourceContext | null = null;
    try {
      preparedSources = prepareInputTableNormalizerSources({
        sourcePath,
        sourceKind,
        config,
        summary,
      });
      const result = await runInputTableNormalizerProject({
        version,
        prepareDependencies: input.prepareDependencies === true,
        projectRoot: this.getInputTableNormalizerProjectDir(version.artifactId, version.id),
        workspaceRoot: this.getInputTableNormalizerRunRoot(),
        context: {
          sourcePath,
          sourceKind,
          config,
          sourceSummary: summary,
          preparedSources,
        },
      });
      workDir = result.workDir;
      cleanupWorkDir = result.cleanupWorkDir;
      const relation = readNormalizerOutputRelationForPath(
        result.manifest.output,
        'normalizerOutputPath'
      );
      await this.runSql(
        `CREATE TEMP TABLE ${quoteIdentifier(tempTable)} AS SELECT * FROM ${relation}`,
        {
          normalizerOutputPath: result.manifest.output,
        }
      );
      const countRows = await this.queryRows<{ count: number | string }>(
        `SELECT count(*) AS count FROM ${quoteIdentifier(tempTable)}`
      );
      const rows = await this.queryRows<Record<string, unknown>>(
        `SELECT * FROM ${quoteIdentifier(tempTable)} LIMIT ${limit} OFFSET ${offset}`
      );
      return {
        columns: await this.getTableColumns(tempTable),
        columnTypes: await this.inferTableColumnTypes(tempTable),
        rows: rows.map(normalizePreviewRow),
        fileCount: summary.fileCount,
        limit,
        offset,
        totalRows: toNumber(countRows[0]?.count),
      };
    } finally {
      await this.dropTableIfExists(tempTable).catch(() => undefined);
      if (workDir && cleanupWorkDir) {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
      if (preparedSources) {
        fs.rmSync(preparedSources.directory, { recursive: true, force: true });
      }
    }
  }

  private async previewPublishedInputTableNormalizerVersion(input: {
    sourcePath: string;
    sourceKind: DataInputTableSourceKind;
    config: DataInputTableConfig;
    limit: number;
    offset: number;
  }): Promise<DataInputTablePreview> {
    const processing = input.config.dataProcessing;
    if (processing?.strategy !== 'customize' || !processing.artifactVersionId) {
      throw new Error('Published normalizer version is required for custom input table preview');
    }
    if (processing.artifactVersionStatus !== 'published') {
      throw new Error('Custom input table normalizer must be published before standard preview');
    }
    return this.previewInputTableNormalizerVersion({
      versionId: processing.artifactVersionId,
      sourcePath: input.sourcePath,
      sourceKind: input.sourceKind,
      config: input.config,
      prepareDependencies: false,
      limit: input.limit,
      offset: input.offset,
    });
  }

  async previewDataset(input: DataPreviewDatasetInput): Promise<DataInputTablePreview> {
    await this.ensureMetadataReady();
    const dataset = await this.requireDataset(input.id);
    await this.ensureReady();
    const limit = normalizePreviewLimit(input.limit);
    const offset = normalizePreviewOffset(input.offset);
    const tableName = quoteIdentifier(dataset.tableName);
    if (!(await this.physicalTableExists(dataset.tableName))) {
      return {
        columns: [],
        columnTypes: [],
        rows: [],
        fileCount: dataset.fileCount,
        limit,
        offset,
        totalRows: 0,
      };
    }
    const countRows = await this.queryRows<{ count: number | string }>(
      `SELECT count(*) AS count FROM ${tableName}`
    );
    const rows = await this.queryRows<Record<string, unknown>>(
      `SELECT * FROM ${tableName} LIMIT ${limit} OFFSET ${offset}`
    );
    return {
      columns: await this.getTableColumns(dataset.tableName),
      columnTypes: await this.getTableColumnTypes(dataset.tableName),
      rows: rows.map(normalizePreviewRow),
      fileCount: dataset.fileCount,
      limit,
      offset,
      totalRows: toNumber(countRows[0]?.count),
    };
  }

  async exportDatasetCsv(input: {
    tableKind: 'input' | 'output';
    id: string;
    maxRows?: number;
  }): Promise<DataDatasetCsvExport> {
    await this.ensureMetadataReady();
    const dataset =
      input.tableKind === 'output'
        ? await this.requireOutputTable(input.id)
        : await this.requireInputDataset(input.id);
    await this.ensureReady();
    if (!(await this.physicalTableExists(dataset.tableName))) {
      throw new Error(`Data table is not materialized: ${input.id}`);
    }

    const rowCount = await this.countRows(dataset.tableName);
    const maxRows = normalizeCsvExportMaxRows(input.maxRows);
    if (rowCount > maxRows) {
      throw new Error(`Data table has ${rowCount} rows, above export limit ${maxRows}`);
    }

    const columns = await this.getTableColumns(dataset.tableName);
    const rows = await this.queryRows<Record<string, unknown>>(
      `SELECT * FROM ${quoteIdentifier(dataset.tableName)}`
    );
    const csv = [
      columns.map(csvCell).join(','),
      ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
    ].join('\n');

    return {
      tableKind: input.tableKind,
      id: dataset.id,
      name: dataset.name,
      tableName: dataset.tableName,
      columns,
      rowCount,
      columnCount: columns.length,
      csv: `${csv}\n`,
    };
  }

  async previewWorkflowNode(input: DataPreviewWorkflowNodeInput): Promise<DataInputTablePreview> {
    await this.ensureMetadataReady();
    const task = await this.requireTask(input.taskId);
    await this.ensureReady();
    await this.cleanupExpiredWorkflowNodeCaches();
    const limit = normalizePreviewLimit(input.limit);
    const offset = normalizePreviewOffset(input.offset);
    const nodeConfig = input.nodeConfig ?? {};
    const tableName = await this.resolveWorkflowNodePreviewTable(task, {
      id: input.nodeId,
      taskId: task.id,
      type: input.nodeType,
      label: '',
      x: 0,
      y: 0,
      config: nodeConfig,
      createdAt: 0,
      updatedAt: 0,
    });

    if (!tableName || !(await this.physicalTableExists(tableName))) {
      return {
        columns: [],
        columnTypes: [],
        rows: [],
        fileCount: 0,
        limit,
        offset,
        totalRows: 0,
      };
    }

    const quotedTableName = quoteIdentifier(tableName);
    const countRows = await this.queryRows<{ count: number | string }>(
      `SELECT count(*) AS count FROM ${quotedTableName}`
    );
    const rows = await this.queryRows<Record<string, unknown>>(
      `SELECT * FROM ${quotedTableName} LIMIT ${limit} OFFSET ${offset}`
    );
    return {
      columns: await this.getTableColumns(tableName),
      columnTypes: await this.getTableColumnTypes(tableName),
      rows: rows.map(normalizePreviewRow),
      fileCount: 1,
      limit,
      offset,
      totalRows: toNumber(countRows[0]?.count),
    };
  }

  async getWorkflowNodeColumns(input: DataPreviewWorkflowNodeInput): Promise<string[]> {
    await this.ensureMetadataReady();
    const task = await this.requireTask(input.taskId);
    await this.ensureReady();
    await this.cleanupExpiredWorkflowNodeCaches();
    const nodeConfig = input.nodeConfig ?? {};
    const node: DataWorkflowNode = {
      id: input.nodeId,
      taskId: task.id,
      type: input.nodeType,
      label: '',
      x: 0,
      y: 0,
      config: nodeConfig,
      createdAt: 0,
      updatedAt: 0,
    };

    const inputSourceColumns = await this.resolveInputSourceColumns(node, task.sourcePath);
    if (inputSourceColumns) {
      return inputSourceColumns;
    }

    const tableName = await this.resolveWorkflowNodePreviewTable(task, node);

    if (!tableName || !(await this.physicalTableExists(tableName))) {
      return [];
    }

    return this.getTableColumns(tableName);
  }

  async getWorkflowNodeColumnTypes(
    input: DataPreviewWorkflowNodeInput
  ): Promise<DataColumnTypeInfo[]> {
    await this.ensureMetadataReady();
    const task = await this.requireTask(input.taskId);
    await this.ensureReady();
    await this.cleanupExpiredWorkflowNodeCaches();
    const nodeConfig = input.nodeConfig ?? {};
    const node: DataWorkflowNode = {
      id: input.nodeId,
      taskId: task.id,
      type: input.nodeType,
      label: '',
      x: 0,
      y: 0,
      config: nodeConfig,
      createdAt: 0,
      updatedAt: 0,
    };

    const tableName = await this.resolveWorkflowNodePreviewTable(task, node);
    if (!tableName || !(await this.physicalTableExists(tableName))) {
      return [];
    }

    return this.getTableColumnTypes(tableName);
  }

  private async getTableColumnTypes(tableName: string): Promise<DataColumnTypeInfo[]> {
    const rows = await this.queryRows<{ column_name: string; data_type: string }>(
      `
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = $tableName
        ORDER BY ordinal_position
      `,
      { tableName }
    );
    return rows.map((row) => ({
      name: String(row.column_name),
      type: dataFieldTypeFromDuckDbType(String(row.data_type)),
      storageType: String(row.data_type),
    }));
  }

  async getWorkflowNodeColumnValues(
    input: DataPreviewWorkflowNodeInput & { column: string }
  ): Promise<string[]> {
    await this.ensureMetadataReady();
    const task = await this.requireTask(input.taskId);
    await this.ensureReady();
    await this.cleanupExpiredWorkflowNodeCaches();
    const nodeConfig = input.nodeConfig ?? {};
    const node: DataWorkflowNode = {
      id: input.nodeId,
      taskId: task.id,
      type: input.nodeType,
      label: '',
      x: 0,
      y: 0,
      config: nodeConfig,
      createdAt: 0,
      updatedAt: 0,
    };

    const tableName = await this.resolveWorkflowNodePreviewTable(task, node);
    if (!tableName || !(await this.physicalTableExists(tableName))) {
      return [];
    }

    const colName = input.column.replace(/^\[|\]$/g, '');
    const quotedCol = quoteIdentifier(colName);
    const quotedTable = quoteIdentifier(tableName);
    const rows = await this.queryRows<{ val: string }>(
      `SELECT DISTINCT ${quotedCol} AS val FROM ${quotedTable} WHERE ${quotedCol} IS NOT NULL ORDER BY ${quotedCol} LIMIT 100`,
      {}
    );
    return rows.map((row) => (row.val === null ? '' : String(row.val))).filter((v) => v !== '');
  }

  async getWorkflowNodeRowCount(input: DataPreviewWorkflowNodeInput): Promise<number> {
    await this.ensureMetadataReady();
    const task = await this.requireTask(input.taskId);
    await this.ensureReady();
    await this.cleanupExpiredWorkflowNodeCaches();
    const nodeConfig = input.nodeConfig ?? {};
    const node: DataWorkflowNode = {
      id: input.nodeId,
      taskId: task.id,
      type: input.nodeType,
      label: '',
      x: 0,
      y: 0,
      config: nodeConfig,
      createdAt: 0,
      updatedAt: 0,
    };
    const tableName = await this.resolveWorkflowNodePreviewTable(task, node);
    if (!tableName || !(await this.physicalTableExists(tableName))) {
      return 0;
    }
    const quotedTable = quoteIdentifier(tableName);
    const rows = await this.queryRows<{ cnt: number }>(
      `SELECT count(*) AS cnt FROM ${quotedTable}`,
      {}
    );
    return rows[0]?.cnt ?? 0;
  }

  async deleteTask(id: string): Promise<boolean> {
    await this.ensureMetadataReady();
    const task = await this.getTask(id);
    if (!task) {
      return false;
    }
    if (task.outputTable) {
      await this.ensureReady();
      await this.dropTableIfExists(task.outputTable);
      await this.metaRunSql('DELETE FROM data_datasets WHERE table_name = $tableName', {
        tableName: task.outputTable,
      });
    }
    await this.deleteWorkflowNodeCachesForTask(id);
    await this.metaRunSql('DELETE FROM data_workflow_edges WHERE task_id = $id', { id });
    await this.metaRunSql('DELETE FROM data_workflow_nodes WHERE task_id = $id', { id });
    await this.metaRunSql('DELETE FROM data_cleaning_tasks WHERE id = $id', { id });
    return true;
  }

  async deleteDataset(id: string): Promise<boolean> {
    await this.ensureReady();
    const dataset = await this.getDataset(id);
    if (!dataset) {
      return false;
    }
    await this.dropTableIfExists(dataset.tableName);
    await this.metaRunSql('DELETE FROM data_datasets WHERE id = $id', { id });
    return true;
  }

  async getTaskWorkflow(id: string): Promise<DataTaskWorkflow> {
    await this.ensureMetadataReady();
    await this.requireTask(id);
    const nodes = await this.getWorkflowNodes(id);
    const edges = await this.getWorkflowEdges(id);
    return { task: await this.requireTask(id), nodes, edges };
  }

  async saveTaskWorkflow(id: string, input: DataWorkflowSaveInput): Promise<DataTaskWorkflow> {
    await this.ensureMetadataReady();
    await this.requireTask(id);
    const updatedAt = this.now();
    const scopedWorkflow = normalizeScopedWorkflowInputs(id, input);
    let nodes = scopedWorkflow.nodes;
    const edges = scopedWorkflow.edges;

    await this.metaRunSql('BEGIN TRANSACTION');
    try {
      nodes = await this.prepareWorkflowOutputNodesForSave(nodes, updatedAt);
      await this.metaRunSql('DELETE FROM data_workflow_edges WHERE task_id = $taskId', {
        taskId: id,
      });
      await this.metaRunSql('DELETE FROM data_workflow_nodes WHERE task_id = $taskId', {
        taskId: id,
      });
      for (const [index, node] of nodes.entries()) {
        await this.metaRunSql(
          `
            INSERT INTO data_workflow_nodes (
              id, task_id, node_key, label, ordinal, operator_type, x, y,
              config_json, created_at, updated_at
            )
            VALUES (
              $id, $taskId, $nodeKey, $label, $ordinal, $operatorType, $x, $y,
              $configJson, $createdAt, $updatedAt
            )
          `,
          {
            id: node.id,
            taskId: id,
            nodeKey: node.id,
            label: node.label,
            ordinal: index + 1,
            operatorType: node.type,
            x: node.x,
            y: node.y,
            configJson: JSON.stringify(node.config ?? {}),
            createdAt: updatedAt,
            updatedAt,
          }
        );
      }
      for (const edge of edges) {
        await this.metaRunSql(
          `
            INSERT INTO data_workflow_edges (
              id, task_id, source_node_id, target_node_id, source_handle, target_handle, created_at
            )
            VALUES (
              $id, $taskId, $sourceNodeId, $targetNodeId, $sourceHandle, $targetHandle, $createdAt
            )
          `,
          {
            id: edge.id,
            taskId: id,
            sourceNodeId: edge.sourceNodeId,
            targetNodeId: edge.targetNodeId,
            sourceHandle: edge.sourceHandle ?? null,
            targetHandle: edge.targetHandle ?? null,
            createdAt: updatedAt,
          }
        );
      }
      await this.metaRunSql(
        `
          UPDATE data_cleaning_tasks
          SET node_count = $nodeCount,
              updated_at = $updatedAt
          WHERE id = $taskId
        `,
        { taskId: id, nodeCount: nodes.length, updatedAt }
      );
      await this.metaRunSql('COMMIT');
    } catch (error) {
      await this.metaRunSql('ROLLBACK').catch(() => undefined);
      throw error;
    }

    return this.getTaskWorkflow(id);
  }

  async getTaskRecord(id: string): Promise<DataCleaningTask | null> {
    await this.ensureMetadataReady();
    return this.getTask(id);
  }

  async getInputTableRecord(id: string): Promise<DataDataset | null> {
    await this.ensureMetadataReady();
    try {
      return await this.requireInputDataset(id);
    } catch {
      return null;
    }
  }

  async getOutputTableRecord(id: string): Promise<DataOutputTable | null> {
    await this.ensureMetadataReady();
    await this.cleanupOutputTableMetadata();
    return this.getOutputTable(id);
  }

  private async prepareWorkflowOutputNodesForSave(
    nodes: DataWorkflowNodeInput[],
    updatedAt: number
  ): Promise<DataWorkflowNodeInput[]> {
    const preparedNodes: DataWorkflowNodeInput[] = [];
    for (const node of nodes) {
      if (node.type !== 'output') {
        preparedNodes.push(node);
        continue;
      }

      const config = { ...(node.config ?? {}) };
      const selectedOutputDatasetId =
        stringConfigValue(config.outputDatasetId) || stringConfigValue(config.outputTableId);
      const configuredStrategy = stringConfigValue(config.outputStrategy);
      const outputStrategy =
        configuredStrategy === 'auto' || configuredStrategy === 'existing'
          ? configuredStrategy
          : selectedOutputDatasetId
            ? 'existing'
            : '';

      if (outputStrategy === 'auto') {
        const outputName =
          stringConfigValue(config.outputTableName) || stringConfigValue(config.table);
        if (!outputName) {
          preparedNodes.push({
            ...node,
            config: {
              ...config,
              outputStrategy: 'auto',
              destination: 'duckdb_table',
              mode: stringConfigValue(config.mode) || 'replace',
            },
          });
          continue;
        }

        const outputTable = selectedOutputDatasetId
          ? await this.updateAutoOutputTableMetadata(selectedOutputDatasetId, outputName, updatedAt)
          : await this.createOutputTableMetadata(outputName, updatedAt);
        preparedNodes.push({
          ...node,
          config: {
            ...config,
            outputStrategy: 'existing',
            outputTableName: outputTable.name,
            outputDatasetId: outputTable.id,
            table: outputTable.tableName,
            destination: 'duckdb_table',
            mode: stringConfigValue(config.mode) || 'replace',
          },
        });
        continue;
      }

      if (selectedOutputDatasetId) {
        const outputTable = await this.requireOutputTable(selectedOutputDatasetId);
        preparedNodes.push({
          ...node,
          config: {
            ...config,
            outputStrategy: 'existing',
            outputTableName: outputTable.name,
            outputDatasetId: outputTable.id,
            table: outputTable.tableName,
            destination: 'duckdb_table',
            mode: stringConfigValue(config.mode) || 'replace',
          },
        });
        continue;
      }

      preparedNodes.push(node);
    }
    return preparedNodes;
  }

  private async updateAutoOutputTableMetadata(
    id: string,
    name: string,
    updatedAt: number
  ): Promise<DataOutputTable> {
    const outputTable = await this.getOutputTable(id);
    if (!outputTable) {
      return this.createOutputTableMetadata(name, updatedAt);
    }
    if (outputTable.name !== name) {
      await this.metaRunSql(
        `
          UPDATE data_datasets
          SET name = $name,
              updated_at = $updatedAt
          WHERE id = $id
        `,
        { id, name, updatedAt }
      );
    }
    return this.requireOutputTable(id);
  }

  close(): void {
    try {
      this.connection?.closeSync();
    } finally {
      this.connection = null;
      try {
        this.instance?.closeSync();
      } finally {
        this.instance = null;
        this.duckInitPromise = null;
        this.metadataInitPromise = null;
      }
    }
  }

  private async ensureMetadataReady(): Promise<void> {
    if (!this.metadataInitPromise) {
      this.metadataInitPromise = this.initializeMetadata();
    }
    await this.metadataInitPromise;
  }

  private async ensureReady(): Promise<void> {
    await this.ensureMetadataReady();
    await this.ensureDuckDbReady();
  }

  private async ensureDuckDbReady(): Promise<void> {
    if (this.connection) {
      return;
    }
    if (!this.duckInitPromise) {
      this.duckInitPromise = this.initializeDuckDb();
    }
    await this.duckInitPromise;
  }

  private async initializeDuckDb(): Promise<void> {
    fs.mkdirSync(dirname(this.dbPath), { recursive: true });
    this.instance = await DuckDBInstance.create(this.dbPath);
    this.connection = await this.instance.connect();
  }

  private async initializeMetadata(): Promise<void> {
    fs.mkdirSync(dirname(this.dbPath), { recursive: true });
    if (!this.metadataDb) {
      await this.ensureDuckDbReady();
    }
    await this.createSchema();
    await this.removeLegacyDemoRows();
    await this.removeLegacyDefaultWorkflowGraphs();
  }

  private async createSchema(): Promise<void> {
    await this.metaRunSql(`
      CREATE TABLE IF NOT EXISTS data_cleaning_tasks (
        id VARCHAR PRIMARY KEY,
        name VARCHAR NOT NULL,
        status VARCHAR NOT NULL,
        node_count INTEGER NOT NULL,
        source_path VARCHAR,
        source_dataset_id VARCHAR,
        output_table VARCHAR,
        row_count UBIGINT,
        column_count INTEGER,
        error VARCHAR,
        scheduled_for BIGINT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        last_run_at BIGINT
      )
    `);
    await this.metaRunSql(`
      CREATE TABLE IF NOT EXISTS data_datasets (
        id VARCHAR PRIMARY KEY,
        name VARCHAR NOT NULL,
        source_path VARCHAR NOT NULL,
        table_name VARCHAR NOT NULL,
        row_count UBIGINT NOT NULL,
        column_count INTEGER NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `);
    await this.ensureMetadataColumn('data_datasets', 'source_kind', 'VARCHAR');
    await this.ensureMetadataColumn('data_datasets', 'config_json', 'VARCHAR');
    await this.ensureMetadataColumn('data_datasets', 'file_count', 'INTEGER');
    await this.cleanupOutputTableMetadata();
    await this.metaRunSql(`
      CREATE TABLE IF NOT EXISTS data_input_table_normalizer_artifacts (
        id VARCHAR PRIMARY KEY,
        name VARCHAR NOT NULL,
        description VARCHAR,
        source_kind VARCHAR NOT NULL,
        primary_language VARCHAR NOT NULL,
        active_version_id VARCHAR,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `);
    await this.metaRunSql(`
      CREATE TABLE IF NOT EXISTS data_input_table_normalizer_artifact_versions (
        id VARCHAR PRIMARY KEY,
        artifact_id VARCHAR NOT NULL,
        version INTEGER NOT NULL,
        status VARCHAR NOT NULL,
        files_json VARCHAR NOT NULL,
        file_tree_hash VARCHAR NOT NULL,
        rule_prompt VARCHAR NOT NULL,
        source_summary_hash VARCHAR,
        entrypoint_json VARCHAR NOT NULL,
        dependency_prepare_json VARCHAR,
        runtime_json VARCHAR NOT NULL,
        dependencies_json VARCHAR,
        dependency_lock_hash VARCHAR,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        published_at BIGINT
      )
    `);
    await this.metaRunSql(`
      CREATE TABLE IF NOT EXISTS data_workflow_nodes (
        id VARCHAR PRIMARY KEY,
        task_id VARCHAR NOT NULL,
        node_key VARCHAR NOT NULL,
        label VARCHAR NOT NULL,
        ordinal INTEGER NOT NULL,
        created_at BIGINT NOT NULL
      )
    `);
    await this.ensureMetadataColumn('data_workflow_nodes', 'operator_type', 'VARCHAR');
    await this.ensureMetadataColumn('data_workflow_nodes', 'x', 'DOUBLE');
    await this.ensureMetadataColumn('data_workflow_nodes', 'y', 'DOUBLE');
    await this.ensureMetadataColumn('data_workflow_nodes', 'config_json', 'VARCHAR');
    await this.ensureMetadataColumn('data_workflow_nodes', 'updated_at', 'BIGINT');
    await this.metaRunSql(`
      CREATE TABLE IF NOT EXISTS data_workflow_edges (
        id VARCHAR PRIMARY KEY,
        task_id VARCHAR NOT NULL,
        source_node_id VARCHAR NOT NULL,
        target_node_id VARCHAR NOT NULL,
        source_handle VARCHAR,
        target_handle VARCHAR,
        created_at BIGINT NOT NULL
      )
    `);
    await this.metaRunSql(`
      CREATE TABLE IF NOT EXISTS data_workflow_node_caches (
        id VARCHAR PRIMARY KEY,
        task_id VARCHAR NOT NULL,
        node_id VARCHAR NOT NULL,
        node_type VARCHAR NOT NULL,
        table_name VARCHAR NOT NULL,
        cache_scope VARCHAR NOT NULL,
        expires_at BIGINT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `);
    await this.createMetadataIndexes();
    await this.metaRunSql(`
      UPDATE data_workflow_nodes
      SET operator_type = coalesce(operator_type, node_key),
          x = coalesce(x, 48 + (ordinal - 1) * 142),
          y = coalesce(y, 128),
          config_json = coalesce(config_json, '{}'),
          updated_at = coalesce(updated_at, created_at)
    `);
  }

  private async cleanupOutputTableMetadata(): Promise<void> {
    const rows = await this.metaQueryRows<DataDatasetRow>(
      `
        SELECT d.*
        FROM data_datasets d
        WHERE ${storedDatasetSourceKindSql('d')} = 'output'
          OR d.table_name IN (
            SELECT output_table
            FROM data_cleaning_tasks
            WHERE output_table IS NOT NULL
          )
      `
    );
    for (const row of rows) {
      const id = String(row.id);
      const config = parseOutputTableConfig(row.config_json);
      if (config.kind === OUTPUT_TABLE_CONFIG_KIND) {
        continue;
      }
      if (isLegacyExplicitOutputTableRow(row)) {
        await this.metaRunSql(
          `
            UPDATE data_datasets
            SET config_json = $configJson,
                file_count = coalesce(file_count, 0)
            WHERE id = $id
          `,
          {
            id,
            configJson: outputTableConfigJson(config.sourceDatasetId),
          }
        );
        continue;
      }
      await this.metaRunSql('DELETE FROM data_datasets WHERE id = $id', { id });
    }
  }

  private async ensureMetadataColumn(
    tableName: string,
    columnName: string,
    definition: string
  ): Promise<void> {
    if (this.metadataDb) {
      const rows = await this.metaQueryRows<{ name: string }>(
        `PRAGMA table_info(${quoteIdentifier(tableName)})`
      );
      if (!rows.some((row) => row.name === columnName)) {
        await this.metaRunSql(
          `ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(columnName)} ${definition}`
        );
      }
      return;
    }

    const rows = await this.queryRows<{ column_name: string }>(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = $tableName
          AND column_name = $columnName
        LIMIT 1
      `,
      { tableName, columnName }
    );
    if (rows.length === 0) {
      await this.metaRunSql(
        `ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(columnName)} ${definition}`
      );
    }
  }

  private async createMetadataIndexes(): Promise<void> {
    const indexStatements = [
      'CREATE INDEX IF NOT EXISTS idx_data_cleaning_tasks_updated_at ON data_cleaning_tasks(updated_at, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_data_cleaning_tasks_source_dataset_id ON data_cleaning_tasks(source_dataset_id)',
      'CREATE INDEX IF NOT EXISTS idx_data_cleaning_tasks_source_path ON data_cleaning_tasks(source_path)',
      'CREATE INDEX IF NOT EXISTS idx_data_datasets_updated_at ON data_datasets(updated_at, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_data_datasets_source_kind ON data_datasets(source_kind)',
      'CREATE INDEX IF NOT EXISTS idx_input_table_normalizer_artifacts_updated_at ON data_input_table_normalizer_artifacts(updated_at, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_input_table_normalizer_artifacts_source_kind ON data_input_table_normalizer_artifacts(source_kind)',
      'CREATE INDEX IF NOT EXISTS idx_input_table_normalizer_versions_artifact ON data_input_table_normalizer_artifact_versions(artifact_id, version)',
      'CREATE INDEX IF NOT EXISTS idx_input_table_normalizer_versions_status ON data_input_table_normalizer_artifact_versions(status, updated_at)',
      'CREATE INDEX IF NOT EXISTS idx_data_workflow_nodes_task_id ON data_workflow_nodes(task_id)',
      'CREATE INDEX IF NOT EXISTS idx_data_workflow_edges_task_id ON data_workflow_edges(task_id)',
      'CREATE INDEX IF NOT EXISTS idx_data_workflow_node_caches_task_node ON data_workflow_node_caches(task_id, node_id, updated_at)',
      'CREATE INDEX IF NOT EXISTS idx_data_workflow_node_caches_expires_at ON data_workflow_node_caches(expires_at)',
    ];
    for (const statement of indexStatements) {
      await this.metaRunSql(statement);
    }
  }

  private async removeLegacyDemoRows(): Promise<void> {
    const placeholders = LEGACY_DEMO_TASK_NAMES.map((_, index) => `$name${index}`).join(', ');
    const values = Object.fromEntries(
      LEGACY_DEMO_TASK_NAMES.map((name, index) => [`name${index}`, name])
    );
    const demoTaskRows = await this.metaQueryRows<{ id: string }>(
      `
        SELECT id
        FROM data_cleaning_tasks
        WHERE name IN (${placeholders})
          AND source_path IS NULL
          AND source_dataset_id IS NULL
          AND output_table IS NULL
          AND row_count IS NULL
          AND column_count IS NULL
          AND error IS NULL
          AND last_run_at IS NULL
      `,
      values
    );
    if (demoTaskRows.length > 0) {
      await this.metaRunSql(
        `
          DELETE FROM data_workflow_edges
          WHERE task_id IN (${demoTaskRows.map((_, index) => `$id${index}`).join(', ')})
        `,
        Object.fromEntries(demoTaskRows.map((row, index) => [`id${index}`, row.id]))
      );
      await this.metaRunSql(
        `
          DELETE FROM data_workflow_nodes
          WHERE task_id IN (${demoTaskRows.map((_, index) => `$id${index}`).join(', ')})
        `,
        Object.fromEntries(demoTaskRows.map((row, index) => [`id${index}`, row.id]))
      );
      await this.metaRunSql(
        `
          DELETE FROM data_cleaning_tasks
          WHERE id IN (${demoTaskRows.map((_, index) => `$id${index}`).join(', ')})
        `,
        Object.fromEntries(demoTaskRows.map((row, index) => [`id${index}`, row.id]))
      );
    }
    await this.metaRunSql("DELETE FROM data_datasets WHERE source_path LIKE 'local://samples/%'");
  }

  private async removeLegacyDefaultWorkflowGraphs(): Promise<void> {
    const workflowRows = await this.metaQueryRows<DataWorkflowNodeRow>(
      `
        SELECT *
        FROM data_workflow_nodes
        ORDER BY task_id ASC, ordinal ASC, created_at ASC
      `
    );
    const rowsByTask = new Map<string, DataWorkflowNodeRow[]>();
    for (const row of workflowRows) {
      const taskId = String(row.task_id);
      rowsByTask.set(taskId, [...(rowsByTask.get(taskId) ?? []), row]);
    }
    const taskIds = Array.from(rowsByTask.entries()).flatMap(([taskId, rows]) =>
      isLegacyDefaultWorkflow(rows) ? [taskId] : []
    );
    if (taskIds.length === 0) {
      return;
    }
    const placeholders = taskIds.map((_, index) => `$id${index}`).join(', ');
    const values = Object.fromEntries(taskIds.map((taskId, index) => [`id${index}`, taskId]));
    await this.metaRunSql(
      `
        DELETE FROM data_workflow_edges
        WHERE task_id IN (${placeholders})
      `,
      values
    );
    await this.metaRunSql(
      `
        DELETE FROM data_workflow_nodes
        WHERE task_id IN (${placeholders})
      `,
      values
    );
    await this.metaRunSql(
      `
        UPDATE data_cleaning_tasks
        SET node_count = 0
        WHERE id IN (${placeholders})
      `,
      values
    );
  }

  private async cleanSourceIntoTaskOutput(
    task: DataCleaningTask,
    sourcePath: string | null,
    workflow: RuntimeWorkflow,
    outputMode: WorkflowOutputMode
  ): Promise<{
    outputTable: string;
    rowCount: number;
    columnCount: number;
    sourceDatasetId: string | null;
  }> {
    if (workflow.nodes.length > 0) {
      return this.runWorkflowIntoTaskOutput(
        task,
        sourcePath,
        workflow.nodes,
        workflow.edges,
        outputMode
      );
    }

    if (!sourcePath) {
      throw new Error('Data source file is required before running a cleaning task');
    }

    const outputTable = task.outputTable || tableNameFromId('clean_task', task.id);
    const rawTable = tableNameFromId('raw_task', uuidv4());
    const relation = readRelationForPath(sourcePath, 'sourcePath');
    await this.dropTableIfExists(rawTable);
    await this.dropTableIfExists(outputTable);
    try {
      await this.runSql(
        `CREATE TEMP TABLE ${quoteIdentifier(rawTable)} AS SELECT * FROM ${relation}`,
        { sourcePath }
      );
      const columns = await this.getTableColumns(rawTable);
      const nonEmptyFilter =
        columns.length > 0
          ? columns.map((column) => `${quoteIdentifier(column)} IS NOT NULL`).join(' OR ')
          : 'true';
      await this.runSql(
        `
          CREATE TABLE ${quoteIdentifier(outputTable)} AS
          SELECT DISTINCT *
          FROM ${quoteIdentifier(rawTable)}
          WHERE ${nonEmptyFilter}
        `
      );
      const rowCount = await this.countRows(outputTable);
      const columnCount = (await this.getTableColumns(outputTable)).length;
      const dataset = await this.upsertDatasetForTaskOutput(
        task.name,
        sourcePath,
        outputTable,
        rowCount,
        columnCount
      );
      return {
        outputTable,
        rowCount,
        columnCount,
        sourceDatasetId: dataset?.id ?? task.sourceDatasetId,
      };
    } finally {
      await this.dropTableIfExists(rawTable);
    }
  }

  private async runWorkflowIntoTaskOutput(
    task: DataCleaningTask,
    sourcePath: string | null,
    nodes: DataWorkflowNode[],
    edges: DataWorkflowEdge[],
    outputMode: WorkflowOutputMode
  ): Promise<{
    outputTable: string;
    rowCount: number;
    columnCount: number;
    sourceDatasetId: string | null;
  }> {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const outputNode = nodes.find((node) => node.type === 'output');
    const outputTarget: { tableName: string; outputDatasetId?: string } =
      outputMode === 'temporary'
        ? { tableName: tableNameFromId('temp_task', `${task.id}_${uuidv4()}`) }
        : await this.resolveWorkflowOutputTarget(
            outputNode,
            task.outputTable || tableNameFromId('clean_task', task.id)
          );
    const outputTable = outputTarget.tableName;
    const relationByNode = new Map<string, string>();
    const visitingNodeIds = new Set<string>();
    const cacheScope: WorkflowCacheScope = outputMode === 'temporary' ? 'temporary' : 'permanent';
    const cacheRunId = uuidv4();
    const cacheExpiresAt =
      cacheScope === 'temporary' ? this.now() + WORKFLOW_TEMP_CACHE_TTL_MS : null;
    await this.dropTableIfExists(outputTable);

    const materializeNode = async (nodeId: string): Promise<string> => {
      const existingRelation = relationByNode.get(nodeId);
      if (existingRelation) return existingRelation;
      if (visitingNodeIds.has(nodeId)) {
        throw new Error(`Workflow contains a cycle at node: ${nodeId}`);
      }
      const node = nodeById.get(nodeId);
      if (!node) {
        throw new Error(`Workflow node not found: ${nodeId}`);
      }
      if (node.type === 'output') {
        const outputInputId = this.findIncomingNodeId(node.id, edges, 'input');
        if (!outputInputId) {
          throw new Error(`Output node has no input: ${node.id}`);
        }
        return materializeNode(outputInputId);
      }
      visitingNodeIds.add(nodeId);
      try {
        const outputRelation = this.getWorkflowNodeCacheTableName(
          task.id,
          node,
          cacheScope,
          cacheRunId
        );
        if (node.type === 'input_source') {
          const relation = await this.materializeInputSource(node, sourcePath, outputRelation);
          relationByNode.set(node.id, relation);
          await this.registerWorkflowNodeCache(node, relation, cacheScope, cacheExpiresAt);
          return relation;
        }

        if (node.config.disabled === true) {
          const passthroughNodeId =
            node.type === 'join'
              ? (this.findIncomingNodeId(node.id, edges, 'left') ??
                this.findIncomingNodeId(node.id, edges, 'input') ??
                this.findIncomingNodeId(node.id, edges, 'right'))
              : this.findIncomingNodeId(node.id, edges, 'input');
          if (!passthroughNodeId) {
            throw new Error(`Disabled workflow node has no passthrough input: ${node.id}`);
          }
          const relation = await materializeNode(passthroughNodeId);
          relationByNode.set(node.id, relation);
          return relation;
        }

        if (node.type === 'join') {
          const leftNodeId = this.findIncomingNodeId(node.id, edges, 'left');
          const rightNodeId = this.findIncomingNodeId(node.id, edges, 'right');
          if (!leftNodeId || !rightNodeId) {
            throw new Error(`Join node requires left and right inputs: ${node.id}`);
          }
          await materializeNode(leftNodeId);
          await materializeNode(rightNodeId);
        } else {
          const inputNodeId = this.findIncomingNodeId(node.id, edges, 'input');
          if (!inputNodeId) {
            throw new Error(`Workflow node has no input: ${node.id}`);
          }
          await materializeNode(inputNodeId);
        }

        await this.dropTableIfExists(outputRelation);
        const sql = await this.compileWorkflowNodeSql(node, outputRelation, relationByNode, edges);
        await this.runSql(toPersistentCreateTableSql(sql));
        relationByNode.set(node.id, outputRelation);
        await this.registerWorkflowNodeCache(node, outputRelation, cacheScope, cacheExpiresAt);
        return outputRelation;
      } finally {
        visitingNodeIds.delete(nodeId);
      }
    };

    const finalInputId = outputNode
      ? this.findIncomingNodeId(outputNode.id, edges, 'input')
      : findWorkflowTerminalNodeId(nodes, edges);
    if (!finalInputId) {
      throw new Error('Workflow has no materialized output relation');
    }
    const finalRelation = await materializeNode(finalInputId);
    await this.runSql(
      `CREATE TABLE ${quoteIdentifier(outputTable)} AS SELECT * FROM ${quoteIdentifier(finalRelation)}`
    );
    const rowCount = await this.countRows(outputTable);
    const columnCount = (await this.getTableColumns(outputTable)).length;
    if (outputNode) {
      await this.registerWorkflowNodeCache(outputNode, outputTable, cacheScope, cacheExpiresAt);
    }
    if (outputMode === 'temporary') {
      return { outputTable, rowCount, columnCount, sourceDatasetId: null };
    }
    const sourceDatasetId = (await this.findWorkflowSourceDatasetId(nodes)) ?? task.sourceDatasetId;
    const dataset = await this.upsertDatasetForTaskOutput(
      task.name,
      sourcePath,
      outputTable,
      rowCount,
      columnCount,
      outputTarget.outputDatasetId
    );
    void dataset;
    return { outputTable, rowCount, columnCount, sourceDatasetId };
  }

  private async findWorkflowSourceDatasetId(nodes: DataWorkflowNode[]): Promise<string | null> {
    for (const node of nodes) {
      if (node.type !== 'input_source' || node.config.disabled === true) {
        continue;
      }
      const source =
        typeof node.config.source === 'string'
          ? node.config.source
          : stringConfigValue(node.config.datasetId) ||
              stringConfigValue(node.config.inputTableId) ||
              stringConfigValue(node.config.sourceDatasetId)
            ? 'dataset'
            : 'task';
      if (source !== 'dataset') {
        continue;
      }

      const datasetRef =
        stringConfigValue(node.config.datasetId) ||
        stringConfigValue(node.config.inputTableId) ||
        stringConfigValue(node.config.sourceDatasetId);
      if (!datasetRef) {
        continue;
      }
      const dataset = await this.findDatasetByReference(datasetRef);
      if (dataset) {
        return dataset.id;
      }
    }
    return null;
  }

  private async resolveWorkflowOutputTarget(
    node: DataWorkflowNode | undefined,
    fallback: string
  ): Promise<{ tableName: string; outputDatasetId?: string }> {
    const outputDatasetId =
      stringConfigValue(node?.config.outputDatasetId) ||
      stringConfigValue(node?.config.outputTableId);
    if (outputDatasetId) {
      const outputTable = await this.requireOutputTable(outputDatasetId);
      return { tableName: outputTable.tableName, outputDatasetId: outputTable.id };
    }
    return { tableName: getOutputTableName(node, fallback) };
  }

  private async resolveWorkflowNodePreviewTable(
    task: DataCleaningTask,
    node: DataWorkflowNode
  ): Promise<string | null> {
    if (node.config.disabled === true) {
      return null;
    }
    const cachedTableName = await this.findWorkflowNodeCacheTable(task.id, node.id);
    if (cachedTableName) {
      return cachedTableName;
    }
    if (node.type === 'input_source') {
      return tableNameFromId('workflow_source', node.id);
    }
    if (node.type === 'output') {
      const outputDatasetId =
        stringConfigValue(node.config.outputDatasetId) ||
        stringConfigValue(node.config.outputTableId);
      if (outputDatasetId) {
        const outputTable = await this.getOutputTable(outputDatasetId);
        return outputTable?.tableName ?? null;
      }
      return (
        stringConfigValue(node.config.table) ||
        task.outputTable ||
        tableNameFromId('clean_task', task.id)
      );
    }
    return tableNameFromId(`workflow_${node.type}`, node.id);
  }

  private getWorkflowNodeCacheTableName(
    taskId: string,
    node: DataWorkflowNode,
    cacheScope: WorkflowCacheScope,
    cacheRunId: string
  ): string {
    const baseId =
      cacheScope === 'permanent' ? `${taskId}_${node.id}` : `${taskId}_${node.id}_${cacheRunId}`;
    return tableNameFromId(`workflow_cache_${cacheScope}_${node.type}`, baseId);
  }

  private async registerWorkflowNodeCache(
    node: DataWorkflowNode,
    tableName: string,
    cacheScope: WorkflowCacheScope,
    expiresAt: number | null
  ): Promise<void> {
    const timestamp = this.now();
    const id = tableNameFromId('cache', `${node.taskId}_${node.id}_${tableName}`);
    await this.metaRunSql(
      `
        DELETE FROM data_workflow_node_caches
        WHERE task_id = $taskId
          AND node_id = $nodeId
          AND table_name = $tableName
      `,
      { taskId: node.taskId, nodeId: node.id, tableName }
    );
    await this.metaRunSql(
      `
        INSERT INTO data_workflow_node_caches (
          id, task_id, node_id, node_type, table_name, cache_scope,
          expires_at, created_at, updated_at
        )
        VALUES (
          $id, $taskId, $nodeId, $nodeType, $tableName, $cacheScope,
          $expiresAt, $createdAt, $updatedAt
        )
      `,
      {
        id,
        taskId: node.taskId,
        nodeId: node.id,
        nodeType: node.type,
        tableName,
        cacheScope,
        expiresAt,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
    );
  }

  private async findWorkflowNodeCacheTable(taskId: string, nodeId: string): Promise<string | null> {
    const rows = await this.metaQueryRows<DataWorkflowNodeCacheRow>(
      `
        SELECT *
        FROM data_workflow_node_caches
        WHERE task_id = $taskId
          AND node_id = $nodeId
          AND (expires_at IS NULL OR expires_at > $now)
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 8
      `,
      { taskId, nodeId, now: this.now() }
    );
    for (const row of rows) {
      const tableName = String(row.table_name);
      if (await this.physicalTableExists(tableName)) {
        return tableName;
      }
      await this.metaRunSql('DELETE FROM data_workflow_node_caches WHERE id = $id', {
        id: String(row.id),
      });
    }
    return null;
  }

  private async cleanupExpiredWorkflowNodeCaches(): Promise<void> {
    const rows = await this.metaQueryRows<DataWorkflowNodeCacheRow>(
      `
        SELECT *
        FROM data_workflow_node_caches
        WHERE expires_at IS NOT NULL
          AND expires_at <= $now
      `,
      { now: this.now() }
    );
    for (const row of rows) {
      await this.dropTableIfExists(String(row.table_name)).catch(() => undefined);
      await this.metaRunSql('DELETE FROM data_workflow_node_caches WHERE id = $id', {
        id: String(row.id),
      });
    }
  }

  private async deleteWorkflowNodeCachesForTask(taskId: string): Promise<void> {
    const rows = await this.metaQueryRows<DataWorkflowNodeCacheRow>(
      'SELECT * FROM data_workflow_node_caches WHERE task_id = $taskId',
      { taskId }
    );
    for (const row of rows) {
      await this.dropTableIfExists(String(row.table_name)).catch(() => undefined);
    }
    await this.metaRunSql('DELETE FROM data_workflow_node_caches WHERE task_id = $taskId', {
      taskId,
    });
  }

  private async resolveInputSourceColumns(
    node: DataWorkflowNode,
    taskSourcePath: string | null
  ): Promise<string[] | null> {
    if (node.type !== 'input_source' || node.config.disabled === true) {
      return null;
    }

    const source =
      typeof node.config.source === 'string'
        ? node.config.source
        : stringConfigValue(node.config.datasetId)
          ? 'dataset'
          : 'task';
    const cachedTable = await this.findWorkflowNodeCacheTable(node.taskId, node.id);
    if (cachedTable) {
      return this.getTableColumns(cachedTable);
    }

    if (source === 'dataset') {
      const datasetRef = String(
        node.config.datasetId ?? node.config.name ?? node.config.alias ?? ''
      );
      const dataset = await this.findDatasetByReference(datasetRef);
      if (!dataset || !(await this.physicalTableExists(dataset.tableName))) {
        return [];
      }
      return this.getTableColumns(dataset.tableName);
    }

    const cachedTableName = tableNameFromId('workflow_source', node.id);
    if (await this.physicalTableExists(cachedTableName)) {
      return this.getTableColumns(cachedTableName);
    }

    const filePath =
      source === 'file' && typeof node.config.filePath === 'string'
        ? normalizeSourcePath(node.config.filePath)
        : taskSourcePath;
    if (!filePath) {
      return [];
    }

    const schemaTableName = tableNameFromId('workflow_schema', node.id);
    await this.dropTableIfExists(schemaTableName);
    try {
      const relation = readRelationForPath(filePath, 'sourcePath');
      await this.runSql(
        `CREATE TEMP TABLE ${quoteIdentifier(schemaTableName)} AS SELECT * FROM ${relation} LIMIT 0`,
        { sourcePath: filePath }
      );
      return this.getTableColumns(schemaTableName);
    } finally {
      await this.dropTableIfExists(schemaTableName).catch(() => undefined);
    }
  }

  private async materializeInputSource(
    node: DataWorkflowNode,
    taskSourcePath: string | null,
    tableName: string
  ): Promise<string> {
    const source =
      typeof node.config.source === 'string'
        ? node.config.source
        : stringConfigValue(node.config.datasetId)
          ? 'dataset'
          : 'task';
    await this.dropTableIfExists(tableName);
    if (source === 'dataset') {
      const datasetRef = String(
        node.config.datasetId ?? node.config.name ?? node.config.alias ?? ''
      );
      const dataset = await this.findDatasetByReference(datasetRef);
      if (!dataset) {
        throw new Error(`Dataset source not found: ${datasetRef}`);
      }
      await this.runSql(
        `CREATE TABLE ${quoteIdentifier(tableName)} AS SELECT * FROM ${quoteIdentifier(
          dataset.tableName
        )}`
      );
      return tableName;
    }

    const filePath =
      source === 'file' && typeof node.config.filePath === 'string'
        ? normalizeSourcePath(node.config.filePath)
        : taskSourcePath;
    if (!filePath) {
      throw new Error('Data source file is required before running a cleaning task');
    }
    const relation = readRelationForPath(filePath, 'sourcePath');
    await this.runSql(`CREATE TABLE ${quoteIdentifier(tableName)} AS SELECT * FROM ${relation}`, {
      sourcePath: filePath,
    });
    return tableName;
  }

  private async compileWorkflowNodeSql(
    node: DataWorkflowNode,
    outputRelation: string,
    relationByNode: Map<string, string>,
    edges: DataWorkflowEdge[]
  ): Promise<string> {
    if (node.type === 'join') {
      return this.compileJoinSql(node, outputRelation, relationByNode, edges);
    }
    if (node.type === 'set_op') {
      return this.compileSetOpSql(node, outputRelation, relationByNode, edges);
    }
    const inputId = this.findIncomingNodeId(node.id, edges, 'input');
    const inputRelation = inputId ? relationByNode.get(inputId) : null;
    if (!inputRelation) {
      throw new Error(`Workflow node has no input: ${node.id}`);
    }
    const columns = await this.getTableColumns(inputRelation);
    const input = quoteIdentifier(inputRelation);
    const output = quoteIdentifier(outputRelation);
    switch (node.type) {
      case 'field_select':
        return compileFieldSelectSql(output, input, columns, node.config);
      case 'field_mapping':
        return compileFieldMappingSql(output, input, columns, node.config);
      case 'missing_value':
        return compileMissingValueSql(output, input, columns, node.config);
      case 'type_convert':
        return compileTypeConvertSql(output, input, columns, node.config);
      case 'filter':
        return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${input} WHERE ${compileFilterConditionExpression(
          String(node.config.condition ?? 'true')
        )}`;
      case 'deduplicate':
        return compileDeduplicateSql(output, input, columns, node.config);
      case 'sort':
        return compileSortSql(output, input, node.config);
      case 'calculate_field':
        return compileCalculateFieldSql(output, input, node.config);
      case 'aggregate':
        return compileAggregateSql(output, input, node.config);
      case 'limit':
        return compileLimitSql(output, input, columns, node.config);
      case 'pivot':
        return compilePivotSql(output, input, node.config);
      case 'unpivot':
        return compileUnpivotSql(output, input, columns, node.config);
      case 'unnest':
        return compileUnnestSql(output, input, node.config);
      default:
        return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${input}`;
    }
  }

  private async compileSetOpSql(
    node: DataWorkflowNode,
    outputRelation: string,
    relationByNode: Map<string, string>,
    edges: DataWorkflowEdge[]
  ): Promise<string> {
    const leftNodeId = this.findIncomingNodeId(node.id, edges, 'left');
    const rightNodeId = this.findIncomingNodeId(node.id, edges, 'right');
    const leftRelation = leftNodeId ? relationByNode.get(leftNodeId) : null;
    const rightRelation = rightNodeId ? relationByNode.get(rightNodeId) : null;
    if (!leftRelation || !rightRelation) {
      throw new Error(`Set operation node requires left and right inputs: ${node.id}`);
    }
    return compileSetOpSql(
      quoteIdentifier(outputRelation),
      quoteIdentifier(leftRelation),
      quoteIdentifier(rightRelation),
      node.config
    );
  }

  private async compileJoinSql(
    node: DataWorkflowNode,
    outputRelation: string,
    relationByNode: Map<string, string>,
    edges: DataWorkflowEdge[]
  ): Promise<string> {
    const leftNodeId = this.findIncomingNodeId(node.id, edges, 'left');
    const rightNodeId = this.findIncomingNodeId(node.id, edges, 'right');
    const leftRelation = leftNodeId ? relationByNode.get(leftNodeId) : null;
    const rightRelation = rightNodeId ? relationByNode.get(rightNodeId) : null;
    if (!leftRelation || !rightRelation) {
      throw new Error(`Join node requires left and right inputs: ${node.id}`);
    }
    const leftColumns = await this.getTableColumns(leftRelation);
    const rightColumns = await this.getTableColumns(rightRelation);
    const output = quoteIdentifier(outputRelation);
    const left = quoteIdentifier(leftRelation);
    const right = quoteIdentifier(rightRelation);
    const joinType = String(node.config.joinType ?? 'left');
    if (joinType === 'semi' || joinType === 'anti') {
      const existsOperator = joinType === 'semi' ? 'EXISTS' : 'NOT EXISTS';
      const condition = compileJoinConditionList(node.config.conditions);
      return `
        CREATE TEMP TABLE ${output} AS
        SELECT l.*
        FROM ${left} l
        WHERE ${existsOperator} (
          SELECT 1 FROM ${right} r WHERE ${condition}
        )
      `;
    }
    if (joinType === 'asof') {
      return compileAsofJoinSql(output, left, right, leftColumns, rightColumns, node.config);
    }
    const condition =
      joinType === 'cross' ? '' : ` ON ${compileJoinConditionList(node.config.conditions)}`;
    const sqlJoinType = joinType === 'full' ? 'FULL OUTER' : joinType.toUpperCase();
    const projection = compileJoinProjection(
      node.config.keep,
      leftColumns,
      rightColumns,
      node.config.conflict,
      typeof node.config.rightAlias === 'string' ? node.config.rightAlias : undefined
    );
    return `
      CREATE TEMP TABLE ${output} AS
      SELECT ${projection}
      FROM ${left} l
      ${sqlJoinType} JOIN ${right} r${condition}
    `;
  }

  private findIncomingNodeId(
    nodeId: string,
    edges: DataWorkflowEdge[],
    targetHandle: string
  ): string | null {
    return (
      edges.find(
        (edge) => edge.targetNodeId === nodeId && (edge.targetHandle ?? 'input') === targetHandle
      )?.sourceNodeId ?? null
    );
  }

  private async findDatasetByReference(reference: string): Promise<DataDataset | null> {
    const rows = await this.metaQueryRows<DataDatasetRow>(
      `
        SELECT *
        FROM data_datasets
        WHERE id = $reference
           OR name = $reference
           OR table_name = $reference
        LIMIT 1
      `,
      { reference }
    );
    return rows[0] ? mapDatasetRow(rows[0]) : null;
  }

  private async upsertDatasetForTaskOutput(
    taskName: string,
    sourcePath: string | null,
    tableName: string,
    rowCount: number,
    columnCount: number,
    outputDatasetId?: string
  ): Promise<DataDataset | null> {
    if (outputDatasetId) {
      const now = this.now();
      await this.metaRunSql(
        `
          UPDATE data_datasets
          SET source_path = $sourcePath,
              source_kind = 'output',
              config_json = $configJson,
              file_count = 0,
              table_name = $tableName,
              row_count = $rowCount,
              column_count = $columnCount,
              updated_at = $updatedAt
          WHERE id = $id
        `,
        {
          id: outputDatasetId,
          sourcePath: `duckdb://outputs/${tableName}`,
          configJson: outputTableConfigJson(),
          tableName,
          rowCount,
          columnCount,
          updatedAt: now,
        }
      );
      return this.requireDataset(outputDatasetId);
    }

    await this.metaRunSql(
      `
        DELETE FROM data_datasets
        WHERE table_name = $tableName
          AND ${storedDatasetSourceKindSql()} = 'output'
          AND coalesce(config_json, '') NOT LIKE '%"kind":"${OUTPUT_TABLE_CONFIG_KIND}"%'
      `,
      { tableName }
    );
    void taskName;
    void sourcePath;
    return null;
  }

  private async getWorkflowNodes(taskId: string): Promise<DataWorkflowNode[]> {
    const rows = await this.metaQueryRows<DataWorkflowNodeRow>(
      `
        SELECT *
        FROM data_workflow_nodes
        WHERE task_id = $taskId
        ORDER BY ordinal ASC, created_at ASC
      `,
      { taskId }
    );
    return rows.map(mapWorkflowNodeRow);
  }

  private async getWorkflowEdges(taskId: string): Promise<DataWorkflowEdge[]> {
    const rows = await this.metaQueryRows<DataWorkflowEdgeRow>(
      `
        SELECT *
        FROM data_workflow_edges
        WHERE task_id = $taskId
        ORDER BY created_at ASC
      `,
      { taskId }
    );
    return rows.map(mapWorkflowEdgeRow);
  }

  private async getRuntimeWorkflow(taskId: string): Promise<RuntimeWorkflow> {
    const nodes = await this.getWorkflowNodes(taskId);
    const edges = nodes.length > 0 ? await this.getWorkflowEdges(taskId) : [];
    return { nodes, edges };
  }

  private async countWorkflowNodes(taskId: string): Promise<number> {
    const rows = await this.metaQueryRows<{ count: number | string }>(
      'SELECT count(*) AS count FROM data_workflow_nodes WHERE task_id = $taskId',
      { taskId }
    );
    return toNumber(rows[0]?.count);
  }

  private async getTask(id: string): Promise<DataCleaningTask | null> {
    const rows = await this.metaQueryRows<DataTaskRow>(
      'SELECT * FROM data_cleaning_tasks WHERE id = $id LIMIT 1',
      { id }
    );
    return rows[0] ? mapTaskRow(rows[0]) : null;
  }

  private async requireTask(id: string): Promise<DataCleaningTask> {
    const task = await this.getTask(id);
    if (!task) {
      throw new Error(`Data cleaning task not found: ${id}`);
    }
    return task;
  }

  private async getDataset(id: string): Promise<DataDataset | null> {
    const rows = await this.metaQueryRows<DataDatasetRow>(
      'SELECT * FROM data_datasets WHERE id = $id LIMIT 1',
      { id }
    );
    return rows[0] ? mapDatasetRow(rows[0]) : null;
  }

  private async requireDataset(id: string): Promise<DataDataset> {
    const dataset = await this.getDataset(id);
    if (!dataset) {
      throw new Error(`Dataset not found: ${id}`);
    }
    return dataset;
  }

  async getInputTableNormalizerArtifact(
    id: string
  ): Promise<DataInputTableNormalizerArtifact | null> {
    const rows = await this.metaQueryRows<DataInputTableNormalizerArtifactRow>(
      'SELECT * FROM data_input_table_normalizer_artifacts WHERE id = $id LIMIT 1',
      { id }
    );
    return rows[0] ? mapInputTableNormalizerArtifactRow(rows[0]) : null;
  }

  private async requireInputTableNormalizerArtifact(
    id: string
  ): Promise<DataInputTableNormalizerArtifact> {
    const artifact = await this.getInputTableNormalizerArtifact(id);
    if (!artifact) {
      throw new Error(`Normalizer artifact not found: ${id}`);
    }
    return artifact;
  }

  async listInputTableNormalizerArtifactVersions(
    artifactId: string
  ): Promise<DataInputTableNormalizerArtifactVersion[]> {
    const rows = await this.metaQueryRows<DataInputTableNormalizerArtifactVersionRow>(
      `
        SELECT *
        FROM data_input_table_normalizer_artifact_versions
        WHERE artifact_id = $artifactId
        ORDER BY version DESC, created_at DESC
      `,
      { artifactId }
    );
    return rows.map(mapInputTableNormalizerArtifactVersionRow);
  }

  async getInputTableNormalizerArtifactVersion(
    id: string
  ): Promise<DataInputTableNormalizerArtifactVersion | null> {
    const rows = await this.metaQueryRows<DataInputTableNormalizerArtifactVersionRow>(
      'SELECT * FROM data_input_table_normalizer_artifact_versions WHERE id = $id LIMIT 1',
      { id }
    );
    return rows[0] ? mapInputTableNormalizerArtifactVersionRow(rows[0]) : null;
  }

  private async requireInputTableNormalizerArtifactVersion(
    id: string
  ): Promise<DataInputTableNormalizerArtifactVersion> {
    const version = await this.getInputTableNormalizerArtifactVersion(id);
    if (!version) {
      throw new Error(`Normalizer artifact version not found: ${id}`);
    }
    return version;
  }

  private async requireInputDataset(id: string): Promise<DataDataset> {
    const rows = await this.metaQueryRows<DataDatasetRow>(
      `
        SELECT *
        FROM data_datasets
        WHERE id = $id
          AND ${storedDatasetSourceKindSql()} <> 'output'
        LIMIT 1
      `,
      { id }
    );
    if (!rows[0]) {
      throw new Error(`Input table not found: ${id}`);
    }
    return mapDatasetRow(rows[0]);
  }

  private async getOutputTable(id: string): Promise<DataOutputTable | null> {
    const rows = await this.metaQueryRows<DataDatasetRow>(
      `
        SELECT
          d.*,
          ${this.outputTableRelatedTaskNamesSql('d')} AS related_task_names
        FROM data_datasets d
        WHERE d.id = $id
          AND ${outputTableConfigPredicateSql('d')}
        LIMIT 1
      `,
      { id }
    );
    return rows[0] ? mapOutputTableRow(rows[0]) : null;
  }

  private async requireOutputTable(id: string): Promise<DataOutputTable> {
    const outputTable = await this.getOutputTable(id);
    if (!outputTable) {
      throw new Error(`Output table not found: ${id}`);
    }
    return outputTable;
  }

  private async getTableColumns(tableName: string): Promise<string[]> {
    const rows = await this.queryRows<{ column_name: string }>(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = $tableName
        ORDER BY ordinal_position
      `,
      { tableName }
    );
    return rows.map((row) => String(row.column_name));
  }

  private async inferTableColumnTypes(tableName: string): Promise<DataColumnTypeInfo[]> {
    const physicalTypes = await this.getTableColumnTypes(tableName);
    const rows = await this.queryRows<Record<string, unknown>>(
      `SELECT * FROM ${quoteIdentifier(tableName)} LIMIT 1000`
    );
    return physicalTypes.map((column) => {
      if (column.type !== 'text') {
        return column;
      }
      const inferredType = inferDataFieldTypeFromValues(rows.map((row) => row[column.name]));
      return {
        name: column.name,
        type: inferredType,
        storageType: duckDbTypeForDataFieldType(inferredType),
      };
    });
  }

  private async createTypedTableFromRelation(
    tableName: string,
    relationTableName: string
  ): Promise<void> {
    const columnTypes = await this.inferTableColumnTypes(relationTableName);
    const projections =
      columnTypes.length > 0
        ? columnTypes
            .map((column) => compileTypedProjection(column, quoteIdentifier(column.name)))
            .join(', ')
        : '*';
    await this.runSql(
      `CREATE TABLE ${quoteIdentifier(tableName)} AS SELECT ${projections} FROM ${quoteIdentifier(
        relationTableName
      )}`
    );
  }

  private async createDatasetTableFromSource(
    tableName: string,
    sourcePath: string,
    sourceKind: DataInputTableSourceKind,
    inputConfig?: DataInputTableConfig
  ): Promise<PreparedInputTableImport> {
    const config = normalizeInputTableConfig(inputConfig, sourceKind, sourcePath);
    if (config.dataProcessing?.strategy === 'customize') {
      return this.createDatasetTableFromPublishedNormalizer(
        tableName,
        sourcePath,
        sourceKind,
        config
      );
    }
    const tempTables: string[] = [];
    try {
      const importFiles = getImportSourceFiles(sourcePath, sourceKind, config);
      const forceVarchar = sourceKind === 'folder';
      for (const [index, filePath] of importFiles.entries()) {
        const tempTable = tableNameFromId('dataset_import', `${uuidv4()}_${index}`);
        tempTables.push(tempTable);
        await this.createImportTempTable(tempTable, filePath, index, forceVarchar, config);
        if (sourceKind === 'folder') {
          const folderConfig = config.sourceKind === 'folder' ? config : defaultFolderConfig();
          if (folderConfig.skipEmptyFiles && (await this.countRows(tempTable)) === 0) {
            await this.dropTableIfExists(tempTable);
            tempTables.pop();
            continue;
          }
          if (folderConfig.keepSourceFileName) {
            await this.appendSourceFileNameColumn(tempTable, filePath);
          }
        }
      }

      await this.createDatasetTableFromTempTables(tableName, tempTables);
      const rowCount = await this.countRows(tableName);
      const columnCount = (await this.getTableColumns(tableName)).length;
      return {
        rowCount,
        columnCount,
        fileCount: tempTables.length,
        config,
      };
    } finally {
      for (const tempTable of tempTables) {
        await this.dropTableIfExists(tempTable).catch(() => undefined);
      }
    }
  }

  private async createDatasetTableFromPublishedNormalizer(
    tableName: string,
    sourcePath: string,
    sourceKind: DataInputTableSourceKind,
    config: DataInputTableConfig
  ): Promise<PreparedInputTableImport> {
    const processing = config.dataProcessing;
    if (processing?.strategy !== 'customize' || !processing.artifactVersionId) {
      throw new Error('Published normalizer version is required for custom input table import');
    }
    if (processing.artifactVersionStatus !== 'published') {
      throw new Error('Custom input table normalizer must be published before import');
    }
    const version = await this.requireInputTableNormalizerArtifactVersion(
      processing.artifactVersionId
    );
    if (version.status !== 'published') {
      throw new Error('Custom input table normalizer version is not published');
    }
    const summary = await this.summarizeInputTableSource({
      sourcePath,
      sourceKind,
      config,
    });
    let workDir: string | null = null;
    let cleanupWorkDir = true;
    let preparedSources: PreparedInputTableNormalizerSourceContext | null = null;
    const tempTable = tableNameFromId('normalizer_import', uuidv4());
    try {
      preparedSources = prepareInputTableNormalizerSources({
        sourcePath,
        sourceKind,
        config,
        summary,
      });
      const result = await runInputTableNormalizerProject({
        version,
        prepareDependencies: false,
        projectRoot: this.getInputTableNormalizerProjectDir(version.artifactId, version.id),
        workspaceRoot: this.getInputTableNormalizerRunRoot(),
        context: {
          sourcePath,
          sourceKind,
          config,
          sourceSummary: summary,
          preparedSources,
        },
      });
      workDir = result.workDir;
      cleanupWorkDir = result.cleanupWorkDir;
      const relation = readNormalizerOutputRelationForPath(
        result.manifest.output,
        'normalizerImportOutputPath'
      );
      await this.runSql(
        `CREATE TEMP TABLE ${quoteIdentifier(tempTable)} AS SELECT * FROM ${relation}`,
        {
          normalizerImportOutputPath: result.manifest.output,
        }
      );
      await this.createTypedTableFromRelation(tableName, tempTable);
      return {
        rowCount: await this.countRows(tableName),
        columnCount: (await this.getTableColumns(tableName)).length,
        fileCount: summary.fileCount,
        config,
      };
    } finally {
      if (workDir && cleanupWorkDir) {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
      await this.dropTableIfExists(tempTable).catch(() => undefined);
      if (preparedSources) {
        fs.rmSync(preparedSources.directory, { recursive: true, force: true });
      }
    }
  }

  private async createImportTempTable(
    tableName: string,
    filePath: string,
    index: number,
    forceVarchar: boolean,
    config: DataInputTableConfig
  ): Promise<void> {
    if (isExcelFile(filePath)) {
      const workbookConfig = config.sourceKind === 'excel' ? config : defaultExcelConfig(filePath);
      await this.createTempTableFromWorkbookRows(
        tableName,
        parseWorkbookRows(filePath, workbookConfig)
      );
      return;
    }

    const parameterName = `sourcePath${index}`;
    const relation = readImportRelationForPath(filePath, parameterName, forceVarchar);
    await this.runSql(
      `CREATE TEMP TABLE ${quoteIdentifier(tableName)} AS SELECT * FROM ${relation}`,
      {
        [parameterName]: filePath,
      }
    );
  }

  private async appendSourceFileNameColumn(tableName: string, filePath: string): Promise<void> {
    const existingColumns = new Set(
      (await this.getTableColumns(tableName)).map((column) => column.toLowerCase())
    );
    let columnName = 'source_file_name';
    let suffix = 2;
    while (existingColumns.has(columnName.toLowerCase())) {
      columnName = `source_file_name_${suffix}`;
      suffix += 1;
    }
    await this.runSql(
      `ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteValueIdentifier(columnName)} VARCHAR`
    );
    await this.runSql(
      `UPDATE ${quoteIdentifier(tableName)} SET ${quoteValueIdentifier(columnName)} = $sourceFileName`,
      { sourceFileName: basename(filePath) }
    );
  }

  private async createTempTableFromWorkbookRows(
    tableName: string,
    parsed: ParsedWorkbookRows
  ): Promise<void> {
    if (parsed.columns.length === 0) {
      throw new Error('Excel workbook has no readable columns');
    }

    const inferredTypes = inferWorkbookColumnTypes(parsed);
    const columnSql = parsed.columns
      .map(
        (column, index) =>
          `${quoteValueIdentifier(column)} ${duckDbTypeForDataFieldType(inferredTypes[index])}`
      )
      .join(', ');
    await this.runSql(`CREATE TEMP TABLE ${quoteIdentifier(tableName)} (${columnSql})`);

    if (parsed.rows.length === 0) {
      return;
    }

    const columnList = parsed.columns.map(quoteValueIdentifier).join(', ');
    const placeholders = parsed.columns.map((_, index) => `$value${index}`).join(', ');
    const sql = `INSERT INTO ${quoteIdentifier(tableName)} (${columnList}) VALUES (${placeholders})`;
    for (const row of parsed.rows) {
      const values: Record<string, string | number | null> = {};
      for (let index = 0; index < parsed.columns.length; index += 1) {
        const value = row[index];
        values[`value${index}`] = normalizeWorkbookValueForDuckDb(value, inferredTypes[index]);
      }
      await this.runSql(sql, values);
    }
  }

  private async createDatasetTableFromTempTables(
    tableName: string,
    tempTables: string[]
  ): Promise<void> {
    if (tempTables.length === 0) {
      throw new Error('No Excel or CSV files were found for the input table');
    }

    const unionSql = buildUnionSqlFromTempTables(tempTables);
    const unionTable = tableNameFromId('dataset_import_union', uuidv4());
    try {
      await this.runSql(`CREATE TEMP TABLE ${quoteIdentifier(unionTable)} AS ${unionSql}`);
      await this.createTypedTableFromRelation(tableName, unionTable);
    } finally {
      await this.dropTableIfExists(unionTable).catch(() => undefined);
    }
  }

  private async countRows(tableName: string): Promise<number> {
    const rows = await this.queryRows<{ count: number | string }>(
      `SELECT count(*) AS count FROM ${quoteIdentifier(tableName)}`
    );
    return toNumber(rows[0]?.count);
  }

  private async dropTableIfExists(tableName: string): Promise<void> {
    await this.runSql(`DROP TABLE IF EXISTS ${quoteIdentifier(tableName)}`);
  }

  private async physicalTableExists(tableName: string): Promise<boolean> {
    const rows = await this.queryRows<{ table_name: string }>(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_name = $tableName
        LIMIT 1
      `,
      { tableName }
    );
    return rows.length > 0;
  }

  private async metaRunSql(
    sql: string,
    values?: Record<string, string | number | null>
  ): Promise<void> {
    if (!this.metadataDb) {
      await this.runSql(sql, values);
      return;
    }
    if (values) {
      this.metadataDb.prepare(sql).run(values);
      return;
    }
    this.metadataDb.exec(sql);
  }

  private async metaQueryRows<T extends object>(
    sql: string,
    values?: Record<string, string | number | null>
  ): Promise<T[]> {
    if (!this.metadataDb) {
      return this.queryRows<T>(sql, values);
    }
    return this.metadataDb.prepare(sql).all(values ?? {}) as T[];
  }

  private relatedTaskNamesSeparatorSql(): string {
    return this.metadataDb ? 'char(31)' : 'chr(31)';
  }

  private inputTableRelatedTaskNamesSql(inputAlias: string): string {
    return `
      (
        SELECT group_concat(t.name, ${this.relatedTaskNamesSeparatorSql()})
        FROM data_cleaning_tasks t
        WHERE t.source_dataset_id = ${inputAlias}.id
          OR t.source_path = ${inputAlias}.source_path
          OR EXISTS (
            SELECT 1
            FROM data_workflow_nodes n
            WHERE n.task_id = t.id
              AND coalesce(n.operator_type, n.node_key) IN ('input_source', 'read_source')
              AND (
                coalesce(n.config_json, '') LIKE '%"datasetId":"' || ${inputAlias}.id || '"%'
                OR coalesce(n.config_json, '') LIKE '%"datasetId": "' || ${inputAlias}.id || '"%'
                OR coalesce(n.config_json, '') LIKE '%"inputTableId":"' || ${inputAlias}.id || '"%'
                OR coalesce(n.config_json, '') LIKE '%"inputTableId": "' || ${inputAlias}.id || '"%'
                OR coalesce(n.config_json, '') LIKE '%"sourceDatasetId":"' || ${inputAlias}.id || '"%'
                OR coalesce(n.config_json, '') LIKE '%"sourceDatasetId": "' || ${inputAlias}.id || '"%'
              )
          )
      )
    `;
  }

  private outputTableRelatedTaskNamesSql(outputAlias: string): string {
    return `
      (
        SELECT group_concat(t.name, ${this.relatedTaskNamesSeparatorSql()})
        FROM data_cleaning_tasks t
        WHERE t.output_table = ${outputAlias}.table_name
          OR EXISTS (
            SELECT 1
            FROM data_workflow_nodes n
            WHERE n.task_id = t.id
              AND coalesce(n.operator_type, n.node_key) IN ('output', 'write_duckdb_table', 'publish_dataset')
              AND (
                coalesce(n.config_json, '') LIKE '%"outputDatasetId":"' || ${outputAlias}.id || '"%'
                OR coalesce(n.config_json, '') LIKE '%"outputDatasetId": "' || ${outputAlias}.id || '"%'
                OR coalesce(n.config_json, '') LIKE '%"outputTableId":"' || ${outputAlias}.id || '"%'
                OR coalesce(n.config_json, '') LIKE '%"outputTableId": "' || ${outputAlias}.id || '"%'
              )
          )
      )
    `;
  }

  private async runSql(
    sql: string,
    values?: Record<string, string | number | null>
  ): Promise<void> {
    const connection = this.requireConnection();
    await connection.run(sql, values);
  }

  private async queryRows<T extends object>(
    sql: string,
    values?: Record<string, string | number | null>
  ): Promise<T[]> {
    const connection = this.requireConnection();
    const reader = await connection.runAndReadAll(sql, values);
    return reader.getRowObjectsJson() as T[];
  }

  private requireConnection(): DuckDBConnection {
    if (!this.connection) {
      throw new Error('DuckDB data store is not initialized');
    }
    return this.connection;
  }
}

export function createDataTaskStore(dbPath: string, options?: DataTaskStoreOptions): DataTaskStore {
  return new DataTaskStore(dbPath, options);
}

function mapTaskRow(row: DataTaskRow): DataCleaningTask {
  return {
    id: String(row.id),
    name: String(row.name),
    status: normalizeStatus(row.status),
    nodeCount: toNumber(row.node_count),
    sourcePath: row.source_path ? String(row.source_path) : null,
    sourceDatasetId: row.source_dataset_id ? String(row.source_dataset_id) : null,
    outputTable: row.output_table ? String(row.output_table) : null,
    rowCount: row.row_count === null ? null : toNumber(row.row_count),
    columnCount: row.column_count === null ? null : toNumber(row.column_count),
    error: row.error ? String(row.error) : null,
    scheduledFor: row.scheduled_for === null ? null : toNumber(row.scheduled_for),
    createdAt: toNumber(row.created_at),
    updatedAt: toNumber(row.updated_at),
    lastRunAt: row.last_run_at === null ? null : toNumber(row.last_run_at),
  };
}

function mapDatasetRow(row: DataDatasetRow): DataDataset {
  const sourcePath = String(row.source_path);
  const sourceKind = normalizeStoredInputTableSourceKind(row.source_kind, sourcePath);
  return {
    id: String(row.id),
    name: String(row.name),
    sourcePath,
    sourceKind,
    inputConfig: parseInputTableConfig(row.config_json, sourceKind, sourcePath),
    fileCount: row.file_count === null ? 1 : toNumber(row.file_count),
    relatedTaskNames: parseRelatedTaskNames(row.related_task_names),
    tableName: String(row.table_name),
    rowCount: toNumber(row.row_count),
    columnCount: toNumber(row.column_count),
    createdAt: toNumber(row.created_at),
    updatedAt: toNumber(row.updated_at),
  };
}

function mapInputTableNormalizerArtifactRow(
  row: DataInputTableNormalizerArtifactRow
): DataInputTableNormalizerArtifact {
  return {
    id: String(row.id),
    name: String(row.name),
    description: row.description === null ? null : String(row.description),
    sourceKind: normalizeInputTableNormalizerSourceKind(row.source_kind),
    primaryLanguage: normalizeNormalizerLanguage(row.primary_language),
    activeVersionId: row.active_version_id ? String(row.active_version_id) : null,
    createdAt: toNumber(row.created_at),
    updatedAt: toNumber(row.updated_at),
  };
}

function mapInputTableNormalizerArtifactVersionRow(
  row: DataInputTableNormalizerArtifactVersionRow
): DataInputTableNormalizerArtifactVersion {
  return {
    id: String(row.id),
    artifactId: String(row.artifact_id),
    version: toNumber(row.version),
    status: normalizeNormalizerVersionStatus(row.status),
    files: parseJsonField<DataInputTableNormalizerArtifactVersion['files']>(row.files_json, []),
    fileTreeHash: String(row.file_tree_hash),
    rulePrompt: String(row.rule_prompt),
    sourceSummaryHash: row.source_summary_hash ? String(row.source_summary_hash) : null,
    entrypoint: parseJsonField<DataInputTableNormalizerArtifactVersion['entrypoint']>(
      row.entrypoint_json,
      { command: [] }
    ),
    dependencyPrepare: row.dependency_prepare_json
      ? parseJsonField<NonNullable<DataInputTableNormalizerArtifactVersion['dependencyPrepare']>>(
          row.dependency_prepare_json,
          { steps: [], lockFiles: [] }
        )
      : undefined,
    runtime: parseJsonField<DataInputTableNormalizerArtifactVersion['runtime']>(row.runtime_json, {
      language: 'python',
      environment: 'venv',
    }),
    dependencies: parseJsonField<DataInputTableNormalizerArtifactVersion['dependencies']>(
      row.dependencies_json,
      []
    ),
    dependencyLockHash: row.dependency_lock_hash ? String(row.dependency_lock_hash) : null,
    createdAt: toNumber(row.created_at),
    updatedAt: toNumber(row.updated_at),
    publishedAt: row.published_at === null ? null : toNumber(row.published_at),
  };
}

function mapOutputTableRow(row: DataDatasetRow): DataOutputTable {
  const config = parseOutputTableConfig(row.config_json);
  return {
    id: String(row.id),
    name: String(row.name),
    sourceDatasetId: config.kind === OUTPUT_TABLE_CONFIG_KIND ? config.sourceDatasetId : null,
    tableName: String(row.table_name),
    rowCount: toNumber(row.row_count),
    columnCount: toNumber(row.column_count),
    relatedTaskNames: parseRelatedTaskNames(row.related_task_names),
    createdAt: toNumber(row.created_at),
    updatedAt: toNumber(row.updated_at),
  };
}

function parseJsonField<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeInputTableNormalizerSourceKind(value: string): DataInputTableSourceKind {
  if (value === 'excel' || value === 'csv' || value === 'folder') {
    return value;
  }
  return 'excel';
}

function normalizeNormalizerLanguage(value: string): DataNormalizerLanguage {
  if (value === 'python' || value === 'node') {
    return value;
  }
  return 'python';
}

function normalizeNormalizerVersionStatus(value: string): DataNormalizerArtifactVersionStatus {
  if (value === 'draft' || value === 'published' || value === 'archived') {
    return value;
  }
  return 'draft';
}

function parseOutputTableConfig(value: string | null): {
  kind: string | null;
  sourceDatasetId: string | null;
} {
  if (!value) return { kind: null, sourceDatasetId: null };
  try {
    const parsed = JSON.parse(value) as { kind?: unknown; sourceDatasetId?: unknown };
    return {
      kind: typeof parsed.kind === 'string' && parsed.kind.trim() ? parsed.kind.trim() : null,
      sourceDatasetId:
        typeof parsed.sourceDatasetId === 'string' && parsed.sourceDatasetId.trim()
          ? parsed.sourceDatasetId.trim()
          : null,
    };
  } catch {
    return { kind: null, sourceDatasetId: null };
  }
}

function parseRelatedTaskNames(value: string | null | undefined): string[] {
  if (!value) return [];
  return value.split('\u001F').filter(Boolean).slice(0, 2);
}

function normalizeStoredInputTableSourceKind(
  value: string | null,
  sourcePath: string
): DataInputTableSourceKind {
  if (value === 'excel' || value === 'csv' || value === 'folder') {
    return value;
  }
  if (sourcePath.endsWith('/') || !extname(sourcePath)) {
    return 'folder';
  }
  return isExcelFile(sourcePath) ? 'excel' : 'csv';
}

function storedDatasetSourceKindSql(alias?: string): string {
  const prefix = alias ? `${alias}.` : '';
  const sourceKind = `${prefix}source_kind`;
  const sourcePath = `lower(${prefix}source_path)`;
  return `
    coalesce(
      ${sourceKind},
      CASE
        WHEN ${sourcePath} LIKE '%.xlsx' OR ${sourcePath} LIKE '%.xls' THEN 'excel'
        WHEN ${sourcePath} LIKE '%.csv' OR ${sourcePath} LIKE '%.tsv' OR ${sourcePath} LIKE '%.tab' THEN 'csv'
        ELSE 'folder'
      END
    )
  `;
}

function outputTableConfigPredicateSql(alias?: string): string {
  const prefix = alias ? `${alias}.` : '';
  return `
    ${storedDatasetSourceKindSql(alias)} = 'output'
    AND coalesce(${prefix}config_json, '') LIKE '%"kind":"${OUTPUT_TABLE_CONFIG_KIND}"%'
  `;
}

function outputTableConfigJson(sourceDatasetId?: string | null): string {
  const config: { kind: string; sourceDatasetId?: string } = {
    kind: OUTPUT_TABLE_CONFIG_KIND,
  };
  if (sourceDatasetId) {
    config.sourceDatasetId = sourceDatasetId;
  }
  return JSON.stringify(config);
}

function isLegacyExplicitOutputTableRow(row: DataDatasetRow): boolean {
  const tableName = String(row.table_name);
  const sourcePath = String(row.source_path);
  return (
    tableName.startsWith('output_') &&
    (sourcePath === `duckdb://outputs/${tableName}` || sourcePath.startsWith('input-table://'))
  );
}

function parseInputTableConfig(
  value: string | null,
  sourceKind: DataInputTableSourceKind,
  sourcePath: string
): DataInputTableConfig {
  if (value) {
    try {
      const parsed = JSON.parse(value) as DataInputTableConfig;
      return normalizeStoredInputTableConfig(parsed, sourceKind, sourcePath);
    } catch {
      return normalizeStoredInputTableConfig(undefined, sourceKind, sourcePath);
    }
  }
  return normalizeStoredInputTableConfig(undefined, sourceKind, sourcePath);
}

function mapWorkflowNodeRow(row: DataWorkflowNodeRow): DataWorkflowNode {
  const type = normalizeOperatorType(row.operator_type ?? row.node_key);
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    type,
    label: row.label ? String(row.label) : DEFAULT_OPERATOR_LABELS[type],
    x: toFiniteNumber(row.x, 48),
    y: toFiniteNumber(row.y, 128),
    config: parseWorkflowConfig(row.config_json),
    createdAt: toNumber(row.created_at),
    updatedAt: row.updated_at === null ? toNumber(row.created_at) : toNumber(row.updated_at),
  };
}

function mapWorkflowEdgeRow(row: DataWorkflowEdgeRow): DataWorkflowEdge {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    sourceNodeId: String(row.source_node_id),
    targetNodeId: String(row.target_node_id),
    sourceHandle: row.source_handle ? String(row.source_handle) : null,
    targetHandle: row.target_handle ? String(row.target_handle) : null,
    createdAt: toNumber(row.created_at),
  };
}

function isLegacyDefaultWorkflow(rows: DataWorkflowNodeRow[]): boolean {
  if (rows.length !== LEGACY_DEFAULT_WORKFLOW_NODES.length) {
    return false;
  }
  return rows.every((row, index) => {
    const legacyNode = LEGACY_DEFAULT_WORKFLOW_NODES[index];
    const normalizedType = normalizeOperatorType(row.operator_type ?? row.node_key);
    const legacyLabel = String(row.label);
    const isLegacyInputLabel =
      legacyNode.type === 'input_source' &&
      (legacyLabel === '数据源' || legacyLabel === '输入数据源');
    return (
      normalizedType === legacyNode.type &&
      (legacyLabel === legacyNode.label || isLegacyInputLabel) &&
      Math.abs(toFiniteNumber(row.x, Number.NaN) - legacyNode.x) < 0.001 &&
      Math.abs(toFiniteNumber(row.y, Number.NaN) - legacyNode.y) < 0.001
    );
  });
}

function normalizeWorkflowNodeInputs(nodes: DataWorkflowNodeInput[]): DataWorkflowNodeInput[] {
  return nodes.map((node, index) => {
    const type = normalizeOperatorType(node.type);
    const label = node.label.trim() || DEFAULT_OPERATOR_LABELS[type];
    return {
      id: node.id.trim() || uuidv4(),
      type,
      label,
      x: toFiniteNumber(node.x, 80 + index * 28),
      y: toFiniteNumber(node.y, 120 + index * 24),
      config: node.config ?? {},
    };
  });
}

function normalizeWorkflowEdgeInputs(
  edges: DataWorkflowEdgeInput[],
  nodeIds: Set<string>
): DataWorkflowEdgeInput[] {
  const seen = new Set<string>();
  const normalized: DataWorkflowEdgeInput[] = [];
  for (const edge of edges) {
    if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) {
      continue;
    }
    const key = `${edge.sourceNodeId}:${edge.targetNodeId}:${edge.sourceHandle ?? ''}:${
      edge.targetHandle ?? ''
    }`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push({
      id: edge.id.trim() || uuidv4(),
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      sourceHandle: edge.sourceHandle ?? 'output',
      targetHandle: edge.targetHandle ?? 'input',
    });
  }
  return normalized;
}

function normalizeScopedWorkflowInputs(
  taskId: string,
  input: DataWorkflowSaveInput
): { nodes: DataWorkflowNodeInput[]; edges: DataWorkflowEdgeInput[] } {
  const nodes = normalizeWorkflowNodeInputs(input.nodes);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const idByOriginalNodeId = new Map(
    nodes.map((node) => [node.id, scopedWorkflowEntityId(taskId, node.id)])
  );
  const scopedNodes = nodes.map((node) => ({
    ...node,
    id: idByOriginalNodeId.get(node.id) ?? node.id,
  }));
  const edges = normalizeWorkflowEdgeInputs(input.edges, nodeIds);
  const scopedEdges = edges.flatMap((edge) => {
    const sourceNodeId = idByOriginalNodeId.get(edge.sourceNodeId);
    const targetNodeId = idByOriginalNodeId.get(edge.targetNodeId);
    if (!sourceNodeId || !targetNodeId) return [];
    return [
      {
        ...edge,
        id: scopedWorkflowEntityId(taskId, edge.id),
        sourceNodeId,
        targetNodeId,
      },
    ];
  });
  return { nodes: scopedNodes, edges: scopedEdges };
}

function scopedWorkflowEntityId(taskId: string, id: string): string {
  const prefix = `${taskId.replace(/[^A-Za-z0-9]+/g, '_') || 'task'}__`;
  return id.startsWith(prefix) ? id : `${prefix}${id}`;
}

function normalizeRuntimeWorkflowInput(
  taskId: string,
  input: DataWorkflowSaveInput,
  timestamp: number
): RuntimeWorkflow {
  const nodes = normalizeWorkflowNodeInputs(input.nodes).map<DataWorkflowNode>((node) => ({
    id: node.id,
    taskId,
    type: node.type,
    label: node.label,
    x: node.x,
    y: node.y,
    config: node.config ?? {},
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = normalizeWorkflowEdgeInputs(input.edges, nodeIds).map<DataWorkflowEdge>((edge) => ({
    id: edge.id,
    taskId,
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
    sourceHandle: edge.sourceHandle ?? 'output',
    targetHandle: edge.targetHandle ?? 'input',
    createdAt: timestamp,
  }));
  return { nodes, edges };
}

function workflowRequiresTaskSource(nodes: DataWorkflowNode[]): boolean {
  if (nodes.length === 0) return true;
  return nodes.some((node) => {
    if (node.type !== 'input_source') return false;
    const source =
      typeof node.config.source === 'string'
        ? node.config.source
        : stringConfigValue(node.config.datasetId)
          ? 'dataset'
          : 'task';
    return source === 'task' || (source === 'file' && !stringConfigValue(node.config.filePath));
  });
}

function parseWorkflowConfig(value: string | null): Record<string, unknown> {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

function normalizeOperatorType(value: string | null | undefined): DataWorkflowOperatorType {
  if (value && WORKFLOW_OPERATOR_TYPE_SET.has(value)) {
    return value as DataWorkflowOperatorType;
  }
  switch (value) {
    case 'load_source':
      return 'input_source';
    case 'profile_schema':
      return 'field_select';
    case 'drop_empty_rows':
      return 'missing_value';
    case 'deduplicate_rows':
      return 'deduplicate';
    case 'join_table':
    case 'asof_join':
      return 'join';
    case 'write_duckdb_table':
    case 'publish_dataset':
      return 'output';
    default:
      return 'filter';
  }
}

function getOutputTableName(node: DataWorkflowNode | undefined, fallback: string): string {
  if (!node) return fallback;
  const table = node.config.table;
  return typeof table === 'string' && table.trim() ? table.trim() : fallback;
}

function stringConfigValue(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function findWorkflowTerminalNodeId(
  nodes: DataWorkflowNode[],
  edges: DataWorkflowEdge[]
): string | null {
  const nonOutputIds = new Set(
    nodes.filter((node) => node.type !== 'output').map((node) => node.id)
  );
  const sourceIdsWithOutgoingEdges = new Set(
    edges.filter((edge) => nonOutputIds.has(edge.sourceNodeId)).map((edge) => edge.sourceNodeId)
  );
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node.type !== 'output' && !sourceIdsWithOutgoingEdges.has(node.id)) return node.id;
  }
  return [...nonOutputIds].pop() ?? null;
}

function toPersistentCreateTableSql(sql: string): string {
  return sql.replace(/\bCREATE\s+TEMP\s+TABLE\b/i, 'CREATE TABLE');
}

function inferWorkbookColumnTypes(parsed: ParsedWorkbookRows): DataFieldType[] {
  return parsed.columns.map((_, columnIndex) =>
    inferDataFieldTypeFromValues(parsed.rows.map((row) => row[columnIndex]))
  );
}

function inferDataFieldTypeFromValues(values: unknown[]): DataFieldType {
  const nonEmpty = values.filter(hasInferableValue);
  if (nonEmpty.length === 0) {
    return 'text';
  }
  if (nonEmpty.every(isBooleanLikeValue)) {
    return 'boolean';
  }
  if (nonEmpty.every(isDateLikeValue)) {
    return nonEmpty.some(isDateTimeLikeValue) ? 'datetime' : 'date';
  }
  if (nonEmpty.every(isIntegerLikeValue)) {
    return 'integer';
  }
  if (nonEmpty.every(isNumericLikeValue)) {
    return nonEmpty.every(isFixedDecimalLikeValue) ? 'decimal' : 'float';
  }
  return 'text';
}

function hasInferableValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return typeof value === 'string' ? value.trim().length > 0 : true;
}

function isBooleanLikeValue(value: unknown): boolean {
  if (typeof value === 'boolean') return true;
  if (typeof value !== 'string') return false;
  return /^(true|false)$/i.test(value.trim());
}

function isDateLikeValue(value: unknown): boolean {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return isDateOnlyText(text) || isDateTimeText(text);
}

function isDateTimeLikeValue(value: unknown): boolean {
  return value instanceof Date || (typeof value === 'string' && isDateTimeText(value.trim()));
}

function isDateOnlyText(value: string): boolean {
  if (!/^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{8})$/.test(value)) return false;
  const normalized =
    value.length === 8
      ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
      : value.replace(/[/.]/g, '-');
  const timestamp = Date.parse(`${normalized}T00:00:00Z`);
  return Number.isFinite(timestamp);
}

function isDateTimeText(value: string): boolean {
  const match =
    /^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{8})[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?$/i.exec(
      value
    );
  if (!match) return false;
  const datePart = match[1];
  return isDateOnlyText(datePart);
}

function isIntegerLikeValue(value: unknown): boolean {
  if (typeof value === 'bigint') return true;
  if (typeof value === 'number') return Number.isInteger(value);
  if (typeof value !== 'string') return false;
  const normalized = normalizeNumericText(value);
  return normalized !== null && /^[+-]?\d+$/.test(normalized);
}

function isNumericLikeValue(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string') return false;
  const normalized = normalizeNumericText(value);
  return normalized !== null && Number.isFinite(Number(normalized));
}

function isFixedDecimalLikeValue(value: unknown): boolean {
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value !== 'string') return false;
  const text = normalizeNumericText(value);
  if (text === null) return false;
  if (/[eE]/.test(text)) return false;
  if (/^[+-]?\d+$/.test(text)) return true;
  const match = /^[+-]?(?:\d+)\.(\d+)$/.exec(text);
  return Boolean(match && match[1].length <= 6);
}

function normalizeNumericText(value: string): string | null {
  const text = value
    .trim()
    .normalize('NFKC')
    .replace(/[\u2212\u2010\u2011\u2012\u2013\u2014]/g, '-')
    .replace(/[\s\u00a0\u202f]+/g, '');
  if (!text) return null;
  if (text.includes(',')) {
    if (!/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(text)) {
      return null;
    }
    return text.replace(/,/g, '');
  }
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text) ? text : null;
}

function normalizeWorkbookValueForDuckDb(
  value: string | number | boolean | null | undefined,
  inferredType: DataFieldType
): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return String(value);
  if (typeof value !== 'string') return value;
  if (inferredType === 'integer' || inferredType === 'float' || inferredType === 'decimal') {
    return normalizeNumericText(value) ?? value;
  }
  return value;
}

function normalizeSourcePath(filePath: string): string {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Data source file does not exist: ${filePath}`);
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`Data source path is not a file: ${filePath}`);
  }
  readRelationForPath(filePath, 'sourcePath');
  return filePath;
}

function normalizeImportSourcePath(sourcePath: string): string {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error(`Input table source does not exist: ${sourcePath}`);
  }
  const stat = fs.statSync(sourcePath);
  if (stat.isDirectory()) {
    return sourcePath;
  }
  if (!stat.isFile()) {
    throw new Error(`Input table source is not a file or folder: ${sourcePath}`);
  }
  if (!isImportableFile(sourcePath)) {
    throw new Error(
      `Unsupported input table source type: ${extname(sourcePath).toLowerCase() || '(none)'}`
    );
  }
  return sourcePath;
}

function normalizeInputTableSourceKind(
  requestedKind: DataInputTableSourceKind | undefined,
  sourcePath: string
): DataInputTableSourceKind {
  if (requestedKind) {
    return requestedKind;
  }
  const stat = fs.statSync(sourcePath);
  if (stat.isDirectory()) {
    return 'folder';
  }
  return isExcelFile(sourcePath) ? 'excel' : 'csv';
}

function normalizeInputTableConfig(
  config: DataInputTableConfig | undefined,
  sourceKind: DataInputTableSourceKind,
  sourcePath: string
): DataInputTableConfig {
  if (sourceKind === 'excel') {
    const fallback = defaultExcelConfig(sourcePath);
    if (config?.sourceKind !== 'excel') {
      return fallback;
    }
    const sheetName =
      config.sheetName && fallback.sheetNames.includes(config.sheetName)
        ? config.sheetName
        : fallback.sheetName;
    return {
      sourceKind: 'excel',
      sheetName,
      sheetNames: fallback.sheetNames,
      headerMode: config.headerMode === 'manual' ? 'manual' : 'auto',
      headerRow: Math.max(1, Math.floor(Number(config.headerRow) || 1)),
      dataProcessing: normalizeInputTableDataProcessing(config.dataProcessing),
    };
  }

  if (sourceKind === 'folder') {
    if (config?.sourceKind !== 'folder') {
      return defaultFolderConfig();
    }
    return {
      sourceKind: 'folder',
      mergeMode: 'append_same_schema',
      schemaStrategy: 'align_by_name',
      fileRange:
        config.fileRange === 'excel' || config.fileRange === 'csv' ? config.fileRange : 'excel_csv',
      skipEmptyFiles: config.skipEmptyFiles !== false,
      keepSourceFileName: config.keepSourceFileName !== false,
      dataProcessing: normalizeInputTableDataProcessing(config.dataProcessing),
    };
  }

  return defaultCsvConfig(config);
}

function normalizeStoredInputTableConfig(
  config: DataInputTableConfig | undefined,
  sourceKind: DataInputTableSourceKind,
  sourcePath: string
): DataInputTableConfig {
  if (sourceKind === 'excel') {
    const storedSheetNames =
      config?.sourceKind === 'excel'
        ? stringArray(config.sheetNames).filter((sheetName) => sheetName.trim())
        : [];
    const sheetNames = storedSheetNames.length > 0 ? storedSheetNames : ['Sheet1'];
    const storedSheetName =
      config?.sourceKind === 'excel' &&
      typeof config.sheetName === 'string' &&
      config.sheetName.trim()
        ? config.sheetName.trim()
        : '';
    return {
      sourceKind: 'excel',
      sheetName: storedSheetName || sheetNames[0] || 'Sheet1',
      sheetNames,
      headerMode:
        config?.sourceKind === 'excel' && config.headerMode === 'manual' ? 'manual' : 'auto',
      headerRow:
        config?.sourceKind === 'excel' ? Math.max(1, Math.floor(Number(config.headerRow) || 1)) : 1,
      dataProcessing: normalizeInputTableDataProcessing(
        config?.sourceKind === 'excel' ? config.dataProcessing : undefined
      ),
    };
  }

  if (sourceKind === 'folder') {
    return config?.sourceKind === 'folder'
      ? normalizeInputTableConfig(config, sourceKind, sourcePath)
      : defaultFolderConfig();
  }

  return defaultCsvConfig(config);
}

function defaultExcelConfig(filePath?: string): DataInputTableExcelConfig {
  const sheetNames =
    filePath && fs.existsSync(filePath) && isExcelFile(filePath)
      ? getWorkbookSheetNames(filePath)
      : ['Sheet1'];
  return {
    sourceKind: 'excel',
    sheetName: sheetNames[0] ?? 'Sheet1',
    sheetNames,
    headerMode: 'auto',
    headerRow: 1,
    dataProcessing: defaultInputTableDataProcessing(),
  };
}

function defaultCsvConfig(config?: DataInputTableConfig): DataInputTableCsvConfig {
  return {
    sourceKind: 'csv',
    header: 'auto',
    dataRegion: 'auto',
    encoding: 'auto',
    delimiter: 'auto',
    ...(config?.sourceKind === 'csv' ? config : {}),
    dataProcessing: normalizeInputTableDataProcessing(
      config?.sourceKind === 'csv' ? config.dataProcessing : undefined
    ),
  };
}

function defaultFolderConfig(): DataInputTableFolderConfig {
  return {
    sourceKind: 'folder',
    mergeMode: 'append_same_schema',
    schemaStrategy: 'align_by_name',
    fileRange: 'excel_csv',
    skipEmptyFiles: true,
    keepSourceFileName: true,
    dataProcessing: defaultInputTableDataProcessing(),
  };
}

function defaultInputTableDataProcessing(): DataInputTableConfig['dataProcessing'] {
  return { strategy: 'auto' };
}

function normalizeInputTableDataProcessing(
  value: DataInputTableConfig['dataProcessing'] | undefined
): DataInputTableConfig['dataProcessing'] {
  if (value?.strategy === 'customize') {
    return {
      strategy: 'customize',
      rulePrompt: typeof value.rulePrompt === 'string' ? value.rulePrompt : '',
      selectedSkillNames: Array.isArray(value.selectedSkillNames)
        ? value.selectedSkillNames.filter(
            (name): name is string => typeof name === 'string' && name.trim().length > 0
          )
        : undefined,
      modelConfigSetId:
        typeof value.modelConfigSetId === 'string' && value.modelConfigSetId.trim()
          ? value.modelConfigSetId
          : undefined,
      model: typeof value.model === 'string' && value.model.trim() ? value.model : undefined,
      artifactId: typeof value.artifactId === 'string' ? value.artifactId : undefined,
      artifactVersionId:
        typeof value.artifactVersionId === 'string' ? value.artifactVersionId : undefined,
      artifactVersionStatus:
        value.artifactVersionStatus === 'draft' ||
        value.artifactVersionStatus === 'published' ||
        value.artifactVersionStatus === 'archived'
          ? value.artifactVersionStatus
          : undefined,
      fileTreeHash: typeof value.fileTreeHash === 'string' ? value.fileTreeHash : undefined,
      dependencyLockHash:
        typeof value.dependencyLockHash === 'string' ? value.dependencyLockHash : undefined,
      runtime: value.runtime,
      entrypoint: value.entrypoint,
      dependencyPrepare: value.dependencyPrepare,
      projectFiles: Array.isArray(value.projectFiles)
        ? value.projectFiles
            .filter(
              (file) =>
                file &&
                typeof file.path === 'string' &&
                typeof file.content === 'string' &&
                file.path.trim().length > 0
            )
            .map((file) => ({ path: file.path, content: file.content }))
        : undefined,
      sourceSummaryHash:
        typeof value.sourceSummaryHash === 'string' ? value.sourceSummaryHash : undefined,
    };
  }
  return defaultInputTableDataProcessing();
}

function getWorkbookSheetNames(filePath: string): string[] {
  const workbook = readWorkbookFile(filePath);
  return workbook.SheetNames.length > 0 ? workbook.SheetNames : ['Sheet1'];
}

function getImportSourceFiles(
  sourcePath: string,
  sourceKind: DataInputTableSourceKind,
  config: DataInputTableConfig
): string[] {
  const stat = fs.statSync(sourcePath);
  if (stat.isFile()) {
    return [sourcePath];
  }

  const folderConfig = config.sourceKind === 'folder' ? config : defaultFolderConfig();
  const files = listImportableFiles(sourcePath, folderConfig.fileRange);
  if (files.length === 0) {
    throw new Error(
      sourceKind === 'folder'
        ? 'No Excel or CSV files were found in the selected folder'
        : 'No input table file was found'
    );
  }
  return files;
}

function writeInputTableNormalizerProjectFiles(
  projectDir: string,
  files: DataSaveInputTableNormalizerDraftInput['files']
): void {
  fs.rmSync(projectDir, { recursive: true, force: true });
  fs.mkdirSync(projectDir, { recursive: true });
  for (const file of files) {
    const targetPath = resolveSafeNormalizerProjectPath(projectDir, file.path);
    fs.mkdirSync(dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, file.content, 'utf8');
  }
}

function resolveSafeNormalizerProjectPath(projectDir: string, filePath: string): string {
  if (isAbsolute(filePath)) {
    throw new Error(`Normalizer project file path must be relative: ${filePath}`);
  }
  const root = resolve(projectDir);
  const resolved = resolve(projectDir, filePath);
  if (!isPathInside(resolved, root)) {
    throw new Error(`Normalizer project file escapes project root: ${filePath}`);
  }
  return resolved;
}

function isPathInside(childPath: string, rootPath: string): boolean {
  const child = resolve(childPath);
  const root = resolve(rootPath);
  return child === root || child.startsWith(`${root}${process.platform === 'win32' ? '\\' : '/'}`);
}

function sanitizeNormalizerPathSegment(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 96);
  return sanitized || 'unknown';
}

function prepareInputTableNormalizerSources(input: {
  sourcePath: string;
  sourceKind: DataInputTableSourceKind;
  config: DataInputTableConfig;
  summary: DataInputTableSourceSummary;
}): PreparedInputTableNormalizerSourceContext {
  const directory = fs.mkdtempSync(join(os.tmpdir(), 'sophron-normalizer-input-'));
  const importFiles = getImportSourceFiles(input.sourcePath, input.sourceKind, input.config);
  const summaryByPath = new Map(input.summary.files.map((file) => [file.path, file]));
  const files: PreparedInputTableNormalizerSourceFile[] = [];
  try {
    for (const [fileIndex, filePath] of importFiles.entries()) {
      const summary = summaryByPath.get(filePath);
      if (isExcelFile(filePath)) {
        files.push(
          ...prepareWorkbookNormalizerSources({
            filePath,
            sourcePath: input.sourcePath,
            config: input.config,
            summary,
            directory,
            fileIndex,
          })
        );
        continue;
      }
      if (isCsvLikeFile(filePath)) {
        files.push(
          prepareDelimitedNormalizerSource({
            filePath,
            sourcePath: input.sourcePath,
            summary,
            directory,
            fileIndex,
          })
        );
      }
    }
    return { directory, files };
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function prepareWorkbookNormalizerSources(input: {
  filePath: string;
  sourcePath: string;
  config: DataInputTableConfig;
  summary: DataInputTableSourceFileSummary | undefined;
  directory: string;
  fileIndex: number;
}): PreparedInputTableNormalizerSourceFile[] {
  const workbook = readWorkbookFile(input.filePath);
  const selectedSheetNames = selectNormalizerWorkbookSheets(workbook.SheetNames, input.config);
  return selectedSheetNames.map((sheetName, sheetIndex) => {
    const sheet = workbook.Sheets[sheetName];
    const matrix = sheetToExpandedMatrix(sheet);
    const preparedPath = join(
      input.directory,
      createPreparedSourceFileName(input.fileIndex, sheetIndex, input.filePath)
    );
    writeCsvRows(preparedPath, matrix);
    const sheetSummary = input.summary?.sheets?.find((candidate) => candidate.name === sheetName);
    return {
      path: preparedPath,
      relativePath: `${getSourceRelativePath(input.sourcePath, input.filePath)}#${sheetName}`,
      originalPath: input.filePath,
      originalKind: 'excel',
      delimiter: ',',
      sheetName,
      headerCandidates: sheetSummary?.headerCandidates ?? detectHeaderCandidates(matrix, 80),
      rowCountEstimate: sheetSummary?.rowCountEstimate ?? matrix.length,
      columnCountEstimate:
        sheetSummary?.columnCountEstimate ?? Math.max(0, ...matrix.map((row) => row.length)),
    };
  });
}

function selectNormalizerWorkbookSheets(
  sheetNames: string[],
  config: DataInputTableConfig
): string[] {
  if (sheetNames.length === 0) {
    return [];
  }
  if (config.sourceKind === 'excel') {
    const sheetName =
      config.sheetName && sheetNames.includes(config.sheetName) ? config.sheetName : sheetNames[0];
    return sheetName ? [sheetName] : [];
  }
  return [sheetNames[0]];
}

function prepareDelimitedNormalizerSource(input: {
  filePath: string;
  sourcePath: string;
  summary: DataInputTableSourceFileSummary | undefined;
  directory: string;
  fileIndex: number;
}): PreparedInputTableNormalizerSourceFile {
  const delimiter = extname(input.filePath).toLowerCase() === '.csv' ? ',' : '\t';
  const rows = parseDelimitedRows(fs.readFileSync(input.filePath, 'utf8'), delimiter);
  const preparedPath = join(
    input.directory,
    createPreparedSourceFileName(input.fileIndex, 0, input.filePath)
  );
  writeCsvRows(preparedPath, rows);
  return {
    path: preparedPath,
    relativePath: getSourceRelativePath(input.sourcePath, input.filePath),
    originalPath: input.filePath,
    originalKind: 'csv',
    delimiter: ',',
    headerCandidates: input.summary?.sampleRows
      ? detectHeaderCandidates(input.summary.sampleRows, 80)
      : detectHeaderCandidates(rows, 80),
    rowCountEstimate: rows.length,
    columnCountEstimate: Math.max(0, ...rows.map((row) => row.length)),
  };
}

function createPreparedSourceFileName(
  fileIndex: number,
  sheetIndex: number,
  filePath: string
): string {
  const baseName =
    basename(filePath, extname(filePath)).replace(/[^A-Za-z0-9_-]+/g, '_') || 'source';
  return `${String(fileIndex + 1).padStart(3, '0')}_${String(sheetIndex + 1).padStart(3, '0')}_${baseName}.csv`;
}

function writeCsvRows(
  filePath: string,
  rows: Array<Array<string | number | boolean | null>>
): void {
  const content = rows
    .map((row) =>
      row
        .map((cell) => escapeCsvCell(cell === null || cell === undefined ? '' : String(cell)))
        .join(',')
    )
    .join('\n');
  fs.writeFileSync(filePath, `${content}${content ? '\n' : ''}`, 'utf8');
}

function parseDelimitedRows(text: string, delimiter: ',' | '\t'): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === delimiter && !inQuotes) {
      row.push(cell.trim());
      cell = '';
      continue;
    }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      row.push(cell.trim());
      if (row.some((value) => value.trim().length > 0)) {
        rows.push(row);
      }
      row = [];
      cell = '';
      continue;
    }
    cell += char;
  }
  row.push(cell.trim());
  if (row.some((value) => value.trim().length > 0)) {
    rows.push(row);
  }
  return rows;
}

function escapeCsvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function listImportableFiles(
  folderPath: string,
  fileRange: DataInputTableFolderConfig['fileRange'] = 'excel_csv'
): string[] {
  const files: string[] = [];
  const visit = (directory: string) => {
    const entries = fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith('.') && !entry.name.startsWith('~$'))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }
      if (entry.isFile() && isFolderRangeFile(entryPath, fileRange)) {
        files.push(entryPath);
      }
    }
  };
  visit(folderPath);
  return files;
}

function readRelationForPath(filePath: string, parameterName: string): string {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.csv') {
    return `read_csv_auto($${parameterName}, header = true)`;
  }
  if (extension === '.tsv' || extension === '.tab') {
    return `read_csv_auto($${parameterName}, header = true, delim = '\t')`;
  }
  if (extension === '.json' || extension === '.jsonl' || extension === '.ndjson') {
    return `read_json_auto($${parameterName})`;
  }
  if (extension === '.parquet') {
    return `read_parquet($${parameterName})`;
  }
  throw new Error(`Unsupported data file type: ${extension || '(none)'}`);
}

function readNormalizerOutputRelationForPath(filePath: string, parameterName: string): string {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.csv') {
    return `read_csv($${parameterName}, header = true, delim = ',', quote = '"', escape = '"', all_varchar = true, strict_mode = false, null_padding = true)`;
  }
  return readRelationForPath(filePath, parameterName);
}

function readImportRelationForPath(
  filePath: string,
  parameterName: string,
  forceVarchar: boolean
): string {
  if (!forceVarchar) {
    return readRelationForPath(filePath, parameterName);
  }
  const extension = extname(filePath).toLowerCase();
  if (extension === '.csv') {
    return `read_csv_auto($${parameterName}, header = true, all_varchar = true)`;
  }
  if (extension === '.tsv' || extension === '.tab') {
    return `read_csv_auto($${parameterName}, header = true, delim = '\t', all_varchar = true)`;
  }
  return readRelationForPath(filePath, parameterName);
}

function buildUnionSqlFromTempTables(tempTables: string[]): string {
  return tempTables
    .map((tempTable, index) => {
      const selectSql = `SELECT * FROM ${quoteIdentifier(tempTable)}`;
      return index === 0 ? selectSql : `UNION ALL BY NAME ${selectSql}`;
    })
    .join('\n');
}

function normalizePreviewLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) {
    return 100;
  }
  return Math.max(1, Math.min(100, Math.floor(Number(limit))));
}

function normalizePreviewOffset(offset: number | undefined): number {
  if (!Number.isFinite(offset)) {
    return 0;
  }
  return Math.max(0, Math.floor(Number(offset)));
}

function normalizeCsvExportMaxRows(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(1, Math.floor(Number(value)));
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function normalizePreviewRow(
  row: Record<string, unknown>
): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, normalizePreviewCell(value)])
  );
}

function normalizePreviewCell(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return String(value);
}

function isImportableFile(filePath: string): boolean {
  return (
    isInputTableFile(filePath) ||
    ['.json', '.jsonl', '.ndjson', '.parquet'].includes(extname(filePath).toLowerCase())
  );
}

function isInputTableFile(filePath: string): boolean {
  const extension = extname(filePath).toLowerCase();
  return (
    extension === '.csv' || extension === '.tsv' || extension === '.tab' || isExcelFile(filePath)
  );
}

function isFolderRangeFile(
  filePath: string,
  fileRange: DataInputTableFolderConfig['fileRange']
): boolean {
  if (fileRange === 'excel') {
    return isExcelFile(filePath);
  }
  if (fileRange === 'csv') {
    return isCsvLikeFile(filePath);
  }
  return isInputTableFile(filePath);
}

function isCsvLikeFile(filePath: string): boolean {
  const extension = extname(filePath).toLowerCase();
  return extension === '.csv' || extension === '.tsv' || extension === '.tab';
}

function isExcelFile(filePath: string): boolean {
  const extension = extname(filePath).toLowerCase();
  return extension === '.xlsx' || extension === '.xls';
}

function parseWorkbookRows(
  filePath: string,
  config: DataInputTableExcelConfig
): ParsedWorkbookRows {
  const workbook = readWorkbookFile(filePath);
  const sheetNames = workbook.SheetNames;
  const sheetName =
    config.sheetName && sheetNames.includes(config.sheetName) ? config.sheetName : sheetNames[0];
  if (!sheetName) {
    throw new Error(`Excel workbook has no sheets: ${filePath}`);
  }
  const sheet = workbook.Sheets[sheetName];
  const matrix = sheetToExpandedMatrix(sheet);
  const headerIndex =
    config.headerMode === 'manual'
      ? Math.max(0, config.headerRow - 1)
      : matrix.findIndex((row) => row.some(hasCellValue));
  if (headerIndex < 0) {
    throw new Error(`Excel workbook has no header row: ${filePath}`);
  }

  const headerRow = matrix[headerIndex];
  if (!headerRow) {
    throw new Error(`Excel header row does not exist: ${filePath}`);
  }

  const columns = normalizeWorkbookColumns(headerRow);
  const rows = matrix
    .slice(headerIndex + 1)
    .filter((row) => row.some(hasCellValue))
    .map((row) => columns.map((_, index) => normalizeWorkbookCell(row[index])));
  return { columns, rows, sheetName, sheetNames };
}

function summarizeInputTableFile(
  filePath: string,
  sourcePath: string,
  options: {
    maxSheetsPerFile: number;
    maxRowsPerSheet: number;
    maxColumnsPerRow: number;
  }
): DataInputTableSourceFileSummary {
  const stat = fs.statSync(filePath);
  const extension = extname(filePath).toLowerCase();
  const baseSummary: DataInputTableSourceFileSummary = {
    path: filePath,
    name: basename(filePath),
    relativePath: getSourceRelativePath(sourcePath, filePath),
    extension,
    kind: isExcelFile(filePath) ? 'excel' : isCsvLikeFile(filePath) ? 'csv' : 'other',
    sizeBytes: stat.size,
    modifiedAt: Math.floor(stat.mtimeMs),
  };

  try {
    if (isExcelFile(filePath)) {
      return {
        ...baseSummary,
        sheets: summarizeWorkbookSheets(filePath, options),
      };
    }
    if (isCsvLikeFile(filePath)) {
      const delimiter = extension === '.tsv' || extension === '.tab' ? '\t' : ',';
      return {
        ...baseSummary,
        delimiter,
        sampleRows: summarizeDelimitedFileRows(filePath, delimiter, options),
      };
    }
    return baseSummary;
  } catch (error) {
    return {
      ...baseSummary,
      warning: error instanceof Error ? error.message : String(error),
    };
  }
}

function summarizeWorkbookSheets(
  filePath: string,
  options: {
    maxSheetsPerFile: number;
    maxRowsPerSheet: number;
    maxColumnsPerRow: number;
  }
): DataInputTableSourceFileSummary['sheets'] {
  const workbook = readWorkbookFile(filePath, {
    sheetRows: Math.max(options.maxRowsPerSheet * 3, 24),
  });
  return workbook.SheetNames.slice(0, options.maxSheetsPerFile).map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const range = typeof sheet?.['!ref'] === 'string' ? sheet['!ref'] : null;
    const matrix = sheetToExpandedMatrix(sheet);
    const normalizedRows = matrix
      .slice(0, options.maxRowsPerSheet)
      .map((row) => summarizeRowValues(row, options.maxColumnsPerRow));
    const decodedRange = range ? XLSX.utils.decode_range(range) : null;
    const columnCountEstimate = decodedRange
      ? decodedRange.e.c - decodedRange.s.c + 1
      : Math.max(0, ...matrix.map((row) => row.length));
    const rowCountEstimate = decodedRange ? decodedRange.e.r - decodedRange.s.r + 1 : matrix.length;
    return {
      name: sheetName,
      range,
      mergeCount: Array.isArray(sheet?.['!merges']) ? sheet['!merges'].length : 0,
      mergedCells: summarizeWorkbookMergedCells(sheet, matrix),
      rowCountEstimate,
      columnCountEstimate,
      headerCandidates: detectHeaderCandidates(matrix, options.maxColumnsPerRow),
      sampleRows: normalizedRows,
    };
  });
}

function summarizeWorkbookMergedCells(
  sheet: XLSX.WorkSheet,
  expandedRows: Array<Array<string | number | boolean | null>>,
  maxMergedCells = 40
): DataInputTableExcelMergedCellSummary[] {
  const merges = Array.isArray(sheet['!merges']) ? sheet['!merges'] : [];
  return merges.slice(0, maxMergedCells).map((merge) => {
    const value = expandedRows[merge.s.r]?.[merge.s.c];
    return {
      range: XLSX.utils.encode_range(merge),
      startRow: merge.s.r + 1,
      endRow: merge.e.r + 1,
      startColumn: merge.s.c + 1,
      endColumn: merge.e.c + 1,
      value: value === null || value === undefined ? '' : String(value).replace(/\s+/g, ' ').trim(),
    };
  });
}

function readWorkbookFile(filePath: string, options: XLSX.ParsingOptions = {}): XLSX.WorkBook {
  return XLSX.read(fs.readFileSync(filePath), {
    cellDates: false,
    raw: false,
    type: 'buffer',
    ...options,
  });
}

function sheetToExpandedMatrix(
  sheet: XLSX.WorkSheet
): Array<Array<string | number | boolean | null>> {
  const matrix = XLSX.utils.sheet_to_json<Array<string | number | boolean | null>>(sheet, {
    header: 1,
    blankrows: false,
    defval: null,
    raw: false,
  });
  const expanded = matrix.map((row) => [...row]);
  const merges = Array.isArray(sheet['!merges']) ? sheet['!merges'] : [];
  for (const merge of merges) {
    const sourceValue = expanded[merge.s.r]?.[merge.s.c] ?? null;
    for (let rowIndex = merge.s.r; rowIndex <= merge.e.r; rowIndex += 1) {
      const row = expanded[rowIndex] ?? [];
      expanded[rowIndex] = row;
      for (let columnIndex = merge.s.c; columnIndex <= merge.e.c; columnIndex += 1) {
        if (
          row[columnIndex] === null ||
          row[columnIndex] === undefined ||
          row[columnIndex] === ''
        ) {
          row[columnIndex] = sourceValue;
        }
      }
    }
  }
  return expanded;
}

function summarizeDelimitedFileRows(
  filePath: string,
  delimiter: string,
  options: {
    maxRowsPerSheet: number;
    maxColumnsPerRow: number;
  }
): string[][] {
  const sampleText = readTextSample(filePath, 65_536);
  return sampleText
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, options.maxRowsPerSheet)
    .map((line) =>
      line
        .split(delimiter)
        .slice(0, options.maxColumnsPerRow)
        .map((cell) => cell.trim())
    );
}

function detectHeaderCandidates(
  rows: Array<Array<string | number | boolean | null>>,
  maxColumnsPerRow: number
): DataInputTableHeaderCandidate[] {
  return rows
    .map((row, index) => {
      const values = summarizeRowValues(row, maxColumnsPerRow);
      return {
        rowNumber: index + 1,
        nonEmptyCellCount: values.filter((value) => value.length > 0).length,
        values,
      };
    })
    .filter((candidate) => candidate.nonEmptyCellCount > 0)
    .sort((left, right) => right.nonEmptyCellCount - left.nonEmptyCellCount)
    .slice(0, 3)
    .sort((left, right) => left.rowNumber - right.rowNumber);
}

function summarizeRowValues(
  row: Array<string | number | boolean | null>,
  maxColumnsPerRow: number
): string[] {
  return row.slice(0, maxColumnsPerRow).map((value) => {
    if (value === null || value === undefined) return '';
    const text = String(value).replace(/\s+/g, ' ').trim();
    return text.length > 80 ? `${text.slice(0, 77)}...` : text;
  });
}

function readTextSample(filePath: string, maxBytes: number): string {
  const handle = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = fs.readSync(handle, buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    fs.closeSync(handle);
  }
}

function getSourceRelativePath(sourcePath: string, filePath: string): string {
  const sourceStat = fs.statSync(sourcePath);
  return sourceStat.isDirectory()
    ? relative(sourcePath, filePath) || basename(filePath)
    : basename(filePath);
}

function clampSummaryLimit(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(Number(value))));
}

function createStableJsonHash(value: unknown): string {
  return createStableTextHash(JSON.stringify(value, sortJsonKeys));
}

function createStableTextHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function sortJsonKeys(_key: string, value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
  );
}

function normalizeWorkbookColumns(row: Array<string | number | boolean | null>): string[] {
  const used = new Map<string, number>();
  return row.map((value, index) => {
    const rawName = value === null || value === undefined ? '' : String(value).trim();
    const baseName = rawName || `column_${index + 1}`;
    const nextCount = (used.get(baseName) ?? 0) + 1;
    used.set(baseName, nextCount);
    return nextCount === 1 ? baseName : `${baseName}_${nextCount}`;
  });
}

function normalizeWorkbookCell(
  value: string | number | boolean | null | undefined
): string | number | boolean | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function hasCellValue(value: string | number | boolean | null | undefined): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  return typeof value === 'string' ? value.trim().length > 0 : true;
}

function tableNameFromId(prefix: string, id: string): string {
  return `${prefix}_${id.replace(/[^A-Za-z0-9]/g, '_')}`;
}

function datasetNameFromPath(filePath: string): string {
  const name = basename(filePath);
  const extension = extname(name);
  return extension ? name.slice(0, -extension.length) : name;
}

function startOfToday(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
