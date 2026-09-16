import * as http from 'http';
import * as crypto from 'crypto';
import Store, { type Options as StoreOptions } from 'electron-store';
import { shell } from 'electron';
import type {
  AiCreditBalance,
  AiCreditUsageSummary,
  DesktopAuthStatus,
  DesktopAuthUser,
  ProviderModelInfo,
} from '../../shared/contracts';
import type { PersonalAnalysisConnectionInput } from '../../shared/personal-analysis-types';
import { createEncryptedStoreWithKeyRotation } from '../utils/store-encryption';
import { log, logWarn } from '../utils/logger';

const CLIENT_ID = 'sophorn-desktop';
const CALLBACK_PATH = '/callback';
const LOGIN_TIMEOUT_MS = 2 * 60 * 1000;

interface HiResponse<T> {
  success?: boolean;
  code?: string;
  errorCode?: string;
  message?: string;
  data?: T;
}

interface DesktopAuthTokenResponse {
  accessToken: string;
  tokenType?: string;
  expiresIn?: number;
  refreshToken?: string;
  user?: DesktopAuthUser;
  aiCredits?: unknown;
  availableAiCredits?: unknown;
  aiCreditBalance?: unknown;
  remainingAiCredits?: unknown;
  remainingCredits?: unknown;
  credits?: unknown;
  creditBalance?: unknown;
  points?: unknown;
  remainingPoints?: unknown;
  quotaRemaining?: unknown;
}

interface DesktopAuthMeResponse {
  user: DesktopAuthUser;
  clientId?: string;
  scope?: string;
  expiresAt?: string;
  aiCredits?: unknown;
  availableAiCredits?: unknown;
  aiCreditBalance?: unknown;
  remainingAiCredits?: unknown;
  remainingCredits?: unknown;
  credits?: unknown;
  creditBalance?: unknown;
  points?: unknown;
  remainingPoints?: unknown;
  quotaRemaining?: unknown;
}

interface DesktopLlmModelsResponse {
  mode: string;
  models: Array<{
    model: string;
    provider?: string;
    displayName?: string;
    upstreamModel?: string;
    creditMultiplier?: number;
    inputCreditMultiplier?: number;
    outputCreditMultiplier?: number;
    creditUnit?: string;
    creditsPerMillionTokens?: number;
    inputCreditsPerMillionTokens?: number;
    outputCreditsPerMillionTokens?: number;
  }>;
}

interface DesktopLlmCreditsResponse {
  quotaCredits: number;
  usedCredits: number;
  availableCredits: number;
  unit?: string;
  exhausted?: boolean;
  usage?: AiCreditBalance['usage'];
}

interface DesktopAuthSession {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  user: DesktopAuthUser;
  expiresAt?: number;
  apiOrigin: string;
  updatedAt: number;
}

interface DesktopAuthStoreSchema {
  session: DesktopAuthSession | null;
}

interface CallbackServer {
  redirectUri: string;
  waitForCallback: Promise<URL>;
  close: () => Promise<void>;
}

interface LoginAttempt {
  promise: Promise<DesktopAuthStatus>;
  cancel: (error: Error) => void;
}

export class DesktopAuthService {
  private store: Store<DesktopAuthStoreSchema>;
  private loginAttempt: LoginAttempt | null = null;

  constructor(private readonly resolveApiOrigin: () => string) {
    type DesktopAuthStoreRecord = DesktopAuthStoreSchema & Record<string, unknown>;
    const storeOptions: StoreOptions<DesktopAuthStoreRecord> & { projectName?: string } = {
      name: 'desktop-auth',
      projectName: 'sophron',
      defaults: {
        session: null,
      },
    };
    this.store = createEncryptedStoreWithKeyRotation<DesktopAuthStoreRecord>({
      stableKey: 'sophron-desktop-auth-stable-v1',
      legacyKeys: [],
      storeOptions,
      logPrefix: '[DesktopAuth]',
      log,
      warn: logWarn,
    }) as unknown as Store<DesktopAuthStoreSchema>;
  }

  async login(): Promise<DesktopAuthStatus> {
    if (this.loginAttempt) {
      return this.loginAttempt.promise;
    }

    let cancelLogin: LoginAttempt['cancel'] = () => undefined;
    const loginCancelled = new Promise<never>((_, reject) => {
      cancelLogin = reject;
    });
    void loginCancelled.catch(() => undefined);
    const attempt: LoginAttempt = {
      promise: this.runLogin(loginCancelled).finally(() => {
        if (this.loginAttempt === attempt) {
          this.loginAttempt = null;
        }
      }),
      cancel: cancelLogin,
    };
    this.loginAttempt = attempt;
    return attempt.promise;
  }

