export interface PersonalAnalysisConnectionInput {
  apiOrigin?: string;
  apiKey?: string;
  accessToken?: string;
}

export interface PersonalAnalysisSpace {
  spaceId: string;
  spaceName: string;
  description?: string;
  projectCount?: number;
}

export interface PersonalAnalysisProject {
  projectId: string;
  folderId: string;
  spaceId: string;
  projectName: string;
  tableCount?: number;
}

export interface PersonalAnalysisTable {
  tableId: string;
  sheetId?: string;
  tableName: string;
  spaceId?: string;
  projectId: string;
  datasourceId?: string;
  folderId?: string;
  columns?: string[];
  rowCount?: number;
}

export interface PersonalAnalysisUploadInput extends PersonalAnalysisConnectionInput {
  writeMode: 'CREATE' | 'REPLACE';
  datasourceId?: string;
  folderId?: string;
  projectId?: string;
  spaceId?: string;
  tableId?: string;
  fileName: string;
  tableName: string;
  csv: string;
  waitForDone?: boolean;
}

export interface PersonalAnalysisUploadResult {
  uploadTaskId: string;
  importTaskId: string;
  tableId: string;
  sheetId?: string;
  status: string;
  table?: PersonalAnalysisTable;
}

interface PersonalAnalysisClientOptions extends PersonalAnalysisConnectionInput {
  datasourceId?: string;
}

interface HiResponse<T> {
  success?: boolean;
  code?: string;
  errorCode?: string;
  message?: string;
  data?: T;
}

const DEFAULT_API_ORIGIN = 'http://127.0.0.1:3000';
const DEFAULT_API_KEY = 'mock-api-key';
const DEFAULT_DATASOURCE_ID = 'datasource-demo';
const DEFAULT_RETRY_ATTEMPTS = 20;
const DEFAULT_RETRY_DELAY_MS = 250;

export class PersonalAnalysisClient {
  private readonly apiOrigin: string;
  private readonly apiKey: string;
  private readonly datasourceId: string;
  private accessToken: string | null;

  constructor(options: PersonalAnalysisClientOptions = {}) {
    this.apiOrigin = normalizeApiOrigin(options.apiOrigin);
    this.apiKey = options.apiKey?.trim() || process.env.PERSONAL_API_KEY || DEFAULT_API_KEY;
    this.datasourceId =
      options.datasourceId?.trim() || process.env.DATASOURCE_ID || DEFAULT_DATASOURCE_ID;
    this.accessToken = options.accessToken?.trim() || null;
  }

  async listSpaces(): Promise<PersonalAnalysisSpace[]> {
    return this.apiJson<PersonalAnalysisSpace[]>('/spaces');
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

    const response = await fetch(download.downloadUrl);
    if (!response.ok) {
      throw new Error(`Download cloud CSV failed: HTTP ${response.status} ${response.statusText}`);
    }
    return response.text();
  }

  async uploadCsv(input: PersonalAnalysisUploadInput): Promise<PersonalAnalysisUploadResult> {
    const datasourceId = input.datasourceId?.trim() || this.datasourceId;
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

    const uploadResponse = await fetch(uploadInfo.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/csv; charset=utf-8' },
      body: input.csv,
    });
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

    if (input.waitForDone !== false && input.spaceId && input.projectId) {
      result.table = await retry(`cloud import ${submitted.taskId}`, async () => {
        const tables = await this.listTables(input.spaceId!, input.projectId!);
        return tables.find((table) => table.tableId === result.tableId) ?? null;
      });
      result.status = 'DONE';
    }

    return result;
  }

  private async apiJson<T>(
    path: string,
    options: { method?: string; body?: Record<string, unknown> } = {}
  ): Promise<T> {
    const token = await this.getAccessToken();
    const method = options.method ?? 'GET';
    const response = await fetch(`${this.apiOrigin}/api/personal/analysis/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    return parseHiResponse<T>(response, await response.text(), `${method} ${path}`);
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken) {
      return this.accessToken;
    }
    const response = await fetch(`${this.apiOrigin}/api/personal/api-keys/token`, {
      method: 'POST',
      headers: { 'X-API-Key': this.apiKey },
    });
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
  input: PersonalAnalysisConnectionInput & { datasourceId?: string } = {}
): PersonalAnalysisClient {
  return new PersonalAnalysisClient(input);
}

function normalizeApiOrigin(value: string | undefined): string {
  return (value?.trim() || process.env.PERSONAL_ANALYSIS_API_ORIGIN || DEFAULT_API_ORIGIN).replace(
    /\/+$/,
    ''
  );
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
