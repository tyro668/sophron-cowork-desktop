import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudAnalysisCommandService } from '../src/main/data/cloud-analysis-command-service';
import type { DataPipelineStore } from '../src/main/data/data-pipeline-store';
import { PersonalAnalysisClient } from '../src/main/data/personal-analysis-client';

const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }));
const denied = () =>
  new Response(JSON.stringify({ success: false, code: '61311002' }), { status: 401 });
afterEach(() => vi.unstubAllGlobals());
function fixture(
  resolveAccount = vi.fn(),
  config = { apiOrigin: 'https://key.example', apiKey: 'fixed-key', updatedAt: 0 }
) {
  return new CloudAnalysisCommandService({} as DataPipelineStore, () => config, {
    createRawTable: vi.fn(),
    getPersonalAnalysisConnection: resolveAccount,
  });
}

describe('cloud credential isolation', () => {
  it('reads spaces, projects and tables with the account when no API key is configured', async () => {
    const account = vi
      .fn()
      .mockResolvedValue({ apiOrigin: 'https://account.example', accessToken: 'account-token' });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok([{ spaceId: 's', spaceName: 'Space' }]))
      .mockResolvedValueOnce(ok([{ projectId: 'p', projectName: 'Project' }]))
      .mockResolvedValueOnce(
        ok({
          items: [{ tableId: 't', tableName: 'Table' }],
          page: 1,
          pageSize: 20,
          total: 1,
          hasMore: false,
        })
      );
    vi.stubGlobal('fetch', fetchMock);
    const service = fixture(account, { apiOrigin: '', apiKey: '', updatedAt: 0 });
    expect((await service.listCloudSpaces()).spaces[0].spaceId).toBe('s');
    expect((await service.listCloudProjects({ spaceId: 's' })).projects[0].projectId).toBe('p');
    await service.listCloudTables({ spaceId: 's', projectId: 'p' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toContain('https://account.example/api/personal/analysis/v1/');
      expect(init.headers.Authorization).toBe('Bearer account-token');
    }
  });

  it('automatically prefers a configured API key over a logged-in account', async () => {
    const account = vi
      .fn()
      .mockResolvedValue({ apiOrigin: 'https://account.example', accessToken: 'account-token' });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ accessToken: 'key-token' }))
      .mockResolvedValueOnce(ok([]));
    vi.stubGlobal('fetch', fetchMock);
    await fixture(account).listCloudSpaces();
    expect(account).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer key-token');
  });

  it('uses the account after a saved key is rejected and marked disconnected', async () => {
    let config: import('../src/shared/personal-analysis-types').StoredPersonalAnalysisConfig = {
      apiOrigin: 'https://key.example',
      apiKey: 'fixed-key',
      updatedAt: 0,
    };
    const account = vi
      .fn()
      .mockResolvedValue({ apiOrigin: 'https://account.example', accessToken: 'account-token' });
    const fetchMock = vi.fn().mockResolvedValueOnce(denied()).mockResolvedValueOnce(ok([]));
    vi.stubGlobal('fetch', fetchMock);
    const service = new CloudAnalysisCommandService({} as DataPipelineStore, () => config, {
      createRawTable: vi.fn(),
      getPersonalAnalysisConnection: account,
      onPersonalAnalysisKeyRejected: () => {
        config = { ...config, connectionStatus: 'disconnected' };
      },
    });
    await expect(service.listCloudSpaces()).rejects.toThrow();
    expect(config.connectionStatus).toBe('disconnected');
    expect(config.apiKey).toBe('fixed-key');
    await service.listCloudSpaces();
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://account.example/api/personal/analysis/v1/spaces'
    );
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer account-token');
  });

  it('never loads or refreshes the account session for API key mode', async () => {
    const account = vi.fn().mockRejectedValue(new Error('account offline'));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ accessToken: 'key-token' }))
      .mockResolvedValueOnce(ok([]));
    vi.stubGlobal('fetch', fetchMock);
    await fixture(account).listCloudSpaces({ connectionMode: 'apiKey' });
    expect(account).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][0]).toBe('https://key.example/api/personal/api-keys/token');
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer key-token');
  });

  it('never falls back to the configured key when the account is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      fixture(vi.fn().mockResolvedValue(null)).listCloudSpaces({ connectionMode: 'account' })
    ).rejects.toThrow('Please sign in');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not send account credentials to the API key service origin', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const service = fixture(
      vi
        .fn()
        .mockResolvedValue({ apiOrigin: 'https://account.example', accessToken: 'account-token' })
    );
    await expect(
      service.listCloudSpaces({ connectionMode: 'account', apiOrigin: 'https://key.example' })
    ).rejects.toThrow('origin does not match');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes and retries a rejected account request exactly once', async () => {
    const getAccessToken = vi.fn().mockResolvedValueOnce('old').mockResolvedValueOnce('new');
    const fetchMock = vi.fn().mockResolvedValueOnce(denied()).mockResolvedValueOnce(ok([]));
    vi.stubGlobal('fetch', fetchMock);
    const client = new PersonalAnalysisClient({
      apiOrigin: 'https://account.example',
      getAccessToken,
    });
    expect(await client.listSpaces()).toEqual([]);
    expect(getAccessToken).toHaveBeenNthCalledWith(2, 'old');
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer new');
  });

  it('stops after a second authentication failure', async () => {
    const getAccessToken = vi.fn().mockResolvedValue('account');
    const fetchMock = vi.fn().mockImplementation(async () => denied());
    vi.stubGlobal('fetch', fetchMock);
    const client = new PersonalAnalysisClient({
      apiOrigin: 'https://account.example',
      getAccessToken,
    });
    await expect(client.listSpaces()).rejects.toThrow('401');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry or fall back to an account when an API key has been revoked', async () => {
    const account = vi.fn();
    const fetchMock = vi.fn().mockImplementation(async () => denied());
    vi.stubGlobal('fetch', fetchMock);
    await expect(fixture(account).listCloudSpaces({ connectionMode: 'apiKey' })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(account).not.toHaveBeenCalled();
  });
});
