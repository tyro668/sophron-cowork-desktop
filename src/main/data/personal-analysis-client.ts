import { normalizePersonalAnalysisApiOrigin } from '../../shared/personal-analysis';
import type {
  PersonalAnalysisConnectionInput,
  PersonalAnalysisDatasource,
  PersonalAnalysisDriveFile,
  PersonalAnalysisDriveFileListResult,
  PersonalAnalysisDriveFilePreview,
  PersonalAnalysisDriveFileSearchParams,
  PersonalAnalysisDriveSyncResult,
  PersonalAnalysisProject,
  PersonalAnalysisSpace,
  PersonalAnalysisTable,
  PersonalAnalysisTableListResult,
  PersonalAnalysisTableSearchParams,
  PersonalAnalysisUploadInput,
  PersonalAnalysisUploadResult,
} from '../../shared/personal-analysis-types';

interface PersonalAnalysisImportStatus {
  taskId: string;
  uploadTaskId?: string;
  tableId: string;
  sheetId?: string;
  status: string;
  errorMsg?: string;
  table?: PersonalAnalysisTable;
}

interface HiResponse<T> {
  success?: boolean;
  code?: string;
  errorCode?: string;
  message?: string;
  data?: T;
}

interface PaginatedTableApiResult {
  items?: PersonalAnalysisTable[];
  tables?: PersonalAnalysisTable[];
  page?: number;
  pageSize?: number;
  total?: number;
  hasMore?: boolean;
}

interface PaginatedDriveFileApiResult {
  items?: PersonalAnalysisDriveFile[];
  page?: number;
  pageSize?: number;
  total?: number;
  hasMore?: boolean;
}

const DEFAULT_RETRY_ATTEMPTS = 20;
const DEFAULT_RETRY_DELAY_MS = 250;
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

export class PersonalAnalysisHttpError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(label: string, status: number, code: string | undefined, message: string) {
    super([label, 'failed: HTTP', String(status), code, message].filter(Boolean).join(' '));
    this.name = 'PersonalAnalysisHttpError';
    this.status = status;
    this.code = code;
  }
}

export interface PersonalAnalysisClientOptions extends PersonalAnalysisConnectionInput {
  /** Main-process account session provider; never serialized across IPC. */
  getAccessToken?: (rejectedAccessToken?: string) => Promise<string>;
  onApiKeyRejected?: () => void;
}

export class PersonalAnalysisClient {
  private readonly apiOrigin: string;
  private readonly apiKey: string;
  private accessToken: string | null;

  constructor(private readonly options: PersonalAnalysisClientOptions = {}) {
    this.apiOrigin = normalizePersonalAnalysisApiOrigin(options.apiOrigin);
    this.apiKey = options.apiKey?.trim() || '';
    this.accessToken = options.accessToken?.trim() || null;
  }

  async listSpaces(): Promise<PersonalAnalysisSpace[]> {
    return this.apiJson<PersonalAnalysisSpace[]>('/spaces');
  }

  async listDatasources(): Promise<PersonalAnalysisDatasource[]> {
    return this.apiJson<PersonalAnalysisDatasource[]>('/datasources');
  }

  async listProjects(spaceId: string): Promise<PersonalAnalysisProject[]> {
    return this.apiJson<PersonalAnalysisProject[]>(
      `/spaces/${encodeURIComponent(spaceId)}/projects`
    );
  }

  async listTables(
    spaceId: string,
    projectId: string,
    params: PersonalAnalysisTableSearchParams = {}
  ): Promise<PersonalAnalysisTableListResult> {
    const query = new URLSearchParams();
    if (params.keyword?.trim()) query.set('keyword', params.keyword.trim());
    if (params.page) query.set('page', String(params.page));
    if (params.pageSize) query.set('pageSize', String(params.pageSize));
    if (params.sortBy) query.set('sortBy', params.sortBy);
    if (params.sortOrder) query.set('sortOrder', params.sortOrder);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    const result = await this.apiJson<PaginatedTableApiResult | PersonalAnalysisTable[]>(
      `/spaces/${encodeURIComponent(spaceId)}/projects/${encodeURIComponent(projectId)}/tables${suffix}`
    );

    return parsePaginatedTableResult(result, params, 'Cloud table list API');
  }

