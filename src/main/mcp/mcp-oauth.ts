/**
 * MCP OAuth 2.0 authorization-code + PKCE for remote HTTP and SSE connectors.
 *
 * Wraps the SDK OAuthClientProvider: RFC 9728 / 8414 discovery and DCR are
 * performed by the SDK; this module owns the loopback callback, browser
 * redirect, encrypted token storage, cancel/timeout, and log redaction.
 */
import * as http from 'http';
import * as crypto from 'crypto';
import { app, safeStorage, shell } from 'electron';
import path from 'path';
import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { APP_NAME_ZH } from '../../shared/branding';
import { log, logWarn } from '../utils/logger';
import { sanitizeUrlForLog } from '../utils/sanitize-url';
import { McpOAuthStore, type SecretCodec } from './mcp-oauth-store';

export const MCP_OAUTH_TIMEOUT_MS = 5 * 60 * 1000;
const CALLBACK_PATH = '/callback';
const PREFERRED_PORT = 17862;

export type McpOAuthOpenExternal = (url: string) => Promise<void>;

let store: McpOAuthStore | null = null;
let openExternalFn: McpOAuthOpenExternal = async (url: string) => {
  await shell.openExternal(url);
};

const defaultCodec: SecretCodec = {
  encrypt(value: string) {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        return `v1:${safeStorage.encryptString(value).toString('base64')}`;
      }
    } catch {
      // Fall through to obfuscated storage when the keychain is unavailable.
    }
    return `b64:${Buffer.from(value, 'utf8').toString('base64')}`;
  },
  decrypt(value: string) {
    if (value.startsWith('v1:')) {
      return safeStorage.decryptString(Buffer.from(value.slice(3), 'base64'));
    }
    if (value.startsWith('b64:')) {
      return Buffer.from(value.slice(4), 'base64').toString('utf8');
    }
    throw new Error('unknown mcp oauth encoding');
  },
};

export function setMcpOAuthStore(next: McpOAuthStore | null): void {
  store = next;
}

export function setMcpOAuthOpenExternal(fn: McpOAuthOpenExternal): void {
  openExternalFn = fn;
}

export function getMcpOAuthStore(): McpOAuthStore {
  if (store) return store;
  const userData = app.getPath('userData');
  store = new McpOAuthStore(path.join(userData, 'mcp-oauth.json'), defaultCodec);
  return store;
}

export function isUnauthorizedError(error: unknown): boolean {
  return (
    error instanceof UnauthorizedError || (error as { name?: string })?.name === 'UnauthorizedError'
  );
}

export interface McpLoopbackCallback {
  redirectUri: string;
  waitForCallback: Promise<{ code: string; state: string | null }>;
  cancel: (reason?: string) => void;
  close: () => Promise<void>;
}

export async function startMcpOAuthLoopback(options: {
  preferredRedirectUri?: string;
  timeoutMs?: number;
  expectedState?: () => string | undefined;
}): Promise<McpLoopbackCallback> {
  const timeoutMs = options.timeoutMs ?? MCP_OAUTH_TIMEOUT_MS;
  let settled = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let resolveCallback: (value: { code: string; state: string | null }) => void;
  let rejectCallback: (error: Error) => void;
  const waitForCallback = new Promise<{ code: string; state: string | null }>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

  const finish = (fn: () => void) => {
    if (settled) return;
    settled = true;
    if (timeout) clearTimeout(timeout);
    fn();
  };

  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
    if (requestUrl.pathname !== CALLBACK_PATH) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    const error = requestUrl.searchParams.get('error');
    if (error) {
      const description = requestUrl.searchParams.get('error_description') || error;
      response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(callbackPage('授权未完成', `授权被拒绝：${description}`));
      finish(() => rejectCallback(new Error(description)));
      return;
    }

    const expected = options.expectedState?.();
    const state = requestUrl.searchParams.get('state');
    if (expected && state !== expected) {
      response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(callbackPage('授权未完成', '登录回调状态不匹配，请重试。'));
      finish(() => rejectCallback(new Error('OAuth callback state mismatch')));
      return;
    }

    const code = requestUrl.searchParams.get('code');
    if (!code) {
      response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(callbackPage('授权未完成', '回调中没有授权码。'));
      finish(() =>
        rejectCallback(new Error('OAuth callback did not include an authorization code'))
      );
      return;
    }

    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(callbackPage('授权已完成', `可以返回${APP_NAME_ZH}。`));
    finish(() => resolveCallback({ code, state }));
  });

  const listenPort = preferredPort(options.preferredRedirectUri);
  const redirectUri = await listen(server, listenPort).catch(async (error) => {
    if (listenPort === 0) throw error;
    logWarn(
      `[MCP OAuth] Preferred callback port ${listenPort} unavailable, allocating a free port`
    );
    return listen(server, 0);
  });

  timeout = setTimeout(() => {
    finish(() => rejectCallback(new Error('MCP authorization timed out')));
  }, timeoutMs);

  return {
    redirectUri,
    waitForCallback,
    cancel: (reason = 'MCP authorization cancelled') => {
      finish(() => rejectCallback(new Error(reason)));
    },
    close: () =>
      new Promise<void>((resolve) => {
        if (timeout) clearTimeout(timeout);
        server.close(() => resolve());
      }),
  };
}

function preferredPort(redirectUri?: string): number {
  if (!redirectUri) return PREFERRED_PORT;
  try {
    const parsed = new URL(redirectUri);
    if (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') {
      return parsed.port ? Number(parsed.port) : PREFERRED_PORT;
    }
  } catch {
    // Fall through.
  }
  return PREFERRED_PORT;
}

