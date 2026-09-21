import { afterEach, describe, expect, it, vi } from 'vitest';
import { PersonalAnalysisClient } from '../src/main/data/personal-analysis-client';
const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }));
const reject = (status: number, message = 'token invalid') =>
  new Response(JSON.stringify({ success: false, code: '61311002', message }), { status });
afterEach(() => vi.unstubAllGlobals());
describe('API key invalidation', () => {
  it('reports a revoked key when exchange fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reject(200, 'API Key 无效')));
    const onApiKeyRejected = vi.fn();
    const client = new PersonalAnalysisClient({
      apiOrigin: 'https://cloud.example',
      apiKey: 'key',
      onApiKeyRejected,
    });
    await expect(client.listSpaces()).rejects.toThrow();
    expect(onApiKeyRejected).toHaveBeenCalledTimes(1);
  });
  it.each([403, 500])('does not disconnect for HTTP %s', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(ok({ accessToken: 'token' }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ success: false, message: 'Request failed' }), { status })
        )
    );
    const onApiKeyRejected = vi.fn();
    await expect(
      new PersonalAnalysisClient({
        apiOrigin: 'https://cloud.example',
        apiKey: 'key',
        onApiKeyRejected,
      }).listSpaces()
    ).rejects.toThrow();
    expect(onApiKeyRejected).not.toHaveBeenCalled();
  });
  it('does not confuse a legacy missing-scope error with key rejection', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(ok({ accessToken: 'token' }))
        .mockResolvedValueOnce(reject(200, 'token 缺少 read 权限'))
    );
    const onApiKeyRejected = vi.fn();
    await expect(
      new PersonalAnalysisClient({
        apiOrigin: 'https://cloud.example',
        apiKey: 'key',
        onApiKeyRejected,
      }).listSpaces()
    ).rejects.toThrow();
    expect(onApiKeyRejected).not.toHaveBeenCalled();
  });
  it('renews an expired derived bearer without disconnecting a valid key', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(ok({ accessToken: 'old' }))
        .mockResolvedValueOnce(reject(401))
        .mockResolvedValueOnce(ok({ accessToken: 'new' }))
        .mockResolvedValueOnce(ok([]))
    );
    const onApiKeyRejected = vi.fn();
    expect(
      await new PersonalAnalysisClient({
        apiOrigin: 'https://cloud.example',
        apiKey: 'key',
        onApiKeyRejected,
      }).listSpaces()
    ).toEqual([]);
    expect(onApiKeyRejected).not.toHaveBeenCalled();
  });
});