  async searchTables(
    params: PersonalAnalysisTableSearchParams = {}
  ): Promise<PersonalAnalysisTableListResult> {
    const keyword = params.keyword?.trim();
    if (!keyword) {
      throw new Error('Cloud table global search requires a keyword');
    }

    const query = new URLSearchParams();
    query.set('keyword', keyword);
    if (params.spaceId?.trim()) query.set('spaceId', params.spaceId.trim());
    if (params.projectId?.trim()) query.set('projectId', params.projectId.trim());
    if (params.matchField) query.set('matchField', params.matchField);
    if (params.page) query.set('page', String(params.page));
    if (params.pageSize) query.set('pageSize', String(params.pageSize));
    if (params.sortBy) query.set('sortBy', params.sortBy);
    if (params.sortOrder) query.set('sortOrder', params.sortOrder);

    const result = await this.apiJson<PaginatedTableApiResult | PersonalAnalysisTable[]>(
      `/tables/search?${query.toString()}`
    );

    return parsePaginatedTableResult(result, params, 'Cloud table search API');
  }

  async listDriveFiles(
    spaceId: string,
    projectId: string,
    params: PersonalAnalysisDriveFileSearchParams = {}
  ): Promise<PersonalAnalysisDriveFileListResult> {
    const query = new URLSearchParams();
    if (params.keyword?.trim()) query.set('keyword', params.keyword.trim());
    if (params.fileType) query.set('fileType', params.fileType);
    query.set('page', String(params.page ?? 1));
    query.set('pageSize', String(params.pageSize ?? 20));
    const result = await this.apiJson<PaginatedDriveFileApiResult | PersonalAnalysisDriveFile[]>(
      `/spaces/${encodeURIComponent(spaceId)}/projects/${encodeURIComponent(projectId)}/drive-files?${query.toString()}`
    );

    return parsePaginatedDriveFileResult(result, params, 'Cloud drive file list API');
  }

  async previewDriveFile(
    spaceId: string,
    projectId: string,
    fileId: string,
    sheetName?: string
  ): Promise<PersonalAnalysisDriveFilePreview> {
    const query = sheetName?.trim() ? `?sheetName=${encodeURIComponent(sheetName.trim())}` : '';
    const result = await this.apiJson<
      PersonalAnalysisDriveFile & { sheetName?: string; rows?: unknown[][] }
    >(
      `/spaces/${encodeURIComponent(spaceId)}/projects/${encodeURIComponent(projectId)}/drive-files/${encodeURIComponent(fileId)}${query}`
    );
    const { rows, sheetName: resolvedSheetName, ...file } = result;
    return {
      file: file as PersonalAnalysisDriveFile,
      sheetName: resolvedSheetName ?? file.sheets?.[0]?.name ?? '',
      rows: Array.isArray(rows) ? rows : [],
    };
  }

  async downloadDriveCsv(spaceId: string, projectId: string, fileId: string): Promise<string> {
    const { downloadUrl } = await this.apiJson<{ downloadUrl: string }>(
      `/spaces/${encodeURIComponent(spaceId)}/projects/${encodeURIComponent(projectId)}/drive-files/${encodeURIComponent(fileId)}/download`
    );
    const response = await fetchWithTimeout(downloadUrl, {}, 'Download drive Csv');
    if (!response.ok) throw new Error(`Download drive Csv failed: HTTP ${response.status}`);
    return response.text();
  }

  async syncDriveCsv(
    spaceId: string,
    projectId: string,
    input: {
      fileId?: string;
      outputId?: string;
      fileName?: string;
      expectedVersion?: number;
      csvContent: string;
    }
  ): Promise<PersonalAnalysisDriveSyncResult> {
    if (!input.fileId?.trim() && !input.outputId?.trim()) {
      throw new Error('Drive Csv sync requires fileId or outputId');
    }
    const file = await this.apiJson<PersonalAnalysisDriveFile & { created?: boolean }>(
      `/spaces/${encodeURIComponent(spaceId)}/projects/${encodeURIComponent(projectId)}/drive-files/sync`,
      {
        method: 'POST',
        body: {
          ...(input.fileId?.trim() ? { fileId: input.fileId.trim() } : {}),
          ...(input.outputId?.trim() ? { outputId: input.outputId.trim() } : {}),
          ...(input.fileName?.trim() ? { fileName: input.fileName.trim() } : {}),
          ...(typeof input.expectedVersion === 'number'
            ? { expectedVersion: input.expectedVersion }
            : {}),
          csvContent: input.csvContent,
        },
      }
    );
    const { created, ...rest } = file;
    return { file: rest as PersonalAnalysisDriveFile, created: created === true };
  }

