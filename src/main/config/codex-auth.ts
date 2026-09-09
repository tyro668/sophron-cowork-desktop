/**
 * @module main/config/codex-auth
 *
 * Credential management for the `openai-codex` provider (ChatGPT subscription).
 *
 * Two credential sources are supported:
 * - Local codex CLI login state (`~/.codex/auth.json`), imported read-only
 * - In-app OAuth login via pi-ai's `loginOpenAICodex` (PKCE + localhost callback)
 *
 * Imported/acquired tokens live in the shared pi-coding-agent `AuthStorage`
 * (`~/.pi/agent/auth.json`) as `{ type: 'oauth', ... }` credentials, so
 * `AuthStorage.getApiKey()` transparently refreshes expired access tokens.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { log, logWarn } from '../utils/logger';
import { getSharedAuthStorage } from '../claude/shared-auth';

export const OPENAI_CODEX_PROVIDER = 'openai-codex';

const SOURCE_FIELD = 'codexAuthSource';

function defaultCodexCliAuthPath(): string {
  return process.env.SOPHRON_CODEX_AUTH_PATH || path.join(os.homedir(), '.codex', 'auth.json');
}

export interface CodexCliCredentials {
  access: string;
  refresh: string;
  /** Epoch ms when the access token expires; 0 when unknown (forces refresh). */
  expires: number;
  accountId?: string;
}

export interface CodexAuthStatus {
  connected: boolean;
  source: 'codex-cli' | 'app' | null;
  accountId?: string;
  expiresAt?: number;
}

interface CodexCliAuthFile {
  tokens?: {
    access_token?: unknown;
    refresh_token?: unknown;
    account_id?: unknown;
  };
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1]) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

function accessTokenExpiresAt(accessToken: string): number {
  const payload = decodeJwtPayload(accessToken);
  const exp = payload?.exp;
  return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : 0;
}

function accountIdFromAccessToken(accessToken: string): string | undefined {
  const payload = decodeJwtPayload(accessToken);
  const auth = payload?.['https://api.openai.com/auth'] as Record<string, unknown> | undefined;
  const accountId = auth?.chatgpt_account_id;
  return typeof accountId === 'string' && accountId.length > 0 ? accountId : undefined;
}

/**
 * Read the local codex CLI login state. Returns null when the file is missing
 * or does not contain usable OAuth tokens.
 */
export function readCodexCliCredentials(authPath?: string): CodexCliCredentials | null {
  const resolvedPath = authPath || defaultCodexCliAuthPath();
  let raw: string;
  try {
    raw = fs.readFileSync(resolvedPath, 'utf8');
  } catch {
    return null;
  }

  let parsed: CodexCliAuthFile;
  try {
    parsed = JSON.parse(raw) as CodexCliAuthFile;
  } catch {
    logWarn('[CodexAuth] Failed to parse codex CLI auth file:', resolvedPath);
    return null;
  }

  const access = parsed.tokens?.access_token;
  const refresh = parsed.tokens?.refresh_token;
  if (typeof access !== 'string' || !access || typeof refresh !== 'string' || !refresh) {
    return null;
  }

  const accountIdField = parsed.tokens?.account_id;
  const accountId =
    typeof accountIdField === 'string' && accountIdField
      ? accountIdField
      : accountIdFromAccessToken(access);

  return {
    access,
    refresh,
    expires: accessTokenExpiresAt(access),
    accountId,
  };
}

/**
 * Make sure the shared AuthStorage holds OAuth credentials for openai-codex.
 * Imports from the local codex CLI auth file when nothing is stored yet (or
 * when `forceImport` is set, e.g. the user re-ran `codex login`). Existing
 * stored credentials are otherwise left untouched — AuthStorage refreshes
 * them automatically.
 *
 * Returns true when usable OAuth credentials are available afterwards.
 */