function listen(server: http.Server, port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to allocate MCP OAuth callback port'));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}${CALLBACK_PATH}`);
    });
  });
}

function callbackPage(title: string, body: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family: system-ui; padding: 32px;"><h1 style="font-size: 20px;">${title}</h1><p>${body}</p></body>`;
}

export class McpOAuthClientProvider implements OAuthClientProvider {
  private pendingState: string | undefined;
  private inMemoryVerifier: string | undefined;

  constructor(
    private readonly serverId: string,
    private readonly oauthStore: McpOAuthStore,
    private readonly redirectUri: string,
    private readonly hooks: {
      interactive: boolean;
      onRedirect: (url: URL) => void | Promise<void>;
    }
  ) {}

  get redirectUrl(): string {
    return this.redirectUri;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: APP_NAME_ZH,
      redirect_uris: [this.redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  state(): string {
    this.pendingState = crypto.randomBytes(16).toString('hex');
    this.oauthStore.update(this.serverId, { lastState: this.pendingState });
    return this.pendingState;
  }

  expectedState(): string | undefined {
    return this.pendingState ?? this.oauthStore.read(this.serverId)?.lastState;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    const stored = this.oauthStore.read(this.serverId)?.clientInformation;
    if (!stored) return undefined;
    const storedRedirects = (stored as { redirect_uris?: string[] }).redirect_uris;
    if (storedRedirects && !storedRedirects.includes(this.redirectUri)) {
      // Redirect URI changed (different loopback port) — force re-registration.
      return undefined;
    }
    return stored;
  }

  saveClientInformation(clientInformation: OAuthClientInformationMixed): void {
    this.oauthStore.update(this.serverId, {
      clientInformation,
      redirectUri: this.redirectUri,
    });
  }

  tokens(): OAuthTokens | undefined {
    const tokens = this.oauthStore.read(this.serverId)?.tokens;
    if (!tokens?.access_token) return undefined;
    return tokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    this.oauthStore.update(this.serverId, { tokens, codeVerifier: undefined });
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (!this.hooks.interactive) {
      log(
        `[MCP OAuth] Authorization required for ${this.serverId}; waiting for a user-initiated login`
      );
      return;
    }
    log(
      `[MCP OAuth] Opening system browser for authorization: ${sanitizeUrlForLog(authorizationUrl.toString())}`
    );
    await this.hooks.onRedirect(authorizationUrl);
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.inMemoryVerifier = codeVerifier;
    this.oauthStore.update(this.serverId, { codeVerifier });
  }

  codeVerifier(): string {
    const verifier = this.inMemoryVerifier || this.oauthStore.read(this.serverId)?.codeVerifier;
    if (!verifier) {
      throw new Error('Missing PKCE code verifier for MCP authorization');
    }
    return verifier;
  }

  saveDiscoveryState(state: OAuthDiscoveryState): void {
    this.oauthStore.update(this.serverId, { discovery: state });
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.oauthStore.read(this.serverId)?.discovery;
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    if (scope === 'all') {
      this.inMemoryVerifier = undefined;
      this.oauthStore.delete(this.serverId);
      return;
    }
    const patch: {
      clientInformation?: undefined;
      tokens?: undefined;
      codeVerifier?: undefined;
      discovery?: undefined;
    } = {};
    if (scope === 'client') patch.clientInformation = undefined;
    if (scope === 'tokens') patch.tokens = undefined;
    if (scope === 'verifier') {
      this.inMemoryVerifier = undefined;
      patch.codeVerifier = undefined;
    }
    if (scope === 'discovery') patch.discovery = undefined;
    this.oauthStore.update(this.serverId, patch);
  }
}

export interface PreparedMcpOAuth {
  provider: McpOAuthClientProvider;
  loopback: McpLoopbackCallback | null;
}

export async function prepareMcpOAuthSession(options: {
  serverId: string;
  interactive: boolean;
  openExternal?: McpOAuthOpenExternal;
}): Promise<PreparedMcpOAuth> {
  const oauthStore = getMcpOAuthStore();
  const storedRedirect = oauthStore.read(options.serverId)?.redirectUri;
  const open = options.openExternal ?? openExternalFn;

  if (!options.interactive) {
    const redirectUri = storedRedirect || `http://127.0.0.1:${PREFERRED_PORT}${CALLBACK_PATH}`;
    return {
      provider: new McpOAuthClientProvider(options.serverId, oauthStore, redirectUri, {
        interactive: false,
        onRedirect: () => undefined,
      }),
      loopback: null,
    };
  }

  const holder: { provider?: McpOAuthClientProvider } = {};
  const loopback = await startMcpOAuthLoopback({
    preferredRedirectUri: storedRedirect,
    expectedState: () => holder.provider?.expectedState(),
  });
  holder.provider = new McpOAuthClientProvider(options.serverId, oauthStore, loopback.redirectUri, {
    interactive: true,
    onRedirect: async (authorizationUrl) => {
      await open(authorizationUrl.toString());
    },
  });
  return { provider: holder.provider, loopback };
}

export function deleteMcpOAuthCredentials(serverId: string): void {
  getMcpOAuthStore().delete(serverId);
}

export function hasMcpOAuthTokens(serverId: string): boolean {
  return Boolean(getMcpOAuthStore().read(serverId)?.tokens?.access_token);
}

export function clearMcpOAuthTokens(serverId: string): void {
  const current = getMcpOAuthStore().read(serverId);
  if (!current) return;
  getMcpOAuthStore().update(serverId, { tokens: undefined, codeVerifier: undefined });
}