  async findTable(
    spaceId: string,
    projectId: string,
    tableId: string
  ): Promise<PersonalAnalysisTable | undefined> {
    const MAX_LOOKUP_PAGES = 100;
    let page = 1;
    while (page <= MAX_LOOKUP_PAGES) {
      const result = await this.listTables(spaceId, projectId, {
        page,
        pageSize: 100,
      });
      const matched = result.tables.find((table) => table.tableId === tableId);
      if (matched) return matched;
      // Genuinely exhausted the catalog without a match — the table does not exist here.
      if (!result.hasMore) return undefined;
      page += 1;
    }
    // Hit the page cap while more pages remain: surface a clear error instead of a
    // silent "not found", so an oversized project / wrong id stays diagnosable.
    throw new Error(
      `Cloud table ${tableId} was not found within the first ${MAX_LOOKUP_PAGES} pages ` +
        `of project ${projectId} (space ${spaceId}); narrow the lookup or verify the table id.`
    );
  }

  async exportTableCsv(tableId: string): Promise<string> {
    const created = await this.apiJson<{
      taskId?: string;
      pipelineId?: string;
      status: string;
    }>(`/tables/${encodeURIComponent(tableId)}/exports`, { method: 'POST' });
    const exportTaskId = created.taskId ?? created.pipelineId;
    if (!exportTaskId) {
      throw new Error(`Export task was not created for cloud table ${tableId}`);
    }

    const download = await retry(
      `cloud export ${exportTaskId}`,
      async (): Promise<{ downloadUrl: string } | null> => {
        const result = await this.apiJson<{
          status: string;
          downloadUrl?: string;
          errorMsg?: string;
        }>(`/exports/${encodeURIComponent(exportTaskId)}/download`);
        if (result.status === 'FAILED') {
          throw new Error(result.errorMsg || `Cloud export ${exportTaskId} failed`);
        }
        return result.status === 'DONE' && result.downloadUrl
          ? { downloadUrl: result.downloadUrl }
          : null;
      }
    );

    const response = await fetchWithTimeout(download.downloadUrl, {}, 'Download cloud Csv');
    if (!response.ok) {
      throw new Error(`Download cloud Csv failed: HTTP ${response.status} ${response.statusText}`);
    }
    return response.text();
  }

