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
  type ListCloudProjectsCommand,
  type ListCloudProjectsResult,
  type ListCloudSpacesCommand,
  type ListCloudSpacesResult,
  type ListCloudTablesCommand,
  type ListCloudTablesResult,
  type PreviewCloudTableCommand,
  type PreviewCloudTableResult,
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

const DEFAULT_PREVIEW_LIMIT = 20;
const MAX_PREVIEW_LIMIT = 100;

export interface CloudAnalysisCommandServiceOptions {
  getPersonalAnalysisConnection?: () => PersonalAnalysisConnectionInput | null;
  createInputTable: (input: CreateInputTableCommand) => Promise<InputTableResult>;
}

export class CloudAnalysisCommandService {
  constructor(
    private readonly store: DataTaskStore,
    private readonly getPersonalAnalysisConfig: () => StoredPersonalAnalysisConfig,
    private readonly options: CloudAnalysisCommandServiceOptions
  ) {}

  async listCloudSpaces(input: ListCloudSpacesCommand = {}): Promise<ListCloudSpacesResult> {
    try {
      return {
        spaces: await this.createPersonalAnalysisClient(input).listSpaces(),
      };
    } catch (error) {
      throw toCommandError(error, 'RUN_FAILED');
    }
  }

  async listCloudProjects(input: ListCloudProjectsCommand): Promise<ListCloudProjectsResult> {
    const spaceId = normalizeRequiredName(input.spaceId, 'Cloud spaceId is required');
    try {
      return {
        projects: await this.createPersonalAnalysisClient(input).listProjects(spaceId),
      };
    } catch (error) {
      throw toCommandError(error, 'RUN_FAILED');
    }
  }

  async listCloudTables(input: ListCloudTablesCommand): Promise<ListCloudTablesResult> {
    const spaceId = normalizeRequiredName(input.spaceId, 'Cloud spaceId is required');
    const projectId = normalizeRequiredName(input.projectId, 'Cloud projectId is required');
    try {
      return await this.createPersonalAnalysisClient(input).listTables(spaceId, projectId, {
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
      return await this.createPersonalAnalysisClient(input).searchTables({
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
    const client = this.createPersonalAnalysisClient(input);
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
      const csv = await this.createPersonalAnalysisClient(input).exportTableCsv(tableId);
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
      const client = this.createPersonalAnalysisClient(input);
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

  private createPersonalAnalysisClient(input: PersonalAnalysisConnectionInput = {}) {
    const configured = this.getPersonalAnalysisConfig();
    const authenticated = this.options.getPersonalAnalysisConnection?.() ?? null;
    const configuredApiKey = configured.apiKey?.trim() || '';
    const inputApiKey = input.apiKey?.trim() || '';
    const inputAccessToken = input.accessToken?.trim() || '';
    const fallbackAccessToken = authenticated?.accessToken?.trim() || '';
    const connectionMode = input.connectionMode;

    if (connectionMode === 'account') {
      return createPersonalAnalysisClient({
        apiOrigin: input.apiOrigin || authenticated?.apiOrigin || configured.apiOrigin,
        accessToken: inputAccessToken || fallbackAccessToken,
      });
    }

    if (connectionMode === 'apiKey') {
      return createPersonalAnalysisClient({
        apiOrigin: input.apiOrigin || configured.apiOrigin || authenticated?.apiOrigin,
        apiKey: inputApiKey || configuredApiKey,
      });
    }

    return createPersonalAnalysisClient({
      apiOrigin: input.apiOrigin || configured.apiOrigin || authenticated?.apiOrigin,
      apiKey: inputApiKey || configuredApiKey,
      accessToken:
        inputAccessToken || (!inputApiKey && !configuredApiKey ? fallbackAccessToken : undefined),
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
