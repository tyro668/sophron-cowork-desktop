import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { join } from 'path';
import { getAgentDir, ModelRegistry, ModelRuntime } from '@earendil-works/pi-coding-agent';
import type {
  AuthOperationOptions,
  Credential,
  CredentialInfo,
  CredentialStore,
} from '@earendil-works/pi-ai';

/**
 * In-process credential store shared with ModelRuntime.
 * Synchronous get/set/remove keep the existing Codex login helpers and tests
 * working; ModelRuntime uses the async CredentialStore methods for refresh.
 */
class SharedCredentialStore implements CredentialStore {
  private data: Record<string, Credential> = {};
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly authPath: string) {
    this.reload();
  }

  reload(): void {
    try {
      const parsed = JSON.parse(readFileSync(this.authPath, 'utf8')) as unknown;
      this.data =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, Credential>)
          : {};
    } catch {
      this.data = {};
    }
  }

  get(providerId: string): Credential | undefined {
    return this.data[providerId];
  }

  set(providerId: string, credential: Credential): void {
    this.data[providerId] = credential;
    this.flush();
  }

  remove(providerId: string): void {
    delete this.data[providerId];
    this.flush();
  }

  async read(providerId: string): Promise<Credential | undefined> {
    return this.data[providerId];
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return Object.entries(this.data).map(([providerId, credential]) => ({
      providerId,
      type: credential.type,
    }));
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    _options?: AuthOperationOptions
  ): Promise<Credential | undefined> {
    const run = this.queue.then(async () => {
      const next = await fn(this.data[providerId]);
      if (next === undefined) return this.data[providerId];
      this.data[providerId] = next;
      this.flush();
      return next;
    });
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async delete(providerId: string): Promise<void> {
    this.remove(providerId);
  }

  private flush(): void {
    mkdirSync(dirname(this.authPath), { recursive: true });
    writeFileSync(this.authPath, JSON.stringify(this.data, null, 2), { mode: 0o600 });
  }
}

const sharedCredentials = new SharedCredentialStore(join(getAgentDir(), 'auth.json'));
let sharedModelRuntime: Promise<ModelRuntime> | null = null;

export function getSharedAuthStorage(): SharedCredentialStore {
  return sharedCredentials;
}

export function getSharedModelRuntime(): Promise<ModelRuntime> {
  sharedModelRuntime ??= ModelRuntime.create({
    credentials: sharedCredentials,
    refreshOnCreate: false,
  });
  return sharedModelRuntime;
}

export async function getProviderApiKey(providerId: string): Promise<string | undefined> {
  const runtime = await getSharedModelRuntime();
  const result = await runtime.getAuth(providerId);
  return result?.auth.apiKey;
}

export async function setRuntimeApiKey(providerId: string, apiKey: string): Promise<void> {
  const runtime = await getSharedModelRuntime();
  await runtime.setRuntimeApiKey(providerId, apiKey);
}

export { ModelRegistry, ModelRuntime };
