/**
 * Secrets of script packages and raw-table normalizers (API keys, tokens). Values are encrypted
 * with the OS keychain (Electron safeStorage) in one file under userData; code gets them only
 * as environment variables at run time and never sees them in prompts, files or git.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';

export const SECRET_NAME_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

export interface SecretCodec {
  encrypt(value: string): string;
  decrypt(value: string): string;
}

export interface SecretInfo {
  name: string;
  updatedAt: number;
}

interface StoredSecret {
  value: string;
  updatedAt: number;
}

type StoreFile = Record<string, Record<string, StoredSecret>>;

export function scriptSecretScope(packageId: string): string {
  return `script:${packageId}`;
}

export function normalizerSecretScope(artifactId: string): string {
  return `normalizer:${artifactId}`;
}

export class SecretStore {
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

  private save(): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.load(), null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, this.file);
  }

  list(scope: string): SecretInfo[] {
    return Object.entries(this.load()[scope] ?? {})
      .map(([name, item]) => ({ name, updatedAt: item.updatedAt }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  set(scope: string, name: string, value: string): SecretInfo {
    if (!SECRET_NAME_PATTERN.test(name))
      throw new Error('密钥名称只能用大写字母、数字和下划线，且以字母开头');
    if (!value.trim()) throw new Error('密钥值不能为空');
    const data = this.load();
    data[scope] = {
      ...(data[scope] ?? {}),
      [name]: { value: this.codec.encrypt(value.trim()), updatedAt: this.now() },
    };
    this.save();
    return { name, updatedAt: data[scope][name].updatedAt };
  }

  delete(scope: string, name: string): void {
    const data = this.load();
    if (!data[scope]?.[name]) return;
    delete data[scope][name];
    if (Object.keys(data[scope]).length === 0) delete data[scope];
    this.save();
  }

  deleteScope(scope: string): void {
    const data = this.load();
    if (!data[scope]) return;
    delete data[scope];
    this.save();
  }

  /** NAME → value for injection as environment variables. */
  env(scope: string): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [name, item] of Object.entries(this.load()[scope] ?? {})) {
      try {
        env[name] = this.codec.decrypt(item.value);
      } catch {
        // Undecryptable (keychain changed): the script reports the missing variable.
      }
    }
    return env;
  }

  /** Every stored value (redaction). */
  allValues(): string[] {
    return Object.keys(this.load()).flatMap((scope) => Object.values(this.env(scope)));
  }
}

let current: SecretStore | null = null;

export function setSecretStore(store: SecretStore | null): void {
  current = store;
}

export function getSecretStore(): SecretStore | null {
  return current;
}
