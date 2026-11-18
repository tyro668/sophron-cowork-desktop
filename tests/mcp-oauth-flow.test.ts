import { createHash, randomBytes } from 'crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp/sophron-test',
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
  shell: {
    openExternal: async () => undefined,
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}));

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logCtx: vi.fn(),
  logCtxError: vi.fn(),
  logTiming: vi.fn(),
}));

vi.mock('../src/main/utils/shell-resolver', () => ({
  getDefaultShell: () => '/bin/bash',
}));

import { formatMcpTransportError } from '../src/main/mcp/mcp-http-error';
import { MCPManager, type MCPServerConfig } from '../src/main/mcp/mcp-manager';
import {
  getMcpOAuthStore,
  setMcpOAuthOpenExternal,
  setMcpOAuthStore,
} from '../src/main/mcp/mcp-oauth';
import { McpOAuthStore } from '../src/main/mcp/mcp-oauth-store';
import { sanitizeUrlForLog } from '../src/main/utils/sanitize-url';

const testCodec = {
  encrypt: (value: string) => `b64:${Buffer.from(value, 'utf8').toString('base64')}`,
  decrypt: (value: string) => Buffer.from(value.slice(4), 'base64').toString('utf8'),
};

describe('formatMcpTransportError', () => {
  it('uses the HTTP status when the POST body is empty', () => {
    const error = Object.assign(new Error('Streamable HTTP error: Error POSTing to endpoint: '), {
      code: 401,
    });
    expect(formatMcpTransportError(error)).toBe('HTTP 401 Unauthorized');
  });

  it('includes a short JSON body summary', () => {
    const error = Object.assign(
      new Error('Streamable HTTP error: Error POSTing to endpoint: {"error":"upstream failed"}'),
      { code: 500 }
    );
    expect(formatMcpTransportError(error)).toBe('HTTP 500 Internal Server Error: upstream failed');
  });

  it('does not leave a bare "Error POSTing to endpoint:" message', () => {
    expect(formatMcpTransportError(new Error('Error POSTing to endpoint:'))).toBe(
      'MCP request failed'
    );
  });
});

describe('MCP remote OAuth flow', () => {
  let server: FakeMcpOAuthServer;
  let tempDir: string;
  let manager: MCPManager;
  let openedAuthorizePaths: string[];

  beforeEach(async () => {
    server = await FakeMcpOAuthServer.start();
    tempDir = mkdtempSync(join(tmpdir(), 'mcp-oauth-'));
    setMcpOAuthStore(new McpOAuthStore(join(tempDir, 'mcp-oauth.json'), testCodec));
    openedAuthorizePaths = [];
    setMcpOAuthOpenExternal(async (url) => {
      openedAuthorizePaths.push(sanitizeUrlForLog(url));
      const response = await fetch(url, { redirect: 'manual' });
      const location = response.headers.get('location');
      if (!location) {
        throw new Error(`authorization endpoint did not redirect (HTTP ${response.status})`);
      }
      await fetch(location);
    });
    manager = new MCPManager();
  });

  afterEach(async () => {
    await manager.shutdown();
    await server.close();
    setMcpOAuthStore(null);
    rmSync(tempDir, { recursive: true, force: true });
  });

  function config(overrides: Partial<MCPServerConfig> = {}): MCPServerConfig {
    return {
      id: 'mcp-oauth-test',
      name: 'OAuth Test',
      type: 'streamable-http',
      url: server.mcpUrl,
      enabled: true,
      ...overrides,
    };
  }

  async function waitForStatus(status: string, timeoutMs = 8000): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const current = manager.getServerStatus().find((item) => item.id === 'mcp-oauth-test');
      if (current?.status === status) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(
      `Timed out waiting for status ${status}; last=${JSON.stringify(manager.getServerStatus())}`
    );
  }

  it('discovers OAuth, opens the browser, exchanges the code, and lists tools', async () => {
    const result = await manager.updateServer(config(), { interactiveAuth: true });
    expect(result.authorizing).toBe(true);
    expect(openedAuthorizePaths).toEqual([`${server.origin}/mcp/oauth/authorize`]);

    await waitForStatus('connected');
    const tools = manager.getTools().filter((tool) => tool.serverId === 'mcp-oauth-test');
    expect(tools.map((tool) => tool.originalName || tool.name)).toEqual(
      expect.arrayContaining(['ping'])
    );
    expect(getMcpOAuthStore().read('mcp-oauth-test')?.tokens?.access_token).toBeTruthy();

    const firstOpens = openedAuthorizePaths.length;
    const manager2 = new MCPManager();
    try {
      const second = await manager2.updateServer(config(), { interactiveAuth: false });
      expect(second.authorizing).toBeFalsy();
      expect(openedAuthorizePaths.length).toBe(firstOpens);
      expect(manager2.getServerStatus()[0]?.status).toBe('connected');
    } finally {
      await manager2.shutdown();
    }
  });

  it('can cancel a mid-flight authorization without leaving a partial session', async () => {
    let resolveOpen: () => void;
    const opened = new Promise<void>((resolve) => {
      resolveOpen = resolve;
    });
    setMcpOAuthOpenExternal(async (url) => {
      openedAuthorizePaths.push(sanitizeUrlForLog(url));
      resolveOpen();
      // Return after "opening" the browser — the callback is completed later
      // (or cancelled) by the loopback server.
    });

    const pending = manager.updateServer(config(), { interactiveAuth: true });
    await opened;
    const mid = await pending;
    expect(mid.authorizing).toBe(true);
    await manager.cancelAuthorization('mcp-oauth-test');
    expect(manager.getServerStatus()[0]?.status).toBe('needs_auth');
    expect(getMcpOAuthStore().read('mcp-oauth-test')?.tokens?.access_token).toBeFalsy();
  });

  it('surfaces a readable HTTP status when the server is not asking for OAuth', async () => {
    const failing = await startStatusServer(503);
    try {
      await expect(
        manager.updateServer(config({ id: 'mcp-fail', name: 'Failing', url: failing.url }), {
          interactiveAuth: true,
        })
      ).rejects.toThrow(/HTTP 503 Service Unavailable/);
    } finally {
      await failing.close();
    }
  });
});

