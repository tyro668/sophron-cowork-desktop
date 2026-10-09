import { createHash } from 'crypto';
import {
  cloudInputSyncSchema,
  cloudOutputSyncSchema,
  type CloudInputSyncConfig,
  type CloudOutputSyncConfig,
} from '../../shared/automation/cloud-sync';
import { appendCloudCsv } from './cloud-drive-csv';
import { DataCommandLockCoordinator } from './data-command-lock-coordinator';
import { hasPersonalAnalysisConnection } from '../../shared/personal-analysis';
import { mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { DataTaskStore } from './data-task-store';
import {
  DataCommandError,
  type CreateInputTableCommand,
  type UpdateInputTableCommand,
  type ImportCloudTableCommand,
  type ImportCloudTableResult,
  type InputTableResult,
  type ListCloudDriveFilesCommand,
  type ListCloudDriveFilesResult,
  type ListCloudProjectsCommand,
  type ListCloudProjectsResult,
  type ListCloudSpacesCommand,
  type ListCloudSpacesResult,
  type ListCloudTablesCommand,
  type ListCloudTablesResult,
  type PreviewCloudDriveFileCommand,
  type PreviewCloudDriveFileResult,
  type PreviewCloudTableCommand,
  type PreviewCloudTableResult,
  type RefreshCloudInputTableCommand,
  type RefreshCloudInputTableResult,
  type SearchCloudTablesCommand,
  type SearchCloudTablesResult,
  type UploadDataTableToCloudCommand,
  type UploadDataTableToCloudResult,
} from './data-command-types';
import {
  createPersonalAnalysisClient,
  type PersonalAnalysisClient,
} from './personal-analysis-client';
import type {
  PersonalAnalysisConnectionInput,
  PersonalAnalysisDatasource,
  StoredPersonalAnalysisConfig,
} from '../../shared/personal-analysis-types';
import type {
  DataInputTableConfig,
  DataInputTableCloudConfig,
  DataInputTablePreview,
} from '../../shared/contracts';

const DEFAULT_PREVIEW_LIMIT = 20;
const MAX_PREVIEW_LIMIT = 100;

export interface CloudAnalysisCommandServiceOptions {
  onPersonalAnalysisKeyRejected?: (connection: StoredPersonalAnalysisConfig) => void;
  getPersonalAnalysisConnection?: (
    rejectedAccessToken?: string
  ) => PersonalAnalysisConnectionInput | null | Promise<PersonalAnalysisConnectionInput | null>;
  updateInputTable?: (input: UpdateInputTableCommand) => Promise<InputTableResult>;
  createInputTable: (input: CreateInputTableCommand) => Promise<InputTableResult>;
  /**
   * Stable directory for downloaded cloud snapshots. Recorded as the input
   * table's `sourcePath` so reimports keep working after OS temp cleanup.
   * Defaults to the system temp directory (tests/in-memory stores).
   */
  cloudImportDir?: string;
}

export class CloudAnalysisCommandService {
  private readonly locks = new DataCommandLockCoordinator();
  constructor(
    private readonly store: DataTaskStore,
    private readonly getPersonalAnalysisConfig: () => StoredPersonalAnalysisConfig,
    private readonly options: CloudAnalysisCommandServiceOptions
  ) {}

  async listCloudSpaces(input: ListCloudSpacesCommand = {}): Promise<ListCloudSpacesResult> {
    try {
      const client = await this.createPersonalAnalysisClient(input);
      return {
        spaces: await client.listSpaces(),
      };
    } catch (error) {
      throw toCommandError(error, 'RUN_FAILED');
    }
  }

  async listCloudProjects(input: ListCloudProjectsCommand): Promise<ListCloudProjectsResult> {
    const spaceId = normalizeRequiredName(input.spaceId, 'Cloud spaceId is required');
    try {
      const client = await this.createPersonalAnalysisClient(input);
      return {
        projects: await client.listProjects(spaceId),
      };
    } catch (error) {
      throw toCommandError(error, 'RUN_FAILED');
    }
  }

  async listCloudTables(input: ListCloudTablesCommand): Promise<ListCloudTablesResult> {
    const spaceId = normalizeRequiredName(input.spaceId, 'Cloud spaceId is required');
    const projectId = normalizeRequiredName(input.projectId, 'Cloud projectId is required');
    try {
      const client = await this.createPersonalAnalysisClient(input);
      return await client.listTables(spaceId, projectId, {
        keyword: input.keyword,
        page: input.page,
        pageSize: input.pageSize,
        sortBy: input.sortBy,
        sortOrder: input.sortOrder,
      });
    } catch (error) {
      throw toCommandError(error, 'RUN_FAILED');
    }
  }

  async searchCloudTables(input: SearchCloudTablesCommand): Promise<SearchCloudTablesResult> {
    const keyword = normalizeRequiredName(input.keyword, 'Cloud table search keyword is required');
    try {
      const client = await this.createPersonalAnalysisClient(input);
      return await client.searchTables({
        keyword,
        spaceId: input.spaceId,
        projectId: input.projectId,
        matchField: input.matchField,
        page: input.page,
        pageSize: input.pageSize,
        sortBy: input.sortBy,
        sortOrder: input.sortOrder,
      });
    } catch (error) {
      throw toCommandError(error, 'RUN_FAILED');
    }
  }

  async importCloudTable(input: ImportCloudTableCommand): Promise<ImportCloudTableResult> {
    const tableId = normalizeRequiredName(input.tableId, 'Cloud tableId is required');
    const existing = input.inputTableId
      ? await this.store.getInputTableRecord(input.inputTableId)
      : null;
    if (input.inputTableId && !existing)
      throw new DataCommandError(
        'RESOURCE_NOT_FOUND',
        `Input table not found: ${input.inputTableId}`
      );
    if (existing && !this.options.updateInputTable)
      throw new Error('Input table sync is unavailable');
    const client = await this.createPersonalAnalysisClient(input);
    try {
      const cloudTable =
        input.spaceId && input.projectId
          ? await client.findTable(input.spaceId, input.projectId, tableId)
          : undefined;
      if (input.spaceId && input.projectId && !cloudTable) {
        throw new DataCommandError(
          'RESOURCE_NOT_FOUND',
          'Cloud table not found in the selected project'
        );
      }
      const csv = await client.exportTableCsv(tableId);
      const downloadedFilePath = await this.writeCloudSnapshotFile(tableId, csv);
      const command = {
        name:
          normalizeOptionalName(input.name) ||
          existing?.name ||
          cloudTable?.tableName ||
          `Cloud table ${tableId}`,
        sourceKind: 'cloud' as const,
        filePath: downloadedFilePath,
        previewRows: input.previewRows,
        config: buildCloudTableConfig(existing?.inputConfig, {
          contentHash: createHash('sha256').update(csv).digest('hex'),
          tableId,
          spaceId: normalizeOptionalName(input.spaceId),
          projectId: normalizeOptionalName(input.projectId),
          spaceName: normalizeOptionalName(input.spaceName),
          projectName: normalizeOptionalName(input.projectName),
          tableKind: cloudTable?.kind,
          tableName: cloudTable?.tableName ?? normalizeOptionalName(input.name),
          sourceVersion: cloudTable?.updatedAt,
        }),
      };
      const result = existing
        ? await this.options.updateInputTable!({ ...command, id: existing.id })
        : await this.options.createInputTable(command);
      return {
        ...result,
        cloudTableId: tableId,
        cloudTable,
        downloadedFilePath,
      };
    } catch (error) {
      throw toCommandError(error, 'RUN_FAILED');
    }
  }

  async previewCloudTable(input: PreviewCloudTableCommand): Promise<PreviewCloudTableResult> {
    const tableId = normalizeRequiredName(input.tableId, 'Cloud tableId is required');
    const limit =
      typeof input.limit === 'number' && Number.isFinite(input.limit)
        ? Math.min(Math.max(Math.floor(input.limit), 1), MAX_PREVIEW_LIMIT)
        : DEFAULT_PREVIEW_LIMIT;
    const offset =
      typeof input.offset === 'number' && Number.isFinite(input.offset)
        ? Math.max(Math.floor(input.offset), 0)
        : 0;
    try {
      const client = await this.createPersonalAnalysisClient(input);
      const csv = await client.exportTableCsv(tableId);
      const downloadedFilePath = await this.writeCloudSnapshotFile(tableId, csv);
      const preview = await this.store.previewInputTable({
        filePath: downloadedFilePath,
        sourceKind: 'csv',
        config: {
          sourceKind: 'csv',
          header: 'auto',
          dataRegion: 'auto',
          encoding: 'auto',
          delimiter: 'auto',
        },
        limit,
        offset,
      });
      return {
        cloudTableId: tableId,
        downloadedFilePath,
        preview,
      };
    } catch (error) {
      throw toCommandError(error, 'RUN_FAILED');
    }
  }

  async listCloudDriveFiles(input: ListCloudDriveFilesCommand): Promise<ListCloudDriveFilesResult> {
    const spaceId = normalizeRequiredName(input.spaceId, 'Cloud spaceId is required');
    const projectId = normalizeRequiredName(input.projectId, 'Cloud projectId is required');
    try {
      const client = await this.createPersonalAnalysisClient(input);
      return await client.listDriveFiles(spaceId, projectId, {
        keyword: input.keyword,
        fileType: input.fileType,
        page: input.page,
        pageSize: input.pageSize,
      });
    } catch (error) {
      throw toCommandError(error, 'RUN_FAILED');
    }
  }

  async previewCloudDriveFile(
    input: PreviewCloudDriveFileCommand
  ): Promise<PreviewCloudDriveFileResult> {
    const spaceId = normalizeRequiredName(input.spaceId, 'Cloud spaceId is required');
    const projectId = normalizeRequiredName(input.projectId, 'Cloud projectId is required');
    const fileId = normalizeRequiredName(input.fileId, 'Cloud fileId is required');
    try {
      const client = await this.createPersonalAnalysisClient(input);
      const result = await client.previewDriveFile(spaceId, projectId, fileId, input.sheetName);
      return { file: result.file, preview: driveFilePreviewToDataPreview(result) };
    } catch (error) {
      throw toCommandError(error, 'RUN_FAILED');
    }
  }

  async syncInputTableFromCloud(
    raw: CloudInputSyncConfig,
    syncKey: string
  ): Promise<{ inputTableId: string; inputTableName: string }> {
    const config = cloudInputSyncSchema.parse(raw);
    return this.locks.withKeyedLock(`input:${config.inputTableId || syncKey}`, async () => {
      const client = await this.createPersonalAnalysisClient({});
      const source = await client.findTable(config.spaceId, config.projectId, config.tableId);
      if (!source || source.kind !== config.tableKind)
        throw new DataCommandError(
          'INVALID_ARGUMENT',
          'Select an analysis table or base table in the configured project'
        );
      // The creation marker is committed with the dataset, so recovery after a
      // process exit cannot create a second input or overwrite a same-name table.
      const existing = config.inputTableId
        ? await this.store.getInputTableRecord(config.inputTableId)
        : await this.store.findInputTableByAutomationSyncKey(syncKey);
      if (config.inputTableId && !existing)
        throw new DataCommandError(
          'RESOURCE_NOT_FOUND',
          `Input table not found: ${config.inputTableId}`
        );
      const csv = await client.exportTableCsv(config.tableId);
      const filePath = await this.writeCloudSnapshotFile(config.tableId, csv);
      const inputConfig = buildCloudTableConfig(existing?.inputConfig, {
        contentHash: createHash('sha256').update(csv).digest('hex'),
        tableId: config.tableId,
        spaceId: config.spaceId,
        projectId: config.projectId,
        tableKind: source.kind ?? config.tableKind,
        tableName: source.tableName ?? config.tableName,
        sourceVersion: source.updatedAt,
        automationSyncKey: syncKey,
      });
      if (existing && !this.options.updateInputTable)
        throw new Error('Input table sync is unavailable');
      const result = existing
        ? await this.options.updateInputTable!({
            id: existing.id,
            sourceKind: 'cloud',
            filePath,
            config: inputConfig,
          })
        : await this.options.createInputTable({
            name: config.inputTableName,
            sourceKind: 'cloud',
            filePath,
            config: inputConfig,
          });
      return { inputTableId: result.inputTable.id, inputTableName: result.inputTable.name };
    });
  }

  async refreshCloudInputTable(
    input: RefreshCloudInputTableCommand
  ): Promise<RefreshCloudInputTableResult> {
    const inputTableId = normalizeRequiredName(
      input.inputTableId,
      'Cloud inputTableId is required'
    );
    const existing = await this.store.getInputTableRecord(inputTableId);
    if (!existing) {
      throw new DataCommandError('RESOURCE_NOT_FOUND', `Input table not found: ${inputTableId}`);
    }
    const mirror =
      existing.inputConfig.sourceKind === 'cloud' || existing.inputConfig.sourceKind === 'csv'
        ? existing.inputConfig.cloudMirror
        : undefined;
    if (!mirror) {
      throw new DataCommandError('INVALID_ARGUMENT', 'Input table is not linked to a cloud table');
    }
    const spaceId = normalizeOptionalName(mirror.spaceId);
    const projectId = normalizeOptionalName(mirror.projectId);
    if (!spaceId || !projectId) {
      throw new DataCommandError(
        'INVALID_ARGUMENT',
        'Cloud source linkage is incomplete; re-import the table from the Cloud Space panel'
      );
    }
    const client = await this.createPersonalAnalysisClient(input);
    let tableKind = mirror.tableKind;
    if (!tableKind) {
      const source = await client.findTable(spaceId, projectId, mirror.tableId);
      if (!source?.kind) {
        throw new DataCommandError(
          'INVALID_ARGUMENT',
          'Cloud source linkage is incomplete; re-import the table from the Cloud Space panel'
        );
      }
      tableKind = source.kind;
    }
    const result = await this.syncInputTableFromCloud(
      {
        spaceId,
        projectId,
        tableId: mirror.tableId,
        tableKind,
        tableName: mirror.tableName,
        inputTableId,
      },
      mirror.automationSyncKey ?? `cloud-import:${inputTableId}`
    );
    const refreshed = await this.store.getInputTableRecord(result.inputTableId);
    if (!refreshed) {
      throw new DataCommandError(
        'INTERNAL_ERROR',
        `Input table disappeared during refresh: ${inputTableId}`
      );
    }
    return { inputTable: refreshed };
  }

  async syncOutputTableToCloud(
    outputTableId: string,
    raw: CloudOutputSyncConfig,
    syncKey = `cowork-output-${outputTableId}`,
    beforeWrite?: (version: number) => void
  ): Promise<Partial<CloudOutputSyncConfig>> {
    const action = cloudOutputSyncSchema.parse(raw);
    if (outputTableId !== action.outputTableId)
      throw new Error('Output table binding does not match');
    const outputTable = await this.store.getOutputTableRecord(outputTableId);
    if (!outputTable)
      throw new DataCommandError('RESOURCE_NOT_FOUND', `Output table not found: ${outputTableId}`);
    const exported = await this.store.exportDatasetCsv({ tableKind: 'output', id: outputTableId });
    const client = await this.createPersonalAnalysisClient({});
    let csvContent = exported.csv;
    let version = action.version;
    if (action.fileId) {
      const { file } = await client.previewDriveFile(
        action.spaceId,
        action.projectId,
        action.fileId
      );
      if (file.fileType !== 'csv' || file.writable === false)
        throw new Error('Only writable CSV drive files can receive output tables');
      if (!Number.isInteger(file.version)) throw new Error('Drive file version is unavailable');
      if (version !== undefined && version !== file.version)
        throw new Error(
          'Drive file changed since the last sync; select the file again to refresh its version'
        );
      version = file.version!;
      if (action.writeMode === 'append') {
        const csv = await client.downloadDriveCsv(action.spaceId, action.projectId, action.fileId);
        csvContent = appendCloudCsv(csv, exported.csv);
      }
      // Persist the base version BEFORE a remote append. An ambiguous write or
      // restart then fails on a version conflict instead of appending twice.
      beforeWrite?.(version);
    }
    const name = action.fileName || sanitizeFileName(outputTable.name);
    const result = await client.syncDriveCsv(action.spaceId, action.projectId, {
      fileId: action.fileId,
      outputId: syncKey,
      fileName: action.fileId ? undefined : /\.csv$/i.test(name) ? name : `${name}.csv`,
      expectedVersion: action.fileId ? version : 0,
      csvContent,
    });
    return {
      fileId: result.file.fileId,
      fileName: result.file.fileName,
      version: result.file.version,
      writeMode: action.writeMode === 'append' ? 'append' : 'replace',
    };
  }

  async uploadDataTableToCloud(
    input: UploadDataTableToCloudCommand
  ): Promise<UploadDataTableToCloudResult> {
    if (input.writeMode === 'REPLACE' && !input.tableId?.trim()) {
      throw new DataCommandError('INVALID_ARGUMENT', 'tableId is required for REPLACE upload');
    }
    if (input.writeMode === 'CREATE' && input.tableId?.trim()) {
      throw new DataCommandError('INVALID_ARGUMENT', 'tableId must be omitted for CREATE upload');
    }
    const exported = await this.store.exportDatasetCsv({
      tableKind: input.tableKind,
      id: input.id,
      maxRows: input.maxRows,
    });
    const tableName = normalizeOptionalName(input.tableName) || exported.name;
    const fileName =
      normalizeOptionalName(input.fileName) || `${sanitizeFileName(tableName || exported.id)}.csv`;

    try {
      const client = await this.createPersonalAnalysisClient(input);
      const datasourceId = await this.resolveUploadDatasourceId(client, input.datasourceId);
      const upload = await client.uploadCsv({
        ...input,
        datasourceId,
        fileName,
        tableName,
        csv: exported.csv,
      });
      return {
        sourceTable: {
          tableKind: exported.tableKind,
          id: exported.id,
          name: exported.name,
          rowCount: exported.rowCount,
          columnCount: exported.columnCount,
        },
        csvBytes: Buffer.byteLength(exported.csv, 'utf8'),
        upload,
      };
    } catch (error) {
      throw toCommandError(error, 'RUN_FAILED');
    }
  }

  /**
   * Downloads land in a stable per-store directory (not tmpdir) so the recorded
   * `sourcePath` survives OS temp cleanup and reimports stay re-runnable.
   * Files are keyed by cloud table id — each sync overwrites the latest snapshot.
   */
  private async writeCloudSnapshotFile(tableId: string, csv: string): Promise<string> {
    const directory = this.options.cloudImportDir ?? join(tmpdir(), 'sophron-cowork-cloud-imports');
    await mkdir(directory, { recursive: true });
    const filePath = join(directory, `cloud-${sanitizeFileName(tableId)}.csv`);
    await writeFile(filePath, csv, 'utf8');
    return filePath;
  }

  private async createPersonalAnalysisClient(input: PersonalAnalysisConnectionInput = {}) {
    const configured = this.getPersonalAnalysisConfig();
    const mode =
      input.connectionMode ??
      (input.accessToken
        ? 'account'
        : input.apiKey || hasPersonalAnalysisConnection(configured)
          ? 'apiKey'
          : 'account');
    if (mode === 'apiKey') {
      return createPersonalAnalysisClient({
        apiOrigin: input.apiOrigin || configured.apiOrigin,
        apiKey: input.apiKey || configured.apiKey,
        onApiKeyRejected: () => {
          if (
            (!input.apiKey || input.apiKey === configured.apiKey) &&
            (!input.apiOrigin || input.apiOrigin === configured.apiOrigin)
          ) {
            this.options.onPersonalAnalysisKeyRejected?.(configured);
          }
        },
      });
    }
    // Account requests never fall back to an API key or its service address.
    if (input.accessToken) {
      return createPersonalAnalysisClient({
        apiOrigin: input.apiOrigin,
        accessToken: input.accessToken,
      });
    }
    const resolveConnection = this.options.getPersonalAnalysisConnection;
    const authenticated = await resolveConnection?.();
    if (!authenticated?.accessToken || !authenticated.apiOrigin) {
      throw new DataCommandError('RUN_FAILED', 'Please sign in before accessing cloud analysis');
    }
    if (
      input.apiOrigin &&
      new URL(input.apiOrigin).origin !== new URL(authenticated.apiOrigin).origin
    ) {
      throw new DataCommandError(
        'RUN_FAILED',
        'Account service origin does not match the login session'
      );
    }
    return createPersonalAnalysisClient({
      apiOrigin: authenticated.apiOrigin,
      getAccessToken: async (rejectedAccessToken?: string) => {
        const connection = await resolveConnection?.(rejectedAccessToken);
        if (!connection?.accessToken || connection.apiOrigin !== authenticated.apiOrigin) {
          throw new Error('Login session changed; please reconnect');
        }
        return connection.accessToken;
      },
    });
  }

  private async resolveUploadDatasourceId(
    client: PersonalAnalysisClient,
    datasourceId: string | undefined
  ): Promise<string> {
    const explicitDatasourceId = datasourceId?.trim();
    if (explicitDatasourceId) {
      return explicitDatasourceId;
    }

    const datasources = await client.listDatasources();
    if (datasources.length === 0) {
      throw new Error(
        'No Cloud Space datasource is available for upload. Choose a project with an available datasource or pass datasourceId.'
      );
    }

    if (datasources.length === 1) {
      return datasources[0].datasourceId;
    }

    throw new Error(
      `Multiple Cloud Space datasources are available: ${datasources
        .map(formatDatasourceForError)
        .join(', ')}. Pass datasourceId for this upload.`
    );
  }
}

function driveFilePreviewToDataPreview(result: {
  file: { sheets?: Array<{ name: string; rowCount: number; columnCount: number }> };
  sheetName: string;
  rows: unknown[][];
}): DataInputTablePreview {
  const sheet =
    result.file.sheets?.find((item) => item.name === result.sheetName) ?? result.file.sheets?.[0];
  const headerRow = Array.isArray(result.rows[0]) ? result.rows[0] : [];
  const columnCount = sheet?.columnCount ?? headerRow.length;
  const columns = Array.from(
    { length: columnCount },
    (_, index) => String(headerRow[index] ?? '').trim() || `col_${index + 1}`
  );
  const dataRows = result.rows.slice(1);
  return {
    columns,
    columnTypes: columns.map((name) => ({ name, type: 'text', storageType: 'VARCHAR' })),
    rows: dataRows.map((row) => {
      const record: Record<string, string | number | boolean | null> = {};
      columns.forEach((name, index) => {
        const value = Array.isArray(row) ? row[index] : null;
        record[name] =
          value === null || value === undefined
            ? null
            : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
              ? value
              : String(value);
      });
      return record;
    }),
    fileCount: 1,
    limit: dataRows.length,
    offset: 0,
    totalRows: dataRows.length,
  };
}

interface CloudTableSourceInput {
  contentHash: string;
  tableId: string;
  spaceId?: string;
  projectId?: string;
  spaceName?: string;
  projectName?: string;
  tableKind?: 'base' | 'analysis';
  tableName?: string;
  sourceVersion?: string;
  automationSyncKey?: string;
}

function buildCloudTableConfig(
  existing: DataInputTableConfig | undefined,
  mirror: CloudTableSourceInput
): DataInputTableCloudConfig {
  const previous =
    existing?.sourceKind === 'cloud' || existing?.sourceKind === 'csv'
      ? existing.cloudMirror
      : undefined;
  const sameSource =
    previous?.tableId === mirror.tableId &&
    previous?.spaceId === mirror.spaceId &&
    previous?.projectId === mirror.projectId;
  const cloudMirror: DataInputTableCloudConfig['cloudMirror'] = {
    ...(sameSource ? previous : {}),
    tableId: mirror.tableId,
    contentHash: mirror.contentHash,
    syncedAt: Date.now(),
  };
  if (mirror.spaceId) cloudMirror.spaceId = mirror.spaceId;
  if (mirror.projectId) cloudMirror.projectId = mirror.projectId;
  if (mirror.spaceName) cloudMirror.spaceName = mirror.spaceName;
  if (mirror.projectName) cloudMirror.projectName = mirror.projectName;
  if (mirror.tableKind) cloudMirror.tableKind = mirror.tableKind;
  if (mirror.tableName) cloudMirror.tableName = mirror.tableName;
  if (mirror.sourceVersion) cloudMirror.sourceVersion = mirror.sourceVersion;
  if (mirror.automationSyncKey) cloudMirror.automationSyncKey = mirror.automationSyncKey;
  return {
    sourceKind: 'cloud',
    ...(existing?.dataProcessing ? { dataProcessing: existing.dataProcessing } : {}),
    cloudMirror,
  };
}

function sanitizeFileName(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return sanitized || 'table';
}

function normalizeOptionalName(name: string | undefined): string | undefined {
  const normalized = name?.trim();
  return normalized || undefined;
}

function normalizeRequiredName(name: string, message: string): string {
  const normalized = name.trim();
  if (!normalized) {
    throw new DataCommandError('INVALID_ARGUMENT', message);
  }
  return normalized;
}

function formatDatasourceForError(datasource: PersonalAnalysisDatasource): string {
  return datasource.datasourceName
    ? `${datasource.datasourceName} (${datasource.datasourceId})`
    : datasource.datasourceId;
}

function toCommandError(error: unknown, fallbackCode: DataCommandError['code']): DataCommandError {
  if (error instanceof DataCommandError) {
    return error;
  }
  const status = getErrorStatus(error);
  const apiCode = getErrorApiCode(error);
  const message = error instanceof Error ? error.message : String(error);
  if (
    /TransactionContext|transaction is aborted|cannot start a transaction within a transaction/i.test(
      message
    )
  ) {
    return new DataCommandError('RUN_FAILED', message);
  }
  if (status === 404) {
    return new DataCommandError('RESOURCE_NOT_FOUND', message, {
      status,
      code: apiCode,
    });
  }
  if (
    /source|file|folder|path|unsupported|does not exist/i.test(message) &&
    fallbackCode === 'FILE_ACCESS_DENIED'
  ) {
    return new DataCommandError('FILE_ACCESS_DENIED', message);
  }
  if (/\bRESOURCE_NOT_FOUND\b|\bHTTP 404\b/i.test(message)) {
    return new DataCommandError('RESOURCE_NOT_FOUND', message);
  }
  return new DataCommandError(fallbackCode, message || 'Data command failed');
}

function getErrorStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown })?.status;
  return typeof status === 'number' && Number.isFinite(status) ? status : undefined;
}

function getErrorApiCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' && code ? code : undefined;
}
