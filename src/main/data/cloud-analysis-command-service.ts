import { mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { DataTaskStore } from './data-task-store';
import {
  DataCommandError,
  type CreateInputTableCommand,
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
  type RunOutputTableCloudActionCommand,
  type RunOutputTableCloudActionResult,
  type SearchCloudTablesCommand,
  type SearchCloudTablesResult,
  type SetOutputTableCloudActionCommand,
  type UploadDataTableToCloudCommand,
  type UploadDataTableToCloudResult,
} from './data-command-types';
import {
  createPersonalAnalysisClient,
  type PersonalAnalysisClient,
} from './personal-analysis-client';
import type {
  CloudOutputAction,
  CloudOutputActionSpec,
  PersonalAnalysisConnectionInput,
  PersonalAnalysisDatasource,
  StoredPersonalAnalysisConfig,
} from '../../shared/personal-analysis-types';
import type { DataInputTablePreview, DataOutputTable } from '../../shared/contracts';
import { calendarCronPatterns } from '../schedule/calendar-schedule';
import { Cron } from 'croner';
import { normalizeScheduleConfig } from '../schedule/scheduled-task-manager';

const DEFAULT_PREVIEW_LIMIT = 20;
const MAX_PREVIEW_LIMIT = 100;

export interface CloudAnalysisCommandServiceOptions {
  getPersonalAnalysisConnection?: (
    rejectedAccessToken?: string
  ) => PersonalAnalysisConnectionInput | null | Promise<PersonalAnalysisConnectionInput | null>;
  createInputTable: (input: CreateInputTableCommand) => Promise<InputTableResult>;
}

export class CloudAnalysisCommandService {
  private readonly outputActionQueues = new Map<string, Promise<unknown>>();
  private readonly pendingOutputActions = new Map<string, CloudOutputAction>();
  private readonly outputActionJobs = new Map<string, Cron[]>();
  private actionTimersArmed = false;
  private actionTimersArming: Promise<void> | null = null;
  private actionTimerRetry: NodeJS.Timeout | null = null;

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
    const client = await this.createPersonalAnalysisClient(input);
    try {
      const cloudTable =
        input.spaceId && input.projectId
          ? await client.findTable(input.spaceId, input.projectId, tableId)
          : undefined;
      const csv = await client.exportTableCsv(tableId);
      const downloadedFilePath = await writeCloudCsvTempFile(tableId, csv);
      const result = await this.options.createInputTable({
        name:
          normalizeOptionalName(input.name) || cloudTable?.tableName || `Cloud table ${tableId}`,
        sourceKind: 'csv',
        filePath: downloadedFilePath,
        previewRows: input.previewRows,
      });
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
      const downloadedFilePath = await writeCloudCsvTempFile(tableId, csv);
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

  async setOutputTableCloudAction(
    input: SetOutputTableCloudActionCommand
  ): Promise<{ outputTable: DataOutputTable }> {
    const outputTableId = normalizeRequiredName(input.outputTableId, 'outputTableId is required');
    const action = input.action ? this.normalizeOutputAction(input.action) : null;
    return this.enqueueOutputAction(outputTableId, async () => {
      try {
        const outputTable = await this.store.updateOutputTableCloudAction(outputTableId, action);
        this.pendingOutputActions.delete(outputTableId);
        this.rearmActionTimer(outputTableId, action);
        return { outputTable };
      } catch (error) {
        throw toCommandError(error, 'RUN_FAILED');
      }
    });
  }

  async runOutputTableCloudAction(
    input: RunOutputTableCloudActionCommand
  ): Promise<RunOutputTableCloudActionResult> {
    const outputTableId = normalizeRequiredName(input.outputTableId, 'outputTableId is required');
    return this.enqueueOutputAction(outputTableId, () =>
      this.executeOutputAction(outputTableId, input)
    );
  }

  /**
   * Post-commit hook: run every committed output table's cloud action whose
   * trigger is `on_change`. Best-effort — failures persist lastError on the
   * action and never fail the task run.
   */
  runCommittedOutputActions(outputDatasetIds: string[]): void {
    void this.ensureActionTimersArmed();
    for (const outputTableId of outputDatasetIds) {
      void this.enqueueOutputAction(outputTableId, async () => {
        const outputTable = await this.store.getOutputTableRecord(outputTableId);
        if (outputTable?.cloudAction?.trigger !== 'on_change') return;
        await this.executeOutputAction(outputTableId, {});
      }).catch(() => undefined);
    }
  }

  /**
   * Arms cron jobs for output tables whose cloud action runs on a schedule.
   * Idempotent; resolves once the metadata store is ready.
   */
  async ensureActionTimersArmed(): Promise<void> {
    if (this.actionTimersArmed) return;
    if (this.actionTimersArming) return this.actionTimersArming;
    this.actionTimersArming = (async () => {
      try {
        const bound = await this.store.listOutputTableCloudActions();
        for (const { id } of bound) {
          await this.enqueueOutputAction(id, async () => {
            const current = await this.store.getOutputTableRecord(id);
            this.rearmActionTimer(id, current?.cloudAction ?? null);
          });
        }
        this.actionTimersArmed = true;
        if (this.actionTimerRetry) clearTimeout(this.actionTimerRetry);
        this.actionTimerRetry = null;
      } catch (error) {
        console.warn('[Data] Failed to arm cloud action timers:', error);
        if (!this.actionTimerRetry) {
          this.actionTimerRetry = setTimeout(() => {
            this.actionTimerRetry = null;
            void this.ensureActionTimersArmed();
          }, 5000);
          this.actionTimerRetry.unref?.();
        }
      } finally {
        this.actionTimersArming = null;
      }
    })();
    return this.actionTimersArming;
  }

  private normalizeOutputAction(spec: CloudOutputActionSpec): CloudOutputAction {
    const spaceId = normalizeRequiredName(spec.spaceId, 'Cloud spaceId is required');
    const projectId = normalizeRequiredName(spec.projectId, 'Cloud projectId is required');
    const schedule =
      spec.trigger === 'schedule' ? normalizeScheduleConfig(spec.schedule ?? null) : null;
    if (spec.trigger === 'schedule' && !schedule) {
      throw new DataCommandError('INVALID_ARGUMENT', 'schedule is required for scheduled actions');
    }
    if (spec.type === 'drive_file') {
      return {
        type: 'drive_file',
        trigger: spec.trigger,
        ...(schedule ? { schedule } : {}),
        spaceId,
        projectId,
        ...(spec.fileId?.trim() ? { fileId: spec.fileId.trim() } : {}),
        ...(spec.fileName?.trim() ? { fileName: spec.fileName.trim() } : {}),
      };
    }
    return {
      type: 'cloud_table',
      trigger: spec.trigger,
      ...(schedule ? { schedule } : {}),
      spaceId,
      projectId,
      ...(spec.tableId?.trim() ? { tableId: spec.tableId.trim() } : {}),
      ...(spec.tableName?.trim() ? { tableName: spec.tableName.trim() } : {}),
    };
  }

  private rearmActionTimer(outputTableId: string, action: CloudOutputAction | null): void {
    for (const job of this.outputActionJobs.get(outputTableId) ?? []) {
      job.stop();
    }
    this.outputActionJobs.delete(outputTableId);
    const schedule = action?.trigger === 'schedule' ? action.schedule : null;
    if (!schedule) return;

    const jobs: Cron[] = [];
    for (const pattern of calendarCronPatterns(schedule)) {
      try {
        jobs.push(
          new Cron(pattern, { unref: true, protect: true }, () => {
            return this.enqueueOutputAction(outputTableId, async () => {
              const current = await this.store.getOutputTableRecord(outputTableId);
              if (
                current?.cloudAction?.trigger !== 'schedule' ||
                JSON.stringify(current.cloudAction.schedule) !== JSON.stringify(schedule)
              )
                return;
              await this.executeOutputAction(outputTableId, {});
            }).catch(() => undefined);
          })
        );
      } catch (error) {
        console.warn('[Data] Invalid cloud action cron pattern:', pattern, error);
      }
    }
    if (jobs.length) {
      this.outputActionJobs.set(outputTableId, jobs);
    }
  }

  private enqueueOutputAction<T>(outputTableId: string, run: () => Promise<T>): Promise<T> {
    const queued = (this.outputActionQueues.get(outputTableId) ?? Promise.resolve()).then(run, run);
    this.outputActionQueues.set(
      outputTableId,
      queued.catch(() => undefined)
    );
    return queued;
  }

  private async executeOutputAction(
    outputTableId: string,
    connection: PersonalAnalysisConnectionInput
  ): Promise<RunOutputTableCloudActionResult> {
    // Recover a successful remote write before issuing another versioned request.
    const pending = this.pendingOutputActions.get(outputTableId);
    if (pending) {
      try {
        await this.store.updateOutputTableCloudAction(outputTableId, pending);
        this.pendingOutputActions.delete(outputTableId);
      } catch (error) {
        throw toCommandError(error, 'RUN_FAILED');
      }
    }
    const outputTable = await this.store.getOutputTableRecord(outputTableId);
    if (!outputTable) {
      throw new DataCommandError('RESOURCE_NOT_FOUND', `Output table not found: ${outputTableId}`);
    }
    const action = outputTable.cloudAction;
    if (!action) {
      throw new DataCommandError(
        'INVALID_ARGUMENT',
        `Output table ${outputTableId} has no cloud action`
      );
    }

    const persistAction = async (updates: Partial<CloudOutputAction>) => {
      const nextAction = { ...action, ...updates };
      this.pendingOutputActions.set(outputTableId, nextAction);
      await this.store.updateOutputTableCloudAction(outputTableId, nextAction);
      this.pendingOutputActions.delete(outputTableId);
    };

    try {
      const exported = await this.store.exportDatasetCsv({
        tableKind: 'output',
        id: outputTableId,
      });
      const client = await this.createPersonalAnalysisClient(connection);
      if (action.type === 'drive_file') {
        const result = await client.syncDriveCsv(action.spaceId, action.projectId, {
          fileId: action.fileId,
          outputId: `cowork-output-${outputTableId}`,
          fileName: action.fileId
            ? undefined
            : action.fileName || `${sanitizeFileName(outputTable.name)}.csv`,
          expectedVersion: action.fileId ? action.version : undefined,
          csvContent: exported.csv,
        });
        await persistAction({
          fileId: result.file.fileId,
          fileName: result.file.fileName,
          version: result.file.version,
          lastRunAt: Date.now(),
          lastError: undefined,
        });
      } else {
        const tableName =
          normalizeOptionalName(action.tableName) || outputTable.name || exported.id;
        const datasourceId = await this.resolveUploadDatasourceId(client, undefined);
        const upload = await client.uploadCsv({
          ...connection,
          writeMode: action.tableId ? 'REPLACE' : 'CREATE',
          datasourceId,
          spaceId: action.spaceId,
          projectId: action.projectId,
          tableId: action.tableId,
          fileName: `${sanitizeFileName(tableName)}.csv`,
          tableName,
          csv: exported.csv,
        });
        await persistAction({
          tableId: upload.tableId,
          tableName: upload.table?.tableName ?? tableName,
          lastRunAt: Date.now(),
          lastError: undefined,
        });
      }
      const refreshed = await this.store.getOutputTableRecord(outputTableId);
      return { outputTable: refreshed ?? outputTable, ranAt: Date.now() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const nextAction = {
        ...(this.pendingOutputActions.get(outputTableId) ?? action),
        lastError: message,
      };
      this.pendingOutputActions.set(outputTableId, nextAction);
      try {
        await this.store.updateOutputTableCloudAction(outputTableId, nextAction);
        this.pendingOutputActions.delete(outputTableId);
      } catch (persistError) {
        console.warn('[Data] Failed to persist cloud action status:', persistError);
      }
      throw toCommandError(error, 'RUN_FAILED');
    }
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

  private async createPersonalAnalysisClient(input: PersonalAnalysisConnectionInput = {}) {
    const configured = this.getPersonalAnalysisConfig();
    const mode =
      input.connectionMode ??
      (input.accessToken ? 'account' : input.apiKey || configured.apiKey ? 'apiKey' : 'account');
    if (mode === 'apiKey') {
      return createPersonalAnalysisClient({
        apiOrigin: input.apiOrigin || configured.apiOrigin,
        apiKey: input.apiKey || configured.apiKey,
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
        'No Personal Analysis datasource is available for upload. Choose a project with an available datasource or pass datasourceId.'
      );
    }

    if (datasources.length === 1) {
      return datasources[0].datasourceId;
    }

    throw new Error(
      `Multiple Personal Analysis datasources are available: ${datasources
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

async function writeCloudCsvTempFile(tableId: string, csv: string): Promise<string> {
  const directory = join(tmpdir(), 'sophron-cowork-cloud-imports');
  await mkdir(directory, { recursive: true });
  const filePath = join(directory, `${sanitizeFileName(tableId)}-${Date.now()}.csv`);
  await writeFile(filePath, csv, 'utf8');
  return filePath;
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