  async uploadCsv(input: PersonalAnalysisUploadInput): Promise<PersonalAnalysisUploadResult> {
    const datasourceId = input.datasourceId?.trim();
    if (!datasourceId) {
      throw new Error('Cloud Space datasourceId is required for upload');
    }
    const uploadInfo = await this.apiJson<{
      uploadTaskId?: string;
      uploadPipelineId?: string;
      tableId: string;
      sheetId?: string;
      uploadUrl: string;
    }>('/imports/upload-url', {
      method: 'POST',
      body: {
        writeMode: input.writeMode,
        datasourceId,
        ...(input.folderId ? { folderId: input.folderId } : {}),
        ...(input.projectId ? { projectId: input.projectId } : {}),
        ...(input.spaceId ? { spaceId: input.spaceId } : {}),
        ...(input.tableId ? { tableId: input.tableId } : {}),
        fileName: input.fileName,
      },
    });

    const uploadTaskId = uploadInfo.uploadTaskId ?? uploadInfo.uploadPipelineId;
    if (!uploadInfo.uploadUrl || !uploadTaskId || !uploadInfo.tableId) {
      throw new Error('Cloud upload-url response is missing uploadUrl, uploadTaskId, or tableId');
    }

    const uploadResponse = await fetchWithTimeout(
      uploadInfo.uploadUrl,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'text/csv; charset=utf-8' },
        body: input.csv,
      },
      'Upload cloud Csv'
    );
    if (!uploadResponse.ok) {
      throw new Error(
        `Upload cloud Csv failed: HTTP ${uploadResponse.status} ${await uploadResponse.text()}`
      );
    }

    const submitted = await this.apiJson<{
      taskId?: string;
      pipelineId?: string;
      tableId: string;
      sheetId?: string;
      status: string;
    }>('/imports', {
      method: 'POST',
      body: {
        uploadTaskId,
        tableName: input.tableName,
      },
    });
    const importTaskId = submitted.taskId ?? submitted.pipelineId;
    if (!importTaskId) {
      throw new Error('Cloud import response is missing taskId');
    }

    const result: PersonalAnalysisUploadResult = {
      uploadPipelineId: uploadTaskId,
      importPipelineId: importTaskId,
      tableId: submitted.tableId || uploadInfo.tableId,
      sheetId: submitted.sheetId || uploadInfo.sheetId,
      status: submitted.status,
    };

    if (input.waitForDone !== false) {
      const completed = await retry(`cloud import ${importTaskId}`, async () => {
        const pipeline = await this.getImportStatus(importTaskId);
        if (pipeline.status === 'FAILED') {
          throw new Error(pipeline.errorMsg || `Cloud import ${importTaskId} failed`);
        }
        return pipeline.status === 'DONE' ? pipeline : null;
      });

      result.tableId = completed.tableId || result.tableId;
      result.sheetId = completed.sheetId || result.sheetId;
      result.status = completed.status;
      result.table = completed.table;
    }

    return result;
  }

  private async getImportStatus(taskId: string): Promise<PersonalAnalysisImportStatus> {
    return this.apiJson<PersonalAnalysisImportStatus>(`/imports/${encodeURIComponent(taskId)}`);
  }

  private async apiJson<T>(
    path: string,
    options: { method?: string; body?: Record<string, unknown> } = {}
  ): Promise<T> {
    if (!this.apiOrigin) {
      throw new Error('Cloud Space apiOrigin is not configured');
    }
    const token = await this.getAccessToken();
    const method = options.method ?? 'GET';
    const request = (bearer: string) =>
      fetchWithTimeout(
        `${this.apiOrigin}/api/personal/analysis/v1${path}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${bearer}`,
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
        },
        `${method} ${path}`
      );
    const response = await request(token);
    try {
      return await parseHiResponse<T>(response, await response.text(), `${method} ${path}`);
    } catch (error) {
      if (this.apiKey && isAuthenticationRejection(error)) {
        // A derived bearer can expire while the fixed API key remains valid.
        this.accessToken = null;
        const renewed = await this.getAccessToken();
        const retried = await request(renewed);
        try {
          return await parseHiResponse<T>(retried, await retried.text(), `${method} ${path}`);
        } catch (retryError) {
          if (isAuthenticationRejection(retryError)) this.options.onApiKeyRejected?.();
          throw retryError;
        }
      }
      if (!this.options.getAccessToken || !isAuthenticationRejection(error)) throw error;
      // Only authentication failures are replayed, once; never retry arbitrary writes.
      const renewedToken = await this.options.getAccessToken(token);
      const retried = await request(renewedToken);
      return parseHiResponse<T>(retried, await retried.text(), `${method} ${path}`);
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.options.getAccessToken) return this.options.getAccessToken();
    if (this.accessToken) {
      return this.accessToken;
    }
    if (!this.apiOrigin) {
      throw new Error('Cloud Space apiOrigin is not configured');
    }
    if (!this.apiKey) {
      throw new Error('Cloud Space apiKey is not configured');
    }
    const response = await fetchWithTimeout(
      `${this.apiOrigin}/api/personal/api-keys/token`,
      {
        method: 'POST',
        headers: { 'X-API-Key': this.apiKey },
      },
      'POST /api/personal/api-keys/token'
    );
    const tokenInfo = await parseHiResponse<{ accessToken: string }>(
      response,
      await response.text(),
      'POST /api/personal/api-keys/token'
    ).catch((error) => {
      if (isAuthenticationRejection(error)) this.options.onApiKeyRejected?.();
      throw error;
    });
    if (!tokenInfo.accessToken) {
      throw new Error('Cloud token exchange did not return accessToken');
    }
    this.accessToken = tokenInfo.accessToken;
    return this.accessToken;
  }
}