export function ensureCodexCredentials(options?: { forceImport?: boolean }): boolean {
  const authStorage = getSharedAuthStorage();
  const stored = authStorage.get(OPENAI_CODEX_PROVIDER);
  const hasStored = stored?.type === 'oauth';

  if (hasStored && !options?.forceImport) {
    return true;
  }

  const cli = readCodexCliCredentials();
  if (!cli) {
    return hasStored;
  }

  authStorage.set(OPENAI_CODEX_PROVIDER, {
    type: 'oauth',
    access: cli.access,
    refresh: cli.refresh,
    expires: cli.expires,
    ...(cli.accountId ? { accountId: cli.accountId } : {}),
    [SOURCE_FIELD]: 'codex-cli',
  });
  log('[CodexAuth] Imported codex CLI credentials into AuthStorage');
  return true;
}

function storedSource(
  stored: Record<string, unknown>,
  cli: CodexCliCredentials | null
): 'codex-cli' | 'app' {
  const tag = stored[SOURCE_FIELD];
  if (tag === 'codex-cli' || tag === 'app') return tag;
  return cli && cli.refresh === stored.refresh ? 'codex-cli' : 'app';
}

/**
 * Cheap synchronous check used by ConfigStore.hasUsableCredentials():
 * true when OAuth credentials are stored or a local codex CLI login exists.
 */
export function hasCodexCredentials(): boolean {
  const stored = getSharedAuthStorage().get(OPENAI_CODEX_PROVIDER);
  if (stored?.type === 'oauth') return true;
  return readCodexCliCredentials() !== null;
}

export function getCodexAuthStatus(): CodexAuthStatus {
  const authStorage = getSharedAuthStorage();
  const stored = authStorage.get(OPENAI_CODEX_PROVIDER);

  if (stored?.type === 'oauth') {
    const cli = readCodexCliCredentials();
    const record = stored as unknown as Record<string, unknown>;
    return {
      connected: true,
      source: storedSource(record, cli),
      accountId: typeof record.accountId === 'string' ? record.accountId : undefined,
      expiresAt:
        typeof stored.expires === 'number' && stored.expires > 0 ? stored.expires : undefined,
    };
  }

  const cli = readCodexCliCredentials();
  if (cli) {
    return {
      connected: true,
      source: 'codex-cli',
      accountId: cli.accountId,
      expiresAt: cli.expires > 0 ? cli.expires : undefined,
    };
  }

  return { connected: false, source: null };
}

export interface CodexLoginHooks {
  onAuthUrl?: (url: string) => void;
  onPromptCode?: (message: string) => Promise<string>;
}

/**
 * Run the in-app ChatGPT OAuth login flow (browser + localhost callback).
 * The caller wires `onAuthUrl` (e.g. shell.openExternal) and `onPromptCode`
 * (manual paste fallback when the callback server cannot bind).
 */
export async function loginCodex(hooks: CodexLoginHooks): Promise<CodexAuthStatus> {
  const { loginOpenAICodex } = await import('@mariozechner/pi-ai/oauth');

  const credentials = await loginOpenAICodex({
    originator: 'sophron',
    onAuth: ({ url }) => {
      hooks.onAuthUrl?.(url);
    },
    onPrompt: async ({ message }) => {
      if (!hooks.onPromptCode) {
        throw new Error('OAuth callback server unavailable and no manual code handler configured');
      }
      return hooks.onPromptCode(message);
    },
  });

  const authStorage = getSharedAuthStorage();
  authStorage.set(OPENAI_CODEX_PROVIDER, {
    type: 'oauth',
    ...credentials,
    [SOURCE_FIELD]: 'app',
  });
  log('[CodexAuth] In-app OAuth login succeeded');
  return getCodexAuthStatus();
}

export function logoutCodex(): CodexAuthStatus {
  const authStorage = getSharedAuthStorage();
  authStorage.remove(OPENAI_CODEX_PROVIDER);
  log('[CodexAuth] Removed stored openai-codex credentials');
  return getCodexAuthStatus();
}
