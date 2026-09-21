import type {
  CloudOutputAction,
  DataCleaningTask,
  DataDataset,
  DataInputTableNormalizerArtifact,
  DataInputTableNormalizerArtifactVersion,
  DataNormalizerArtifactVersionStatus,
  DataNormalizerLanguage,
  DataOutputTable,
} from '../../../shared/contracts';
import type { ScheduleConfig, ScheduleWeekday } from '../../../shared/contracts/schedule';
import type { DatabaseInstance } from '../../db/database';
import { normalizeStatus, toNumber } from '../operators';
import {
  normalizeInputTableNormalizerSourceKind,
  normalizeStoredInputTableSourceKind,
  parseInputTableConfig,
} from './input-source';

export interface DataTaskStoreOptions {
  now?: () => number;
  metadataDb?: DatabaseInstance;
}

export const OUTPUT_TABLE_CONFIG_KIND = 'output_table';

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

export interface DataTaskRow {
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

export interface DataDatasetRow {
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

export interface DataInputTableNormalizerArtifactRow {
  id: string;
  name: string;
  description: string | null;
  source_kind: string;
  primary_language: string;
  active_version_id: string | null;
  created_at: number | string;
  updated_at: number | string;
}

export interface DataInputTableNormalizerArtifactVersionRow {
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

export interface DashboardSummaryRow {
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

export interface DataOutputCommitRow {
  id: string;
  task_id: string;
  temporary_table: string;
  target_table: string;
  backup_table: string;
  target_existed: number | string;
  state: string;
  intended_metadata_json: string;
  error: string | null;
  created_at: number | string;
  updated_at: number | string;
}

export interface DataTableCommitRow {
  id: string;
  dataset_id: string;
  operation: string;
  staging_table: string;
  target_table: string;
  backup_table: string | null;
  target_existed: number | string;
  state: string;
  error: string | null;
  created_at: number | string;
  updated_at: number | string;
}

export const LEGACY_DEMO_TASK_NAMES = [
  '用户行为数据清洗',
  '销售数据汇总',
  '营销数据集成',
  '日志数据处理',
  '第三方数据加载',
  '客户分群清洗',
  '订单异常值处理',
  '库存日报清洗',
];

export function mapTaskRow(row: DataTaskRow): DataCleaningTask {
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

export function mapDatasetRow(row: DataDatasetRow): DataDataset {
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

export function mapInputTableNormalizerArtifactRow(
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

export function isDuckDbTransactionStateError(message: string): boolean {
  return /TransactionContext|transaction is aborted|cannot start a transaction within a transaction/i.test(
    message
  );
}

export function mapInputTableNormalizerArtifactVersionRow(
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

export function mapOutputTableRow(row: DataDatasetRow): DataOutputTable {
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
    cloudAction: config.kind === OUTPUT_TABLE_CONFIG_KIND ? config.cloudAction : null,
  };
}

export function parseJsonField<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function normalizeNormalizerLanguage(value: string): DataNormalizerLanguage {
  if (value === 'python' || value === 'node') {
    return value;
  }
  return 'python';
}

export function normalizeNormalizerVersionStatus(
  value: string
): DataNormalizerArtifactVersionStatus {
  if (value === 'draft' || value === 'published' || value === 'archived') {
    return value;
  }
  return 'draft';
}

export function parseOutputTableConfig(value: string | null): {
  kind: string | null;
  sourceDatasetId: string | null;
  cloudAction: CloudOutputAction | null;
} {
  const empty = { kind: null, sourceDatasetId: null, cloudAction: null };
  if (!value) return empty;
  try {
    const parsed = JSON.parse(value) as {
      kind?: unknown;
      sourceDatasetId?: unknown;
      cloudAction?: unknown;
      cloudDriveTarget?: unknown;
    };
    return {
      kind: typeof parsed.kind === 'string' && parsed.kind.trim() ? parsed.kind.trim() : null,
      sourceDatasetId:
        typeof parsed.sourceDatasetId === 'string' && parsed.sourceDatasetId.trim()
          ? parsed.sourceDatasetId.trim()
          : null,
      cloudAction:
        parseCloudOutputAction(parsed.cloudAction) ??
        parseLegacyCloudDriveTarget(parsed.cloudDriveTarget),
    };
  } catch {
    return empty;
  }
}

export function parseCloudOutputAction(value: unknown): CloudOutputAction | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const spaceId = typeof raw.spaceId === 'string' ? raw.spaceId.trim() : '';
  const projectId = typeof raw.projectId === 'string' ? raw.projectId.trim() : '';
  const type = raw.type === 'cloud_table' || raw.type === 'drive_file' ? raw.type : null;
  const trigger = raw.trigger === 'on_change' || raw.trigger === 'schedule' ? raw.trigger : null;
  if (!spaceId || !projectId || !type || !trigger) return null;
  const result: CloudOutputAction = { type, trigger, spaceId, projectId };
  const schedule = parseCloudActionSchedule(raw.schedule);
  if (schedule) {
    result.schedule = schedule;
  } else if (
    typeof raw.intervalMinutes === 'number' &&
    Number.isFinite(raw.intervalMinutes) &&
    raw.intervalMinutes > 0
  ) {
    result.schedule = { kind: 'daily', times: ['09:00'] };
  }
  if (typeof raw.fileId === 'string' && raw.fileId.trim()) {
    result.fileId = raw.fileId.trim();
  }
  if (typeof raw.fileName === 'string' && raw.fileName.trim()) {
    result.fileName = raw.fileName.trim();
  }
  if (typeof raw.version === 'number' && Number.isFinite(raw.version)) {
    result.version = raw.version;
  }
  if (typeof raw.tableId === 'string' && raw.tableId.trim()) {
    result.tableId = raw.tableId.trim();
  }
  if (typeof raw.tableName === 'string' && raw.tableName.trim()) {
    result.tableName = raw.tableName.trim();
  }
  if (raw.writeMode === 'CREATE' || raw.writeMode === 'REPLACE') {
    result.writeMode = raw.writeMode;
  }
  if (typeof raw.lastRunAt === 'number' && Number.isFinite(raw.lastRunAt)) {
    result.lastRunAt = raw.lastRunAt;
  }
  if (typeof raw.lastError === 'string' && raw.lastError.trim()) {
    result.lastError = raw.lastError;
  }
  return result;
}

function parseCloudActionSchedule(value: unknown): ScheduleConfig | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const times = Array.isArray(raw.times)
    ? Array.from(
        new Set(
          raw.times.filter(
            (time): time is string =>
              typeof time === 'string' && /^([01]\d|2[0-3]):([0-5]\d)$/.test(time)
          )
        )
      ).sort()
    : [];
  if (times.length === 0) return null;
  if (raw.kind === 'daily') {
    return { kind: 'daily', times };
  }
  if (raw.kind === 'weekly') {
    const weekdays = Array.isArray(raw.weekdays)
      ? Array.from(
          new Set(
            raw.weekdays.filter(
              (day): day is ScheduleWeekday =>
                Number.isInteger(day) && (day as number) >= 0 && (day as number) <= 6
            )
          )
        ).sort((a, b) => a - b)
      : [];
    return weekdays.length ? { kind: 'weekly', weekdays, times } : null;
  }
  if (raw.kind === 'monthly') {
    const daysOfMonth = Array.isArray(raw.daysOfMonth)
      ? Array.from(
          new Set(
            raw.daysOfMonth.filter(
              (day): day is number =>
                Number.isInteger(day) && (day as number) >= 1 && (day as number) <= 31
            )
          )
        ).sort((a, b) => a - b)
      : [];
    const includeLastDay = raw.includeLastDay === true;
    if (!daysOfMonth.length && !includeLastDay) return null;
    return { kind: 'monthly', daysOfMonth, includeLastDay, times };
  }
  return null;
}

function parseLegacyCloudDriveTarget(value: unknown): CloudOutputAction | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const spaceId = typeof raw.spaceId === 'string' ? raw.spaceId.trim() : '';
  const projectId = typeof raw.projectId === 'string' ? raw.projectId.trim() : '';
  if (!spaceId || !projectId) return null;
  const action: CloudOutputAction = {
    type: 'drive_file',
    trigger: 'on_change',
    spaceId,
    projectId,
  };
  if (typeof raw.fileId === 'string' && raw.fileId.trim()) action.fileId = raw.fileId.trim();
  if (typeof raw.fileName === 'string' && raw.fileName.trim())
    action.fileName = raw.fileName.trim();
  if (typeof raw.version === 'number' && Number.isFinite(raw.version)) action.version = raw.version;
  if (typeof raw.lastSyncAt === 'number' && Number.isFinite(raw.lastSyncAt)) {
    action.lastRunAt = raw.lastSyncAt;
  }
  if (typeof raw.lastError === 'string' && raw.lastError.trim()) action.lastError = raw.lastError;
  return action;
}

export function parseRelatedTaskNames(value: string | null | undefined): string[] {
  if (!value) return [];
  return value.split('\u001F').filter(Boolean).slice(0, 2);
}

export function storedDatasetSourceKindSql(alias?: string): string {
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

export function outputTableConfigPredicateSql(alias?: string): string {
  const prefix = alias ? `${alias}.` : '';
  return `
    ${storedDatasetSourceKindSql(alias)} = 'output'
    AND coalesce(${prefix}config_json, '') LIKE '%"kind":"${OUTPUT_TABLE_CONFIG_KIND}"%'
  `;
}

export function outputTableConfigJson(
  sourceDatasetId?: string | null,
  cloudAction?: CloudOutputAction | null
): string {
  const config: {
    kind: string;
    sourceDatasetId?: string;
    cloudAction?: CloudOutputAction;
  } = {
    kind: OUTPUT_TABLE_CONFIG_KIND,
  };
  if (sourceDatasetId) {
    config.sourceDatasetId = sourceDatasetId;
  }
  if (cloudAction) {
    config.cloudAction = cloudAction;
  }
  return JSON.stringify(config);
}

export function isLegacyExplicitOutputTableRow(row: DataDatasetRow): boolean {
  const tableName = String(row.table_name);
  const sourcePath = String(row.source_path);
  return (
    tableName.startsWith('output_') &&
    (sourcePath === `duckdb://outputs/${tableName}` || sourcePath.startsWith('input-table://'))
  );
}

export function tableNameFromId(prefix: string, id: string): string {
  return `${prefix}_${id.replace(/[^A-Za-z0-9]/g, '_')}`;
}

export function startOfToday(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
