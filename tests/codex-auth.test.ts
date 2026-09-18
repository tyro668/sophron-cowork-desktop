import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mocks = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  return {
    store,
    get: (provider: string) => store.get(provider),
    set: (provider: string, credential: unknown) => {
      store.set(provider, credential);
    },
    remove: (provider: string) => {
      store.delete(provider);
    },
  };
});

vi.mock('../src/main/agent/shared-auth', () => ({
  getSharedAuthStorage: () => ({
    get: mocks.get,
    set: mocks.set,
    remove: mocks.remove,
  }),
}));

import {
  ensureCodexCredentials,
  getCodexAuthStatus,
  hasCodexCredentials,
  logoutCodex,
  OPENAI_CODEX_PROVIDER,
  readCodexCliCredentials,
} from '../src/main/config/codex-auth';

function makeJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.signature`;
}

const ACCESS_EXP_MS = 1_893_456_000_000; // 2030-01-01
const ACCESS_TOKEN = makeJwt({ exp: ACCESS_EXP_MS / 1000 });
const ACCESS_TOKEN_WITH_ACCOUNT = makeJwt({
  exp: ACCESS_EXP_MS / 1000,
  'https://api.openai.com/auth': { chatgpt_account_id: 'acct-from-jwt' },
});

function writeCliAuth(dir: string, contents: unknown): string {
  const authPath = path.join(dir, 'auth.json');
  fs.writeFileSync(authPath, typeof contents === 'string' ? contents : JSON.stringify(contents));
  return authPath;
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-auth-test-'));
  mocks.store.clear();
  delete process.env.SOPHRON_CODEX_AUTH_PATH;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.SOPHRON_CODEX_AUTH_PATH;
});

describe('readCodexCliCredentials', () => {
  it('returns null when the auth file does not exist', () => {
    expect(readCodexCliCredentials(path.join(tmpDir, 'missing.json'))).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    const authPath = writeCliAuth(tmpDir, '{not json');
    expect(readCodexCliCredentials(authPath)).toBeNull();
  });

  it('returns null when tokens are missing or incomplete', () => {
    expect(readCodexCliCredentials(writeCliAuth(tmpDir, {}))).toBeNull();
    expect(
      readCodexCliCredentials(writeCliAuth(tmpDir, { tokens: { access_token: ACCESS_TOKEN } }))
    ).toBeNull();
    expect(
      readCodexCliCredentials(
        writeCliAuth(tmpDir, { tokens: { access_token: 1, refresh_token: 'r' } })
      )
    ).toBeNull();
  });

  it('parses tokens, derives expiry from the JWT exp claim and accountId from the file', () => {
    const authPath = writeCliAuth(tmpDir, {
      OPENAI_API_KEY: null,
      tokens: {
        access_token: ACCESS_TOKEN,
        refresh_token: 'refresh-1',
        id_token: 'id',
        account_id: 'acct-from-file',
      },
      last_refresh: '2026-09-01T00:00:00Z',
    });

    expect(readCodexCliCredentials(authPath)).toEqual({
      access: ACCESS_TOKEN,
      refresh: 'refresh-1',
      expires: ACCESS_EXP_MS,
      accountId: 'acct-from-file',
    });
  });

  it('falls back to the JWT claim for accountId and 0 for unknown expiry', () => {
    const noExpToken = makeJwt({
      'https://api.openai.com/auth': { chatgpt_account_id: 'acct-from-jwt' },
    });
    const authPath = writeCliAuth(tmpDir, {
      tokens: { access_token: noExpToken, refresh_token: 'refresh-1' },
    });

    const creds = readCodexCliCredentials(authPath);
    expect(creds?.expires).toBe(0);
    expect(creds?.accountId).toBe('acct-from-jwt');
  });

  it('prefers the file account_id over the JWT claim', () => {
    const authPath = writeCliAuth(tmpDir, {
      tokens: {
        access_token: ACCESS_TOKEN_WITH_ACCOUNT,
        refresh_token: 'refresh-1',
        account_id: 'acct-from-file',
      },
    });
    expect(readCodexCliCredentials(authPath)?.accountId).toBe('acct-from-file');
  });
});

describe('ensureCodexCredentials', () => {
  it('imports CLI credentials when nothing is stored', () => {
    writeCliAuth(tmpDir, {
      tokens: { access_token: ACCESS_TOKEN, refresh_token: 'refresh-1', account_id: 'acct-1' },
    });
    process.env.SOPHRON_CODEX_AUTH_PATH = path.join(tmpDir, 'auth.json');

    expect(ensureCodexCredentials()).toBe(true);
    const stored = mocks.store.get(OPENAI_CODEX_PROVIDER) as Record<string, unknown>;
    expect(stored).toMatchObject({
      type: 'oauth',
      access: ACCESS_TOKEN,
      refresh: 'refresh-1',
      expires: ACCESS_EXP_MS,
      accountId: 'acct-1',
    });
  });

  it('keeps existing stored credentials unless forceImport is set', () => {
    mocks.store.set(OPENAI_CODEX_PROVIDER, {
      type: 'oauth',
      access: 'a-stored',
      refresh: 'r-stored',
      expires: 123,
    });
    writeCliAuth(tmpDir, {
      tokens: { access_token: ACCESS_TOKEN, refresh_token: 'refresh-cli' },
    });
    process.env.SOPHRON_CODEX_AUTH_PATH = path.join(tmpDir, 'auth.json');

    expect(ensureCodexCredentials()).toBe(true);
    expect((mocks.store.get(OPENAI_CODEX_PROVIDER) as { refresh: string }).refresh).toBe(
      'r-stored'
    );

    expect(ensureCodexCredentials({ forceImport: true })).toBe(true);
    expect((mocks.store.get(OPENAI_CODEX_PROVIDER) as { refresh: string }).refresh).toBe(
      'refresh-cli'
    );
  });

  it('re-imports when the CLI rotated to a newer token pair than the stored CLI copy', () => {
    const staleAccess = makeJwt({ exp: 1_700_000_000 });
    mocks.store.set(OPENAI_CODEX_PROVIDER, {
      type: 'oauth',
      access: staleAccess,
      refresh: 'refresh-old',
      expires: 1_700_000_000_000,
      codexAuthSource: 'codex-cli',
    });
    writeCliAuth(tmpDir, {
      tokens: { access_token: ACCESS_TOKEN, refresh_token: 'refresh-new', account_id: 'acct-2' },
    });
    process.env.SOPHRON_CODEX_AUTH_PATH = path.join(tmpDir, 'auth.json');

    expect(ensureCodexCredentials()).toBe(true);
    expect(mocks.store.get(OPENAI_CODEX_PROVIDER)).toMatchObject({
      access: ACCESS_TOKEN,
      refresh: 'refresh-new',
      expires: ACCESS_EXP_MS,
      accountId: 'acct-2',
      codexAuthSource: 'codex-cli',
    });
  });

  it('keeps the stored pair when it is newer than the CLI file (own refresh won)', () => {
    const freshAccess = makeJwt({ exp: ACCESS_EXP_MS / 1000 + 1000 });
    mocks.store.set(OPENAI_CODEX_PROVIDER, {
      type: 'oauth',
      access: freshAccess,
      refresh: 'refresh-ours',
      expires: ACCESS_EXP_MS + 1_000_000,
      codexAuthSource: 'codex-cli',
    });
    writeCliAuth(tmpDir, {
      tokens: { access_token: ACCESS_TOKEN, refresh_token: 'refresh-cli-old' },
    });
    process.env.SOPHRON_CODEX_AUTH_PATH = path.join(tmpDir, 'auth.json');

    expect(ensureCodexCredentials()).toBe(true);
    expect((mocks.store.get(OPENAI_CODEX_PROVIDER) as { refresh: string }).refresh).toBe(
      'refresh-ours'
    );
  });

  it('does not overwrite app-sourced credentials when the CLI file differs', () => {
    mocks.store.set(OPENAI_CODEX_PROVIDER, {
      type: 'oauth',
      access: 'a-app',
      refresh: 'r-app',
      expires: 1,
      codexAuthSource: 'app',
    });
    writeCliAuth(tmpDir, {
      tokens: { access_token: ACCESS_TOKEN, refresh_token: 'refresh-cli' },
    });
    process.env.SOPHRON_CODEX_AUTH_PATH = path.join(tmpDir, 'auth.json');

    expect(ensureCodexCredentials()).toBe(true);
    expect((mocks.store.get(OPENAI_CODEX_PROVIDER) as { refresh: string }).refresh).toBe('r-app');
  });

  it('keeps the stored pair when the CLI file holds the same generation', () => {
    mocks.store.set(OPENAI_CODEX_PROVIDER, {
      type: 'oauth',
      access: ACCESS_TOKEN,
      refresh: 'refresh-1',
      expires: ACCESS_EXP_MS,
      codexAuthSource: 'codex-cli',
    });
    writeCliAuth(tmpDir, {
      tokens: { access_token: 'different-access-same-generation', refresh_token: 'refresh-1' },
    });
    process.env.SOPHRON_CODEX_AUTH_PATH = path.join(tmpDir, 'auth.json');

    expect(ensureCodexCredentials()).toBe(true);
    expect((mocks.store.get(OPENAI_CODEX_PROVIDER) as { access: string }).access).toBe(
      ACCESS_TOKEN
    );
  });

  it('returns false when neither stored credentials nor a CLI login exist', () => {
    process.env.SOPHRON_CODEX_AUTH_PATH = path.join(tmpDir, 'missing.json');
    expect(ensureCodexCredentials()).toBe(false);
  });

  it('keeps stored credentials when forceImport is set but no CLI login exists', () => {
    mocks.store.set(OPENAI_CODEX_PROVIDER, {
      type: 'oauth',
      access: 'a-stored',
      refresh: 'r-stored',
      expires: 123,
    });
    process.env.SOPHRON_CODEX_AUTH_PATH = path.join(tmpDir, 'missing.json');
    expect(ensureCodexCredentials({ forceImport: true })).toBe(true);
    expect((mocks.store.get(OPENAI_CODEX_PROVIDER) as { refresh: string }).refresh).toBe(
      'r-stored'
    );
  });
});

describe('getCodexAuthStatus / hasCodexCredentials / logoutCodex', () => {
  it('reports not connected when nothing is available', () => {
    process.env.SOPHRON_CODEX_AUTH_PATH = path.join(tmpDir, 'missing.json');
    expect(getCodexAuthStatus()).toEqual({ connected: false, source: null });
    expect(hasCodexCredentials()).toBe(false);
  });

  it('reports the CLI login when no stored credentials exist', () => {
    writeCliAuth(tmpDir, {
      tokens: { access_token: ACCESS_TOKEN, refresh_token: 'refresh-1', account_id: 'acct-1' },
    });
    process.env.SOPHRON_CODEX_AUTH_PATH = path.join(tmpDir, 'auth.json');

    expect(getCodexAuthStatus()).toEqual({
      connected: true,
      source: 'codex-cli',
      accountId: 'acct-1',
      expiresAt: ACCESS_EXP_MS,
    });
    expect(hasCodexCredentials()).toBe(true);
  });

  it('reports stored credentials with their tagged source', () => {
    process.env.SOPHRON_CODEX_AUTH_PATH = path.join(tmpDir, 'missing.json');
    mocks.store.set(OPENAI_CODEX_PROVIDER, {
      type: 'oauth',
      access: 'a',
      refresh: 'r',
      expires: 456,
      accountId: 'acct-app',
      codexAuthSource: 'app',
    });

    expect(getCodexAuthStatus()).toEqual({
      connected: true,
      source: 'app',
      accountId: 'acct-app',
      expiresAt: 456,
    });
  });

  it('infers the CLI source for untagged stored credentials matching the CLI file', () => {
    writeCliAuth(tmpDir, {
      tokens: { access_token: ACCESS_TOKEN, refresh_token: 'refresh-1' },
    });
    process.env.SOPHRON_CODEX_AUTH_PATH = path.join(tmpDir, 'auth.json');
    mocks.store.set(OPENAI_CODEX_PROVIDER, {
      type: 'oauth',
      access: 'a',
      refresh: 'refresh-1',
      expires: 0,
    });

    const status = getCodexAuthStatus();
    expect(status.connected).toBe(true);
    expect(status.source).toBe('codex-cli');
    expect(status.expiresAt).toBeUndefined();
  });

  it('logoutCodex removes stored credentials', () => {
    process.env.SOPHRON_CODEX_AUTH_PATH = path.join(tmpDir, 'missing.json');
    mocks.store.set(OPENAI_CODEX_PROVIDER, {
      type: 'oauth',
      access: 'a',
      refresh: 'r',
      expires: 1,
    });

    const status = logoutCodex();
    expect(mocks.store.has(OPENAI_CODEX_PROVIDER)).toBe(false);
    expect(status).toEqual({ connected: false, source: null });
  });
});
