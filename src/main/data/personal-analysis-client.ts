import { normalizePersonalAnalysisApiOrigin } from '../../shared/personal-analysis';
import type {
  PersonalAnalysisConnectionInput,
  PersonalAnalysisDatasource,
  PersonalAnalysisProject,
  PersonalAnalysisSpace,
  PersonalAnalysisTable,
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

const DEFAULT_RETRY_ATTEMPTS = 20;
const DEFAULT_RETRY_DELAY_MS = 250;
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

export class PersonalAnalysisClient {
  private readonly apiOrigin: string;
  private readonly apiKey: string;
  private accessToken: string | null;

  constructor(options: PersonalAnalysisConnectionInput = {}) {
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

  async listTables(spaceId: string, projectId: string): Promise<PersonalAnalysisTable[]> {
    return this.apiJson<PersonalAnalysisTable[]>(
      `/spaces/${encodeURIComponent(spaceId)}/projects/${encodeURIComponent(projectId)}/tables`
    );
  }

  async exportTableCsv(tableId: string): Promise<string> {
    const created = await this.apiJson<{ taskId: string; status: string }>(
      `/tables/${encodeURIComponent(tableId)}/exports`,
      { method: 'POST' }
    );
    if (!created.taskId) {
      throw new Error(`Export task was not created for cloud table ${tableId}`);
    }

    const download = await retry(
      `cloud export ${created.taskId}`,
      async (): Promise<{ downloadUrl: string } | null> => {
        const result = await this.apiJson<{
          status: string;
          downloadUrl?: string;
          errorMsg?: string;
        }>(`/exports/${encodeURIComponent(created.taskId)}/download`);
        if (result.status === 'FAILED') {
          throw new Error(result.errorMsg || `Cloud export ${created.taskId} failed`);
        }
        return result.status === 'DONE' && result.downloadUrl
          ? { downloadUrl: result.downloadUrl }
          : null;
      }
    );

    const response = await fetchWithTimeout(download.downloadUrl, {}, 'Download cloud CSV');
    if (!response.ok) {
      throw new Error(`Download cloud CSV failed: HTTP ${response.status} ${response.statusText}`);
    }
    return response.text();
  }

  async uploadCsv(input: PersonalAnalysisUploadInput): Promise<PersonalAnalysisUploadResult> {
    const datasourceId = input.datasourceId?.trim();
    if (!datasourceId) {
      throw new Error('Personal Analysis datasourceId is required for upload');
    }
    const uploadInfo = await this.apiJson<{
      uploadTaskId: string;
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

    if (!uploadInfo.uploadUrl || !uploadInfo.uploadTaskId || !uploadInfo.tableId) {
      throw new Error('Cloud upload-url response is missing uploadUrl, uploadTaskId, or tableId');
    }

    const uploadResponse = await fetchWithTimeout(
      uploadInfo.uploadUrl,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'text/csv; charset=utf-8' },
        body: input.csv,
      },
      'Upload cloud CSV'
    );
    if (!uploadResponse.ok) {
      throw new Error(
        `Upload cloud CSV failed: HTTP ${uploadResponse.status} ${await uploadResponse.text()}`
      );
    }

    const submitted = await this.apiJson<{
      taskId: string;
      tableId: string;
      sheetId?: string;
      status: string;
    }>('/imports', {
      method: 'POST',
      body: {
        uploadTaskId: uploadInfo.uploadTaskId,
        tableName: input.tableName,
      },
    });

    const result: PersonalAnalysisUploadResult = {
      uploadTaskId: uploadInfo.uploadTaskId,
      importTaskId: submitted.taskId,
      tableId: submitted.tableId || uploadInfo.tableId,
      sheetId: submitted.sheetId || uploadInfo.sheetId,
      status: submitted.status,
    };

    if (input.waitForDone !== false) {
      const completed = await retry(`cloud import ${submitted.taskId}`, async () => {
        const task = await this.getImportStatus(submitted.taskId);
        if (task.status === 'FAILED') {
          throw new Error(task.errorMsg || `Cloud import ${submitted.taskId} failed`);
        }
        return task.status === 'DONE' ? task : null;
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
      throw new Error('Personal Analysis apiOrigin is not configured');
    }
    const token = await this.getAccessToken();
    const method = options.method ?? 'GET';
    const response = await fetchWithTimeout(
      `${this.apiOrigin}/api/personal/analysis/v1${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      },
      `${method} ${path}`
    );
    return parseHiResponse<T>(response, await response.text(), `${method} ${path}`);
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken) {
      return this.accessToken;
    }
    if (!this.apiOrigin) {
      throw new Error('Personal Analysis apiOrigin is not configured');
    }
    if (!this.apiKey) {
      throw new Error('Personal Analysis apiKey is not configured');
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
    );
    if (!tokenInfo.accessToken) {
      throw new Error('Cloud token exchange did not return accessToken');
    }
    this.accessToken = tokenInfo.accessToken;
    return this.accessToken;
  }
}

export function createPersonalAnalysisClient(
  input: PersonalAnalysisConnectionInput = {}
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
    throw new Error(`${label} expected JSON but got: ${text.slice(0, 200)}`);
  }

  if (!response.ok || body.success === false) {
    throw new Error(
      `${label} failed: HTTP ${response.status} ${body.errorCode || body.code || ''} ${
        body.message || text.slice(0, 200)
      }`.trim()
    );
  }

  return body.data as T;
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
