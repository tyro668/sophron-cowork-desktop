/**
 * Encrypted persistence for remote MCP OAuth client registrations and tokens.
 * Values are written with Electron safeStorage when available and are never
 * logged by this module.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';
import type { OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

export interface SecretCodec {
  encrypt(value: string): string;
  decrypt(value: string): string;
}

export interface McpOAuthRecord {
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  redirectUri?: string;
  lastState?: string;
  discovery?: OAuthDiscoveryState;
  updatedAt: number;
}

type StoreFile = Record<string, McpOAuthRecord>;

export class McpOAuthStore {
  private cache: StoreFile | null = null;

  constructor(
    private readonly file: string,
    private readonly codec: SecretCodec,
    private readonly now: () => number = Date.now
  ) {}

  private load(): StoreFile {
    if (this.cache) return this.cache;
    try {
      this.cache = existsSync(this.file)
        ? (JSON.parse(readFileSync(this.file, 'utf8')) as StoreFile)
        : {};
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  private persist(): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.load(), null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, this.file);
  }

  get(serverId: string): McpOAuthRecord | undefined {
    return this.load()[serverId];
  }

  update(serverId: string, patch: Partial<Omit<McpOAuthRecord, 'updatedAt'>>): McpOAuthRecord {
    const data = this.load();
    const current = data[serverId] ?? { updatedAt: 0 };
    const next: McpOAuthRecord = { ...current, ...patch, updatedAt: this.now() };
    if (patch.tokens) {
      next.tokens = this.encryptTokens(patch.tokens);
    }
    if (patch.clientInformation) {
      next.clientInformation = this.encryptClient(patch.clientInformation);
    }
    if (patch.codeVerifier !== undefined) {
      next.codeVerifier = patch.codeVerifier ? this.codec.encrypt(patch.codeVerifier) : undefined;
    }
    data[serverId] = next;
    this.persist();
    return this.read(serverId)!;
  }

  read(serverId: string): McpOAuthRecord | undefined {
    const stored = this.load()[serverId];
    if (!stored) return undefined;
    return {
      ...stored,
      tokens: stored.tokens ? this.decryptTokens(stored.tokens) : undefined,
      clientInformation: stored.clientInformation
        ? this.decryptClient(stored.clientInformation)
        : undefined,
      codeVerifier: stored.codeVerifier ? this.safeDecrypt(stored.codeVerifier) : undefined,
    };
  }

  delete(serverId: string): void {
    const data = this.load();
    if (!data[serverId]) return;
    delete data[serverId];
    this.persist();
  }

  /** Decryptable secret strings, for log redaction only. */
  allSecretValues(): string[] {
    const values: string[] = [];
    for (const serverId of Object.keys(this.load())) {
      const record = this.read(serverId);
      if (!record) continue;
      const tokens = record.tokens;
      if (tokens?.access_token) values.push(tokens.access_token);
      if (tokens?.refresh_token) values.push(tokens.refresh_token);
      if (tokens?.id_token) values.push(tokens.id_token);
      const client = record.clientInformation as { client_secret?: string } | undefined;
      if (client?.client_secret) values.push(client.client_secret);
      if (record.codeVerifier) values.push(record.codeVerifier);
    }
    return values;
  }

  private encryptTokens(tokens: OAuthTokens): OAuthTokens {
    return {
      ...tokens,
      access_token: this.codec.encrypt(tokens.access_token),
      refresh_token: tokens.refresh_token ? this.codec.encrypt(tokens.refresh_token) : undefined,
      id_token: tokens.id_token ? this.codec.encrypt(tokens.id_token) : undefined,
    };
  }

  private decryptTokens(tokens: OAuthTokens): OAuthTokens {
    return {
      ...tokens,
      access_token: this.safeDecrypt(tokens.access_token) ?? '',
      refresh_token: tokens.refresh_token ? this.safeDecrypt(tokens.refresh_token) : undefined,
      id_token: tokens.id_token ? this.safeDecrypt(tokens.id_token) : undefined,
    };
  }

  private encryptClient(info: OAuthClientInformationMixed): OAuthClientInformationMixed {
    const secret = (info as { client_secret?: string }).client_secret;
    if (!secret) return info;
    return { ...info, client_secret: this.codec.encrypt(secret) };
  }

  private decryptClient(info: OAuthClientInformationMixed): OAuthClientInformationMixed {
    const secret = (info as { client_secret?: string }).client_secret;
    if (!secret) return info;
    const decrypted = this.safeDecrypt(secret);
    return { ...info, client_secret: decrypted };
  }

  private safeDecrypt(value: string): string | undefined {
    try {
      return this.codec.decrypt(value);
    } catch {
      return undefined;
    }
  }
}
