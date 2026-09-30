import '../../src/main/agent/pi-oauth-runtime';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import {
  getProviderApiKey,
  getSharedAuthStorage,
  getSharedModelRuntime,
  setRuntimeApiKey,
} from '../../src/main/agent/shared-auth';

// Synthetic credential: auth derivation is local and must never contact a server.
export async function verifyBundledOAuth() {
  const credential = {
    type: 'oauth' as const,
    access: 'synthetic-access',
    refresh: 'synthetic-refresh',
    expires: Date.now() + 3600000,
  };
  const runtime = await ModelRuntime.create({
    modelsPath: null,
    refreshOnCreate: false,
    allowModelNetwork: false,
    credentials: {
      read: async () => credential,
      list: async () => [{ providerId: 'openai-codex', type: 'oauth' as const }],
      modify: async () => {
        throw new Error('Unexpected credential refresh');
      },
      delete: async () => {
        throw new Error('Unexpected credential deletion');
      },
    },
  });
  const result = await runtime.getAuth('openai-codex');
  if (result?.auth.apiKey !== 'synthetic-access') throw new Error('Bundled OAuth failed');
  // Exercise the actual helpers used by diagnostics and agent sessions.
  // The subprocess redirects the credential store to a temporary directory.
  getSharedAuthStorage().set('openai-codex', credential);
  const shared = await getSharedModelRuntime();
  await setRuntimeApiKey('openai-codex', 'must-not-mask-oauth');
  for (let attempt = 0; attempt < 3; attempt++) {
    if ((await getProviderApiKey('openai-codex')) !== credential.access) {
      throw new Error('Repeated auth lookup lost OAuth credentials');
    }
    if ((await shared.getAuth('openai-codex'))?.auth.apiKey !== credential.access) {
      throw new Error('Session auth lost OAuth credentials');
    }
  }
  // Reproduce the old bug in the real SDK, then verify recovery.
  await shared.setRuntimeApiKey('openai-codex', credential.access);
  if ((await shared.getAuth('openai-codex')) !== undefined)
    throw new Error('Expected masked OAuth');
  if ((await getProviderApiKey('openai-codex')) !== credential.access)
    throw new Error('OAuth recovery failed');
  if (getSharedAuthStorage().get('openai-codex')?.type !== 'oauth')
    throw new Error('Stored OAuth changed');
  // App-level provider ids (e.g. `aliyun`) have no pi-ai builtin provider.
  // Publishing a runtime key must register a provider so session auth checks
  // (hasConfiguredAuth/checkAuth/getAuth) resolve instead of reporting
  // "No API key found for <provider>".
  await setRuntimeApiKey('aliyun', 'sk-aliyun');
  if (!shared.getProvider('aliyun')) throw new Error('aliyun provider not registered');
  if (!shared.hasConfiguredAuth('aliyun')) throw new Error('aliyun not marked configured');
  if ((await shared.checkAuth('aliyun')) === undefined) throw new Error('aliyun checkAuth failed');
  if ((await shared.getAuth('aliyun'))?.auth.apiKey !== 'sk-aliyun')
    throw new Error('aliyun getAuth did not return runtime key');
  if ((await getProviderApiKey('aliyun')) !== 'sk-aliyun')
    throw new Error('aliyun provider api key lookup failed');
}
