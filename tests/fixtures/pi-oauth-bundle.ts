import '../../src/main/agent/pi-oauth-runtime';
import assert from 'node:assert/strict';
import { buildSyntheticPiModel } from '../../src/main/agent/pi-model-resolution';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import {
  getProviderApiKey,
  getSharedAuthStorage,
  getSharedModelRuntime,
  createSessionModelRuntime,
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
  await createSessionModelRuntime('openai-codex', 'must-not-mask-oauth');
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
  const [chat, automation] = await Promise.all([
    createSessionModelRuntime('aliyun', 'chat-only'),
    createSessionModelRuntime('aliyun', 'automation-only'),
  ]);
  const routes = [
    { runtime: chat, baseUrl: 'https://chat.example.test/v1', key: 'chat-only' },
    { runtime: automation, baseUrl: 'https://automation.example.test/v1', key: 'automation-only' },
  ];
  for (const route of routes) {
    assert.ok(route.runtime.hasConfiguredAuth('aliyun'));
    assert.ok(await route.runtime.checkAuth('aliyun'));
  }
  const requests: Array<[string, string | null]> = [];
  // Exercise Pi's actual request preparation and HTTP adapter with an offline transport.
  for (const [step, route] of [routes[0], routes[1], routes[0], routes[0]].entries()) {
    const model = buildSyntheticPiModel('offline', 'aliyun', 'openai', route.baseUrl);
    const response = await route.runtime.completeSimple(
      model,
      { messages: [{ role: 'user', content: 'probe', timestamp: 0 }] },
      {
        fetch: async (input, init) => {
          const request = new Request(input, init);
          requests.push([request.url, request.headers.get('authorization')]);
          if (step === 2)
            return Response.json({ error: { message: 'Retry fixture' } }, { status: 401 });
          return new Response(
            'data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
            { headers: { 'Content-Type': 'text/event-stream' } }
          );
        },
      }
    );
    assert.equal(
      response.stopReason,
      step === 2 ? 'error' : 'stop',
      response.errorMessage ?? 'Unexpected SDK stop reason'
    );
  }
  assert.deepEqual(
    requests,
    [routes[0], routes[1], routes[0], routes[0]].map((route) => [
      `${route.baseUrl}/chat/completions`,
      `Bearer ${route.key}`,
    ])
  );
  if (shared.getProviderAuthStatus('aliyun').source === 'runtime') {
    throw new Error('Session credentials leaked to the shared runtime');
  }
}