class FakeMcpOAuthServer {
  readonly origin: string;
  readonly mcpUrl: string;
  private clients = new Map<string, { redirectUris: string[] }>();
  private codes = new Map<
    string,
    { clientId: string; redirectUri: string; challenge: string; expiresAt: number }
  >();
  private tokens = new Map<string, { clientId: string }>();
  private refreshTokens = new Map<string, string>();

  private constructor(
    private readonly server: ReturnType<typeof createServer>,
    port: number
  ) {
    this.origin = `http://127.0.0.1:${port}`;
    this.mcpUrl = `${this.origin}/mcp`;
  }

  static start(): Promise<FakeMcpOAuthServer> {
    return new Promise((resolve, reject) => {
      const holder: { inst?: FakeMcpOAuthServer } = {};
      const server = createServer((req, res) => {
        void holder.inst!.handle(req, res);
      });
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('failed to bind fake MCP server'));
          return;
        }
        holder.inst = new FakeMcpOAuthServer(server, address.port);
        resolve(holder.inst);
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', this.origin);
    try {
      if (req.method === 'GET' && url.pathname === '/.well-known/oauth-protected-resource/mcp') {
        return json(res, 200, {
          resource: this.mcpUrl,
          authorization_servers: [this.mcpUrl],
          bearer_methods_supported: ['header'],
          scopes_supported: ['tools'],
          resource_name: 'Fake MCP',
        });
      }
      if (req.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server/mcp') {
        return json(res, 200, {
          issuer: this.mcpUrl,
          authorization_endpoint: `${this.origin}/mcp/oauth/authorize`,
          token_endpoint: `${this.origin}/mcp/oauth/token`,
          registration_endpoint: `${this.origin}/mcp/oauth/register`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
          scopes_supported: ['tools'],
        });
      }
      if (req.method === 'POST' && url.pathname === '/mcp/oauth/register') {
        const body = (await readJson(req)) as { redirect_uris?: string[]; client_name?: string };
        const clientId = `client-${randomBytes(6).toString('hex')}`;
        this.clients.set(clientId, { redirectUris: body.redirect_uris || [] });
        return json(res, 200, {
          client_id: clientId,
          client_name: body.client_name,
          redirect_uris: body.redirect_uris,
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        });
      }
      if (req.method === 'GET' && url.pathname === '/mcp/oauth/authorize') {
        const clientId = url.searchParams.get('client_id') || '';
        const redirectUri = url.searchParams.get('redirect_uri') || '';
        const challenge = url.searchParams.get('code_challenge') || '';
        const method = url.searchParams.get('code_challenge_method');
        const state = url.searchParams.get('state') || '';
        const client = this.clients.get(clientId);
        if (
          !client ||
          !client.redirectUris.includes(redirectUri) ||
          method !== 'S256' ||
          !challenge
        ) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('invalid authorize request');
          return;
        }
        const code = randomBytes(16).toString('hex');
        this.codes.set(code, {
          clientId,
          redirectUri,
          challenge,
          expiresAt: Date.now() + 60_000,
        });
        const next = new URL(redirectUri);
        next.searchParams.set('code', code);
        if (state) next.searchParams.set('state', state);
        res.writeHead(302, { Location: next.toString() });
        res.end();
        return;
      }
      if (req.method === 'POST' && url.pathname === '/mcp/oauth/token') {
        const params = await readForm(req);
        if (params.get('grant_type') === 'authorization_code') {
          const code = params.get('code') || '';
          const record = this.codes.get(code);
          this.codes.delete(code);
          const verifier = params.get('code_verifier') || '';
          const challenge = createHash('sha256').update(verifier).digest('base64url');
          if (
            !record ||
            record.redirectUri !== (params.get('redirect_uri') || '') ||
            record.clientId !== (params.get('client_id') || '') ||
            record.challenge !== challenge ||
            record.expiresAt < Date.now()
          ) {
            return json(res, 400, { error: 'invalid_grant' });
          }
          const access = `atk-${randomBytes(12).toString('hex')}`;
          const refresh = `rtk-${randomBytes(12).toString('hex')}`;
          this.tokens.set(access, { clientId: record.clientId });
          this.refreshTokens.set(refresh, access);
          return json(res, 200, {
            access_token: access,
            refresh_token: refresh,
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'tools',
          });
        }
        if (params.get('grant_type') === 'refresh_token') {
          const refresh = params.get('refresh_token') || '';
          const previous = this.refreshTokens.get(refresh);
          if (!previous || !this.tokens.has(previous)) {
            return json(res, 400, { error: 'invalid_grant' });
          }
          this.tokens.delete(previous);
          const access = `atk-${randomBytes(12).toString('hex')}`;
          this.tokens.set(access, { clientId: 'refreshed' });
          this.refreshTokens.set(refresh, access);
          return json(res, 200, {
            access_token: access,
            refresh_token: refresh,
            token_type: 'Bearer',
            expires_in: 3600,
          });
        }
        return json(res, 400, { error: 'unsupported_grant_type' });
      }
      if (url.pathname === '/mcp') {
        const auth = req.headers.authorization || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
        if (!token || !this.tokens.has(token)) {
          res.writeHead(401, {
            'WWW-Authenticate': `Bearer resource_metadata="${this.origin}/.well-known/oauth-protected-resource/mcp", error="invalid_token"`,
            'Content-Length': '0',
          });
          res.end();
          return;
        }
        if (req.method !== 'POST') {
          res.writeHead(405).end();
          return;
        }
        const body = (await readJson(req)) as {
          jsonrpc?: string;
          id?: unknown;
          method?: string;
        };
        if (body.method === 'initialize') {
          return json(res, 200, {
            jsonrpc: '2.0',
            id: body.id,
            result: {
              protocolVersion: '2025-03-26',
              capabilities: { tools: {} },
              serverInfo: { name: 'fake-mcp', version: '1.0.0' },
            },
          });
        }
        if (body.method === 'notifications/initialized' || body.id === undefined) {
          res.writeHead(202).end();
          return;
        }
        if (body.method === 'tools/list') {
          return json(res, 200, {
            jsonrpc: '2.0',
            id: body.id,
            result: {
              tools: [
                {
                  name: 'ping',
                  description: 'Ping the fake server',
                  inputSchema: { type: 'object', properties: {} },
                },
              ],
            },
          });
        }
        return json(res, 200, {
          jsonrpc: '2.0',
          id: body.id,
          error: { code: -32601, message: 'Method not found' },
        });
      }
      res.writeHead(404).end();
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': payload.length,
  });
  res.end(payload);
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const type = String(req.headers['content-type'] || '');
      if (type.includes('application/json')) {
        const parsed = raw ? (JSON.parse(raw) as Record<string, string>) : {};
        resolve(new URLSearchParams(parsed));
        return;
      }
      resolve(new URLSearchParams(raw));
    });
    req.on('error', reject);
  });
}

function startStatusServer(status: number): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = createServer((_req, res) => {
      res.writeHead(status, { 'Content-Length': '0' });
      res.end();
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('failed to bind status server'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}/mcp`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
