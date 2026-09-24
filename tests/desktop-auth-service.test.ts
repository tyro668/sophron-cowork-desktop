import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { storage } = vi.hoisted(() => ({ storage: new Map<string, unknown>() }));
vi.mock('../src/main/utils/store-encryption', () => ({
  createEncryptedStoreWithKeyRotation: () => ({
    get: (key: string) => storage.get(key),
    set: (key: string, value: unknown) => storage.set(key, value),
  }),
}));
vi.mock('../src/main/utils/logger', () => ({ log: vi.fn(), logWarn: vi.fn() }));
import { DesktopAuthService } from '../src/main/auth/desktop-auth-service';

const origin = 'http://127.0.0.1:3000';
const user = { userId: 'account-user', displayName: 'Account user' };
const fetchMock = vi.fn();
const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }));
const rejected = () =>
  new Response(JSON.stringify({ success: false, code: 'invalid_grant' }), { status: 401 });
function session(expiresAt = Date.now() - 1000) {
  return {
    accessToken: 'account-old',
    refreshToken: 'refresh-old',
    tokenType: 'Bearer',
    user,
    apiOrigin: origin,
    updatedAt: 1,
    expiresAt,
  };
}
function tokens() {
  return { accessToken: 'account-new', refreshToken: 'refresh-new', expiresIn: 3600 };
}
beforeEach(() => {
  storage.clear();
  storage.set('session', session());
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('desktop account session lifecycle', () => {
  it('rotates expired tokens and persists only in the account store', async () => {
    fetchMock.mockResolvedValueOnce(ok(tokens()));
    const service = new DesktopAuthService(() => origin);
    const connection = await service.getPersonalAnalysisConnection();
    expect(connection).toEqual({
      apiOrigin: origin,
      accessToken: 'account-new',
      connectionMode: 'account',
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      grantType: 'refresh_token',
      refreshToken: 'refresh-old',
      clientId: 'sophorn-desktop',
    });
    expect(storage.get('session')).toMatchObject(tokensWithoutExpiry());
    expect(storage.has('personalAnalysis')).toBe(false);
  });

  it('uses the actual account token on localhost without mock-token substitution', async () => {
    storage.set('session', session(Date.now() + 3600_000));
    const service = new DesktopAuthService(() => origin);
    expect((await service.getPersonalAnalysisConnection())?.accessToken).toBe('account-old');
    expect(await service.requireLlmAccessToken()).toBe('account-old');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('coalesces concurrent refresh requests', async () => {
    fetchMock.mockImplementation(async () => ok(tokens()));
    const service = new DesktopAuthService(() => origin);
    const connections = await Promise.all([
      service.getPersonalAnalysisConnection(),
      service.getPersonalAnalysisConnection(),
      service.requireLlmAccessToken(),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(connections[2]).toBe('account-new');
  });

  it('does not refresh again for a rejected token already replaced by another request', async () => {
    storage.set('session', { ...session(Date.now() + 3600_000), accessToken: 'account-new' });
    const service = new DesktopAuthService(() => origin);
    expect((await service.getPersonalAnalysisConnection('account-old'))?.accessToken).toBe(
      'account-new'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not restore a session when refresh finishes after logout', async () => {
    let finish!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    fetchMock.mockResolvedValueOnce(ok({ loggedOut: true }));
    const service = new DesktopAuthService(() => origin);
    const pending = service.getPersonalAnalysisConnection();
    await service.logout();
    finish(ok(tokens()));
    await expect(pending).rejects.toThrow('session changed');
    expect(storage.get('session')).toBeNull();
  });

  it('keeps refresh credentials after temporary network failures', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const service = new DesktopAuthService(() => origin);
    expect(await service.getStatus()).toMatchObject({
      authenticated: true,
      connectionStatus: 'disconnected',
      error: 'offline',
    });
    expect(storage.get('session')).toMatchObject({ refreshToken: 'refresh-old' });
  });

  it('restores connected status after a temporary outage without signing in again', async () => {
    storage.set('session', session(Date.now() + 3600_000));
    fetchMock
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce(ok({ user, scope: 'ai read write' }))
      .mockResolvedValueOnce(ok({ availableCredits: 10 }));
    const service = new DesktopAuthService(() => origin);
    expect(await service.getStatus()).toMatchObject({
      authenticated: true,
      connectionStatus: 'disconnected',
    });
    expect(await service.getStatus()).toMatchObject({
      authenticated: true,
      connectionStatus: 'connected',
    });
    expect(storage.get('session')).toMatchObject({
      accessToken: 'account-old',
      refreshToken: 'refresh-old',
    });
  });

  it('clears the account only when its refresh credential is rejected', async () => {
    fetchMock.mockResolvedValueOnce(rejected());
    const service = new DesktopAuthService(() => origin);
    expect(await service.getStatus()).toMatchObject({ authenticated: false });
    expect(storage.get('session')).toBeNull();
  });

  it('refreshes on a server authentication rejection and fetches current user information', async () => {
    storage.set('session', session(Date.now() + 3600_000));
    fetchMock
      .mockResolvedValueOnce(rejected())
      .mockResolvedValueOnce(ok(tokens()))
      .mockResolvedValueOnce(
        ok({ user: { ...user, displayName: 'Updated user' }, scope: 'ai read write' })
      )
      .mockResolvedValueOnce(ok({ availableCredits: 12 }));
    const service = new DesktopAuthService(() => origin);
    expect(await service.getStatus()).toMatchObject({
      authenticated: true,
      user: { displayName: 'Updated user' },
      aiCredits: { availableCredits: 12 },
    });
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer account-new');
  });
});
function tokensWithoutExpiry() {
  return { accessToken: 'account-new', refreshToken: 'refresh-new' };
}
