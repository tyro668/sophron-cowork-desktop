import { describe, expect, it } from 'vitest';
import { getPersonalAnalysisErrorMessage } from '../src/shared/personal-analysis';
const t = (key: string) => key;
describe('cloud authorization error messages', () => {
  it.each([
    'HTTP 401 unauthorized',
    'HTTP 200 61311002 token 无效',
    'Please sign in before accessing cloud analysis',
    'Refresh token 无效',
  ])('does not ask account users to configure an API key: %s', (message) => {
    expect(getPersonalAnalysisErrorMessage(new Error(message), t)).toBe('cloudData.errorAuth');
  });
  it.each([
    'API Key 无效或已过期',
    'POST /api/personal/api-keys/token failed: HTTP 401',
    'Cloud Space apiKey is not configured',
  ])('identifies API key failures: %s', (message) => {
    expect(getPersonalAnalysisErrorMessage(new Error(message), t)).toBe('cloudData.errorApiKey');
  });
});
