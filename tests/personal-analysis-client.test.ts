import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonalAnalysisClient } from '../src/main/data/personal-analysis-client';

describe('PersonalAnalysisClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('requires a configured API origin', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const client = new PersonalAnalysisClient();
    await expect(client.listSpaces()).rejects.toThrow(
      'Personal Analysis apiOrigin is not configured'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires a configured API key when no access token is provided', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const client = new PersonalAnalysisClient({ apiOrigin: 'http://mock.local' });
    await expect(client.listSpaces()).rejects.toThrow('Personal Analysis apiKey is not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires a configured datasource id for uploads', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const client = new PersonalAnalysisClient({
      apiOrigin: 'http://mock.local',
      apiKey: 'test-api-key',
    });
    await expect(
      client.uploadCsv({
        writeMode: 'CREATE',
        fileName: 'create.csv',
        tableName: 'Created Table',
        csv: 'name\nAlice\n',
        waitForDone: false,
      })
    ).rejects.toThrow('Personal Analysis datasourceId is not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists datasources from the configured service', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const href = String(url);

      if (href.endsWith('/api/personal/api-keys/token')) {
        return jsonResponse({
          success: true,
          data: { accessToken: 'token-1' },
        });
      }

      if (href.endsWith('/api/personal/analysis/v1/datasources')) {
        return jsonResponse({
          success: true,
          data: [{ datasourceId: 'datasource-a', datasourceName: 'Datasource A' }],
        });
      }

      throw new Error(`Unexpected fetch ${href}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new PersonalAnalysisClient({
      apiOrigin: 'http://mock.local',
      apiKey: 'test-api-key',
    });

    await expect(client.listDatasources()).resolves.toEqual([
      { datasourceId: 'datasource-a', datasourceName: 'Datasource A' },
    ]);
  });

  it('uses the configured datasource for uploads', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);

      if (href.endsWith('/api/personal/api-keys/token')) {
        return jsonResponse({
          success: true,
          data: { accessToken: 'token-1' },
        });
      }

      if (href.endsWith('/api/personal/analysis/v1/imports/upload-url')) {
        expect(JSON.parse(String(init?.body))).toEqual(
          expect.objectContaining({ datasourceId: 'test-datasource' })
        );
        return jsonResponse({
          success: true,
          data: {
            uploadTaskId: 'upl-1',
            tableId: 'table-created',
            uploadUrl: 'http://upload.local/csv',
          },
        });
      }

      if (href === 'http://upload.local/csv') {
        return new Response('', { status: 200 });
      }

      if (href.endsWith('/api/personal/analysis/v1/imports') && init?.method === 'POST') {
        return jsonResponse({
          success: true,
          data: {
            taskId: 'upl-1',
            tableId: 'table-created',
            status: 'SUBMITTED',
          },
        });
      }

      throw new Error(`Unexpected fetch ${href}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new PersonalAnalysisClient({
      apiOrigin: 'http://mock.local',
      apiKey: 'test-api-key',
      datasourceId: 'test-datasource',
    });
    const result = await client.uploadCsv({
      writeMode: 'CREATE',
      fileName: 'create.csv',
      tableName: 'Created Table',
      csv: 'name\nAlice\n',
      waitForDone: false,
    });

    expect(result.tableId).toBe('table-created');
  });

  it('times out hung fetch requests', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new PersonalAnalysisClient({
      apiOrigin: 'http://mock.local',
      apiKey: 'test-api-key',
    });
    const pending = expect(client.listSpaces()).rejects.toThrow(
      'POST /api/personal/api-keys/token timed out after 30000ms'
    );

    await vi.advanceTimersByTimeAsync(30_000);
    await pending;
    expect(fetchMock).toHaveBeenCalledWith(
      'http://mock.local/api/personal/api-keys/token',
      expect.objectContaining({
        method: 'POST',
        signal: expect.any(Object),
      })
    );
  });

  it('waits for import task status instead of table existence when replacing a table', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);

      if (href.endsWith('/api/personal/api-keys/token')) {
        return jsonResponse({
          success: true,
          data: { accessToken: 'token-1' },
        });
      }

      if (href.endsWith('/api/personal/analysis/v1/imports/upload-url')) {
        return jsonResponse({
          success: true,
          data: {
            uploadTaskId: 'upl-1',
            tableId: 'table-existing',
            uploadUrl: 'http://upload.local/csv',
          },
        });
      }

      if (href === 'http://upload.local/csv') {
        expect(init?.method).toBe('PUT');
        return new Response('', { status: 200 });
      }

      if (href.endsWith('/api/personal/analysis/v1/imports') && init?.method === 'POST') {
        return jsonResponse({
          success: true,
          data: {
            taskId: 'upl-1',
            tableId: 'table-existing',
            status: 'SUBMITTED',
          },
        });
      }

      if (href.endsWith('/api/personal/analysis/v1/imports/upl-1')) {
        return jsonResponse({
          success: true,
          data: {
            taskId: 'upl-1',
            uploadTaskId: 'upl-1',
            tableId: 'table-existing',
            status: 'DONE',
            table: {
              tableId: 'table-existing',
              tableName: 'Replaced Table',
              projectId: 'project-sales',
              rowCount: 1,
            },
          },
        });
      }

      throw new Error(`Unexpected fetch ${href}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new PersonalAnalysisClient({
      apiOrigin: 'http://mock.local',
      apiKey: 'test-api-key',
      datasourceId: 'test-datasource',
    });

    const result = await client.uploadCsv({
      writeMode: 'REPLACE',
      spaceId: 'space-growth',
      projectId: 'project-sales',
      tableId: 'table-existing',
      fileName: 'replace.csv',
      tableName: 'Replaced Table',
      csv: 'name\nAlice\n',
    });

    expect(result.status).toBe('DONE');
    expect(result.table?.tableName).toBe('Replaced Table');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://mock.local/api/personal/analysis/v1/imports/upl-1',
      expect.objectContaining({ method: 'GET' })
    );
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/spaces/'))).toBe(false);
  });

  it('does not fall back to listTables when a completed import omits table metadata', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);

      if (href.endsWith('/api/personal/api-keys/token')) {
        return jsonResponse({
          success: true,
          data: { accessToken: 'token-1' },
        });
      }

      if (href.endsWith('/api/personal/analysis/v1/imports/upload-url')) {
        return jsonResponse({
          success: true,
          data: {
            uploadTaskId: 'upl-1',
            tableId: 'table-existing',
            uploadUrl: 'http://upload.local/csv',
          },
        });
      }

      if (href === 'http://upload.local/csv') {
        return new Response('', { status: 200 });
      }

      if (href.endsWith('/api/personal/analysis/v1/imports') && init?.method === 'POST') {
        return jsonResponse({
          success: true,
          data: {
            taskId: 'upl-1',
            tableId: 'table-existing',
            status: 'SUBMITTED',
          },
        });
      }

      if (href.endsWith('/api/personal/analysis/v1/imports/upl-1')) {
        return jsonResponse({
          success: true,
          data: {
            taskId: 'upl-1',
            tableId: 'table-existing',
            status: 'DONE',
          },
        });
      }

      throw new Error(`Unexpected fetch ${href}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new PersonalAnalysisClient({
      apiOrigin: 'http://mock.local',
      apiKey: 'test-api-key',
      datasourceId: 'test-datasource',
    });

    const result = await client.uploadCsv({
      writeMode: 'REPLACE',
      spaceId: 'space-growth',
      projectId: 'project-sales',
      tableId: 'table-existing',
      fileName: 'replace.csv',
      tableName: 'Replaced Table',
      csv: 'name\nAlice\n',
    });

    expect(result.status).toBe('DONE');
    expect(result.table).toBeUndefined();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/spaces/'))).toBe(false);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
