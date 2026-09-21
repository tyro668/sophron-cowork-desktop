import { describe, expect, it } from 'vitest';
import type { AppConfig, DesktopAuthStatus } from '../src/shared/contracts/config';
import { getCloudConnectionPayload } from '../src/renderer/components/settings/schedule/types';

const ORIGIN = 'https://analysis.example.com';
const ACCOUNT_ORIGIN = 'https://account.example.com';

function appConfig(apiOrigin = ORIGIN, apiKey = 'sk-test'): AppConfig {
  return { personalAnalysis: { apiOrigin, apiKey, updatedAt: 1 } } as AppConfig;
}

function auth(authenticated: boolean, apiOrigin = ACCOUNT_ORIGIN): DesktopAuthStatus {
  return { authenticated, apiOrigin, updatedAt: 1 } as DesktopAuthStatus;
}

describe('getCloudConnectionPayload', () => {
  it('prefers the configured API key connection over the signed-in account', () => {
    expect(getCloudConnectionPayload(appConfig(), auth(true))).toEqual({
      apiOrigin: ORIGIN,
      apiKey: 'sk-test',
      connectionMode: 'apiKey',
    });
  });

  it('falls back to the signed-in account once the API key is disconnected', () => {
    const config = appConfig('', '');
    expect(getCloudConnectionPayload(config, auth(true))).toEqual({
      apiOrigin: ACCOUNT_ORIGIN,
      connectionMode: 'account',
    });
  });

  it('uses the API key service standalone while signed out', () => {
    expect(getCloudConnectionPayload(appConfig(), auth(false, ''))).toEqual({
      apiOrigin: ORIGIN,
      apiKey: 'sk-test',
      connectionMode: 'apiKey',
    });
  });

  it('returns the stored origin only when neither service is available', () => {
    expect(getCloudConnectionPayload(null, auth(false))).toEqual({
      apiOrigin: '',
      connectionMode: 'account',
    });
  });
});