  cancelLogin(): DesktopAuthStatus {
    const attempt = this.loginAttempt;
    this.loginAttempt = null;
    attempt?.cancel(new Error('Login cancelled'));

    const session = this.store.get('session');
    if (session?.accessToken) {
      return this.sessionToStatus(session);
    }

    return this.emptyStatus();
  }

  getPersonalAnalysisConnection(): PersonalAnalysisConnectionInput | null {
    const session = this.store.get('session');
    if (!session?.accessToken) {
      return null;
    }

    if (session.expiresAt && session.expiresAt <= Date.now()) {
      this.store.set('session', null);
      return null;
    }

    return {
      apiOrigin: session.apiOrigin,
      accessToken: this.resolvePersonalAnalysisAccessToken(session),
    };
  }

  async getStatus(): Promise<DesktopAuthStatus> {
    const session = this.store.get('session');
    if (!session?.accessToken) {
      return this.emptyStatus();
    }

    try {
      const me = await this.getCurrentUser(session);
      if (!this.hasRequiredAiScope(me.scope)) {
        throw new Error('Login token is missing AI scope; please sign in again');
      }
      const user = this.normalizeUser(me.user, me);
      const nextSession: DesktopAuthSession = {
        ...session,
        user,
        expiresAt: me.expiresAt ? Date.parse(me.expiresAt) : session.expiresAt,
        updatedAt: Date.now(),
      };
      this.store.set('session', nextSession);
      return this.sessionToStatus(nextSession, await this.tryFetchAiCredits(nextSession));
    } catch (error) {
      logWarn('[DesktopAuth] Failed to refresh auth status:', error);
      this.store.set('session', null);
      return {
        ...this.emptyStatus(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async logout(): Promise<DesktopAuthStatus> {
    const attempt = this.loginAttempt;
    this.loginAttempt = null;
    attempt?.cancel(new Error('Login cancelled'));

    const session = this.store.get('session');
    if (session?.accessToken) {
      try {
        await this.requestJson<{ loggedOut?: boolean }>(
          `${session.apiOrigin}/api/desktop/auth/logout`,
          {
            method: 'POST',
            headers: {
              Authorization: `${session.tokenType || 'Bearer'} ${session.accessToken}`,
            },
          }
        );
      } catch (error) {
        logWarn('[DesktopAuth] Logout request failed, clearing local session anyway:', error);
      }
    }

    this.store.set('session', null);
    return this.emptyStatus();
  }

  getAccessToken(): string | null {
    return this.store.get('session')?.accessToken ?? null;
  }

  requireAccessToken(): string {
    const token = this.getAccessToken();
    if (!token) {
      throw new Error('Please sign in before using the built-in LLM');
    }
    return token;
  }

  requireLlmAccessToken(): string {
    const session = this.requireSession();
    return this.resolveLlmAccessToken(session);
  }

  async listLlmModels(): Promise<ProviderModelInfo[]> {
    const session = this.requireSession();
    const data = await this.requestJson<DesktopLlmModelsResponse>(
      `${session.apiOrigin}/api/llm/v1/models`,
      {
        method: 'GET',
        headers: {
          Authorization: this.buildLlmAuthorization(session),
        },
      }
    );

    return data.models
      .map((model): ProviderModelInfo | null => {
        const id = model.model?.trim();
        const name = model.displayName?.trim() || id;
        if (!id || !name) return null;
        return {
          id,
          name,
          provider: model.provider?.trim(),
          upstreamModel: model.upstreamModel?.trim(),
          creditMultiplier: model.creditMultiplier,
          inputCreditMultiplier: model.inputCreditMultiplier,
          outputCreditMultiplier: model.outputCreditMultiplier,
          creditUnit: model.creditUnit,
        };
      })
      .filter((model): model is ProviderModelInfo => Boolean(model));
  }

  async getAiCreditUsage(limit = 50): Promise<AiCreditUsageSummary> {
    return this.fetchAiCreditUsage(this.requireSession(), limit);
  }

  async getAiCredits(): Promise<AiCreditBalance> {
    return this.fetchAiCredits(this.requireSession());
  }

  private async runLogin(loginCancelled: Promise<never>): Promise<DesktopAuthStatus> {
    const apiOrigin = this.resolveAuthOrigin();
    const state = crypto.randomBytes(16).toString('hex');
    const callbackServer = await this.createCallbackServer(state);

    try {
      const authorizeUrl = new URL(`${apiOrigin}/api/desktop/auth/authorize`);
      authorizeUrl.searchParams.set('clientId', CLIENT_ID);
      authorizeUrl.searchParams.set('redirectUri', callbackServer.redirectUri);
      authorizeUrl.searchParams.set('state', state);
      authorizeUrl.searchParams.set('scope', 'profile read write ai');

      await shell.openExternal(authorizeUrl.toString());
      const callbackUrl = await Promise.race([callbackServer.waitForCallback, loginCancelled]);
      const error = callbackUrl.searchParams.get('error');
      if (error) {
        throw new Error(callbackUrl.searchParams.get('error_description') || error);
      }

      const code = callbackUrl.searchParams.get('code');
      if (!code) {
        throw new Error('Login callback did not include authorization code');
      }

      const token = await this.requestJson<DesktopAuthTokenResponse>(
        `${apiOrigin}/api/desktop/auth/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grantType: 'authorization_code',
            code,
            clientId: CLIENT_ID,
            redirectUri: callbackServer.redirectUri,
          }),
        }
      );

      if (!token.accessToken || !token.user) {
        throw new Error('Login token response is missing accessToken or user');
      }

      const session: DesktopAuthSession = {
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        tokenType: token.tokenType || 'Bearer',
        user: this.normalizeUser(token.user, token),
        expiresAt: token.expiresIn ? Date.now() + token.expiresIn * 1000 : undefined,
        apiOrigin,
        updatedAt: Date.now(),
      };
      this.store.set('session', session);

      return this.getStatus();
    } finally {
      await callbackServer.close();
    }
  }

  private resolveAuthOrigin(): string {
    const configured = this.resolveApiOrigin()?.trim().replace(/\/+$/, '');
    if (!configured) {
      throw new Error('Desktop auth origin is not configured');
    }

    return configured;
  }

  private sessionToStatus(
    session: DesktopAuthSession,
    aiCredits?: AiCreditBalance
  ): DesktopAuthStatus {
    return {
      authenticated: true,
      user: session.user,
      aiCredits,
      apiOrigin: session.apiOrigin,
      expiresAt: session.expiresAt,
      updatedAt: session.updatedAt,
    };
  }

  private emptyStatus(): DesktopAuthStatus {
    return {
      authenticated: false,
      apiOrigin: this.resolveAuthOrigin(),
      updatedAt: Date.now(),
    };
  }

  private requireSession(): DesktopAuthSession {
    const session = this.store.get('session');
    if (!session?.accessToken) {
      throw new Error('Please sign in before using the built-in LLM');
    }
    return session;
  }

  private async tryFetchAiCredits(
    session: DesktopAuthSession
  ): Promise<AiCreditBalance | undefined> {
    try {
      return await this.fetchAiCredits(session);
    } catch (error) {
      logWarn('[DesktopAuth] Failed to fetch AI credits:', error);
      return undefined;
    }
  }

  private async fetchAiCredits(session: DesktopAuthSession): Promise<AiCreditBalance> {
    const data = await this.requestJson<DesktopLlmCreditsResponse>(
      `${session.apiOrigin}/api/llm/v1/credits`,
      {
        method: 'GET',
        headers: {
          Authorization: this.buildLlmAuthorization(session),
        },
      }
    );

    return {
      quotaCredits: Number(data.quotaCredits ?? 0),
      usedCredits: Number(data.usedCredits ?? 0),
      availableCredits: Number(data.availableCredits ?? 0),
      unit: data.unit,
      exhausted: Boolean(data.exhausted),
      usage: data.usage,
    };
  }

  private buildLlmAuthorization(session: DesktopAuthSession): string {
    return `Bearer ${this.resolveLlmAccessToken(session)}`;
  }

  private resolveLlmAccessToken(session: DesktopAuthSession): string {
    const overrideToken = process.env.SOPHRON_LLM_ACCESS_TOKEN?.trim();
    if (overrideToken) {
      return overrideToken;
    }

    // The local mock server keeps desktop login tokens and API bearer tokens in
    // separate stores. Its /api/llm/v1/* routes currently accept the documented
    // default bearer token, while production can use the desktop login token.
    if (process.env.VITE_DEV_SERVER_URL && this.isLoopbackOrigin(session.apiOrigin)) {
      return 'mock-token';
    }

    return session.accessToken;
  }

  private resolvePersonalAnalysisAccessToken(session: DesktopAuthSession): string {
    const overrideToken = process.env.SOPHRON_PERSONAL_ANALYSIS_ACCESS_TOKEN?.trim();
    if (overrideToken) {
      return overrideToken;
    }

    if (this.isLoopbackOrigin(session.apiOrigin)) {
      return 'mock-token';
    }

    return session.accessToken;
  }

  private isLoopbackOrigin(origin: string): boolean {
    try {
      const hostname = new URL(origin).hostname;
      return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    } catch {
      return false;
    }
  }

  private async fetchAiCreditUsage(
    session: DesktopAuthSession,
    limit = 50
  ): Promise<AiCreditUsageSummary> {
    const url = new URL(`${session.apiOrigin}/api/llm/v1/usage`);
    url.searchParams.set('limit', String(Math.max(1, Math.min(200, Math.round(limit)))));
    return this.requestJson<AiCreditUsageSummary>(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: this.buildLlmAuthorization(session),
      },
    });
  }

  private normalizeUser(user: DesktopAuthUser, fallbackSource?: unknown): DesktopAuthUser {
    const remainingCredits =
      this.readRemainingCredits(user) ?? this.readRemainingCredits(fallbackSource);

    if (remainingCredits === null) {
      return user;
    }

    return {
      ...user,
      remainingCredits,
    };
  }

  private readRemainingCredits(source: unknown): number | null {
    if (!source || typeof source !== 'object') {
      return null;
    }

    const record = source as Record<string, unknown>;
    const keys = [
      'aiCredits',
      'availableAiCredits',
      'aiCreditBalance',
      'aiCreditsBalance',
      'remainingAiCredits',
      'availableCredits',
      'remainingCredits',
      'credits',
      'creditBalance',
      'availableAiPoints',
      'aiPoints',
      'remainingAiPoints',
      'points',
      'remainingPoints',
      'quotaRemaining',
    ];

    for (const key of keys) {
      const parsed = this.readNumericCreditValue(record[key]);
      if (parsed !== null) {
        return parsed;
      }
    }

    return null;
  }

  private readNumericCreditValue(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      for (const key of ['available', 'remaining', 'balance', 'total', 'value']) {
        const parsed = this.readNumericCreditValue(record[key]);
        if (parsed !== null) {
          return parsed;
        }
      }
    }
    return null;
  }

  private hasRequiredAiScope(scope: string | undefined): boolean {
    if (typeof scope !== 'string' || !scope.trim()) {
      return true;
    }
    return scope.split(/[\s,]+/).includes('ai');
  }

  private async getCurrentUser(session: DesktopAuthSession): Promise<DesktopAuthMeResponse> {
    return this.requestJson<DesktopAuthMeResponse>(`${session.apiOrigin}/api/desktop/auth/me`, {
      method: 'GET',
      headers: {
        Authorization: `${session.tokenType || 'Bearer'} ${session.accessToken}`,
      },
    });
  }

  private async requestJson<T>(url: string, init: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    const text = await response.text();
    let payload: HiResponse<T>;
    try {
      payload = text ? (JSON.parse(text) as HiResponse<T>) : {};
    } catch {
      throw new Error(`Invalid JSON response from ${url}`);
    }

    if (!response.ok || payload.success === false || !payload.data) {
      throw new Error(payload.message || `Request failed: HTTP ${response.status}`);
    }

    return payload.data;
  }

  private async createCallbackServer(expectedState: string): Promise<CallbackServer> {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let resolveCallback: (url: URL) => void;
    let rejectCallback: (error: Error) => void;
    const waitForCallback = new Promise<URL>((resolve, reject) => {
      resolveCallback = resolve;
      rejectCallback = reject;
    });

    const server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
      if (requestUrl.pathname !== CALLBACK_PATH) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not found');
        return;
      }

      const state = requestUrl.searchParams.get('state');
      if (state !== expectedState) {
        response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Invalid login state');
        if (!settled) {
          settled = true;
          rejectCallback(new Error('Login callback state mismatch'));
        }
        return;
      }

      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(
        '<!doctype html><meta charset="utf-8"><title>Login complete</title><body style="font-family: system-ui; padding: 32px;">登录已完成，可以返回九思助理。</body>'
      );
      if (!settled) {
        settled = true;
        resolveCallback(requestUrl);
      }
    });

    const redirectUri = await new Promise<string>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      server.once('error', onError);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', onError);
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Failed to allocate login callback port'));
          return;
        }
        resolve(`http://127.0.0.1:${address.port}${CALLBACK_PATH}`);
      });
    });

    timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        rejectCallback(new Error('Login timed out'));
      }
    }, LOGIN_TIMEOUT_MS);

    return {
      redirectUri,
      waitForCallback,
      close: () =>
        new Promise<void>((resolve) => {
          if (timeout) clearTimeout(timeout);
          server.close(() => resolve());
        }),
    };
  }
}