export function createPersonalAnalysisClient(
  input: PersonalAnalysisClientOptions = {}
): PersonalAnalysisClient {
  return new PersonalAnalysisClient(input);
}

async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit,
  label: string,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function parseHiResponse<T>(response: Response, text: string, label: string): Promise<T> {
  let body: HiResponse<T>;
  try {
    body = JSON.parse(text) as HiResponse<T>;
  } catch {
    if (!response.ok) {
      throw new PersonalAnalysisHttpError(label, response.status, undefined, text.slice(0, 200));
    }
    throw new Error(`${label} expected JSON but got: ${text.slice(0, 200)}`);
  }

  if (!response.ok || body.success === false) {
    throw new PersonalAnalysisHttpError(
      label,
      response.status,
      body.errorCode || body.code,
      body.message || text.slice(0, 200)
    );
  }

  return body.data as T;
}

function parsePaginatedTableResult(
  result: PaginatedTableApiResult | PersonalAnalysisTable[],
  params: PersonalAnalysisTableSearchParams,
  label: string
): PersonalAnalysisTableListResult {
  if (Array.isArray(result)) {
    throw new Error(
      `${label} must return a paginated object with items/tables, page, pageSize, total, and hasMore.`
    );
  }

  if (!result || typeof result !== 'object') {
    throw new Error(`${label} returned an invalid response.`);
  }

  const tables = result.items ?? result.tables;
  if (!Array.isArray(tables)) {
    throw new Error(`${label} response must include an items or tables array.`);
  }

  const page = result.page ?? params.page;
  const pageSize = result.pageSize ?? params.pageSize;
  if (
    typeof page !== 'number' ||
    typeof pageSize !== 'number' ||
    typeof result.total !== 'number' ||
    typeof result.hasMore !== 'boolean'
  ) {
    throw new Error(
      `${label} response must include numeric page/pageSize/total and boolean hasMore.`
    );
  }

  return {
    tables,
    page,
    pageSize,
    total: result.total,
    hasMore: result.hasMore,
  };
}

function parsePaginatedDriveFileResult(
  result: PaginatedDriveFileApiResult | PersonalAnalysisDriveFile[],
  params: PersonalAnalysisDriveFileSearchParams,
  label: string
): PersonalAnalysisDriveFileListResult {
  if (Array.isArray(result)) {
    return {
      files: result,
      page: params.page ?? 1,
      pageSize: params.pageSize ?? result.length,
      total: result.length,
      hasMore: false,
    };
  }

  if (!result || typeof result !== 'object' || !Array.isArray(result.items)) {
    throw new Error(`${label} response must include an items array.`);
  }

  const page = result.page ?? params.page;
  const pageSize = result.pageSize ?? params.pageSize;
  if (
    typeof page !== 'number' ||
    typeof pageSize !== 'number' ||
    typeof result.total !== 'number' ||
    typeof result.hasMore !== 'boolean'
  ) {
    throw new Error(
      `${label} response must include numeric page/pageSize/total and boolean hasMore.`
    );
  }

  return {
    files: result.items,
    page,
    pageSize,
    total: result.total,
    hasMore: result.hasMore,
  };
}

async function retry<T>(
  label: string,
  fn: () => Promise<T | null>,
  attempts = DEFAULT_RETRY_ATTEMPTS,
  delayMs = DEFAULT_RETRY_DELAY_MS
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const value = await fn();
      if (value) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function isAuthenticationRejection(error: unknown): boolean {
  if (!(error instanceof PersonalAnalysisHttpError)) return false;
  if (error.status === 401) return true;
  // The mock API uses this legacy code for both invalid tokens and missing scopes.
  return (
    error.code === '61311002' &&
    error.status !== 403 &&
    !/权限|permission|scope|forbidden/i.test(error.message)
  );
}
