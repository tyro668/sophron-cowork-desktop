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
const REFRESH_LEEWAY_MS = 60_000;

class DesktopAuthRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
  }
}

function isAuthRejection(error: unknown): boolean {
  return (
    error instanceof DesktopAuthRequestError &&
    ([401, 403].includes(error.status) ||
      ['invalid_grant', 'invalid_token', '61311002'].includes(error.code || ''))
  );
}

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
  private refreshInFlight: { token: string; promise: Promise<DesktopAuthSession> } | null = null;
  private sessionGeneration = 0;

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
    this.sessionGeneration += 1;
    const attempt = this.loginAttempt;
    this.loginAttempt = null;
    attempt?.cancel(new Error('Login cancelled'));

    const session = this.store.get('session');
    if (session?.accessToken) {
      return this.sessionToStatus(session);
    }

    return this.emptyStatus();
  }

  async getPersonalAnalysisConnection(
    rejectedAccessToken?: string
  ): Promise<PersonalAnalysisConnectionInput | null> {
    if (!this.store.get('session')?.accessToken) return null;
    const session = await this.getValidSession(rejectedAccessToken);
    return {
      apiOrigin: session.apiOrigin,
      accessToken: session.accessToken,
      connectionMode: 'account',
    };
  }

  async getStatus(): Promise<DesktopAuthStatus> {
    if (!this.store.get('session')?.accessToken) return this.emptyStatus();
    let checkedToken: string | undefined;
    try {
      let session = await this.getValidSession();
      checkedToken = session.accessToken;
      let me: DesktopAuthMeResponse;
      try {
        me = await this.getCurrentUser(session);
      } catch (error) {
        if (!isAuthRejection(error)) throw error;
        session = await this.getValidSession(session.accessToken);
        checkedToken = session.accessToken;
        me = await this.getCurrentUser(session);
      }
      if (!this.hasRequiredAiScope(me.scope)) {
        throw new DesktopAuthRequestError(
          'Login token is missing AI scope; please sign in again',
          403
        );
      }
      if (this.store.get('session')?.accessToken !== session.accessToken)
        return this.currentStatus();
      const nextSession = {
        ...session,
        user: this.normalizeUser(me.user, me),
        expiresAt: me.expiresAt ? Date.parse(me.expiresAt) : session.expiresAt,
        updatedAt: Date.now(),
      };
      this.store.set('session', nextSession);
      const credits = await this.tryFetchAiCredits(nextSession);
      if (this.store.get('session')?.accessToken !== nextSession.accessToken)
        return this.currentStatus();
      return this.sessionToStatus(nextSession, credits);
    } catch (error) {
      if (
        isAuthRejection(error) &&
        checkedToken &&
        this.store.get('session')?.accessToken === checkedToken
      )
        this.store.set('session', null);
      logWarn('[DesktopAuth] Failed to refresh auth status:', error);
      // Temporary network/server failures must not destroy a refreshable login.
      return {
        ...this.currentStatus(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private currentStatus(): DesktopAuthStatus {
    const session = this.store.get('session');
    return session ? this.sessionToStatus(session) : this.emptyStatus();
  }

  private async getValidSession(rejectedAccessToken?: string): Promise<DesktopAuthSession> {
    const session = this.requireSession();
    const rejected = rejectedAccessToken === session.accessToken;
    if (!rejected && (!session.expiresAt || session.expiresAt > Date.now() + REFRESH_LEEWAY_MS))
      return session;
    if (!session.refreshToken) {
      if (rejected || (session.expiresAt && session.expiresAt <= Date.now())) {
        this.store.set('session', null);
        throw new Error('Login expired; please sign in again');
      }
      return session;
    }
    if (this.refreshInFlight?.token === session.accessToken) return this.refreshInFlight.promise;
    const generation = this.sessionGeneration;
    const promise = (async () => {
      try {
        const token = await this.requestJson<DesktopAuthTokenResponse>(
          `${session.apiOrigin}/api/desktop/auth/token`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              grantType: 'refresh_token',
              refreshToken: session.refreshToken,
              clientId: CLIENT_ID,
            }),
          }
        );
        if (!token.accessToken) throw new Error('Refresh response is missing accessToken');
        if (
          generation !== this.sessionGeneration ||
          this.store.get('session')?.accessToken !== session.accessToken
        ) {
          throw new Error('Login session changed during refresh');
        }
        const nextSession: DesktopAuthSession = {
          ...session,
          accessToken: token.accessToken,
          refreshToken: token.refreshToken || session.refreshToken,
          tokenType: token.tokenType || session.tokenType,
          user: token.user ? this.normalizeUser(token.user, token) : session.user,
          expiresAt: token.expiresIn ? Date.now() + token.expiresIn * 1000 : undefined,
          updatedAt: Date.now(),
        };
        this.store.set('session', nextSession);
        return nextSession;
      } catch (error) {
        if (
          isAuthRejection(error) &&
          generation === this.sessionGeneration &&
          this.store.get('session')?.accessToken === session.accessToken
        ) {
          this.store.set('session', null);
        }
        throw error;
      }
    })();
    const flight = { token: session.accessToken, promise };
    this.refreshInFlight = flight;
    try {
      return await promise;
    } finally {
      if (this.refreshInFlight === flight) this.refreshInFlight = null;
    }
  }

  async logout(): Promise<DesktopAuthStatus> {
    const attempt = this.loginAttempt;
    this.loginAttempt = null;
    attempt?.cancel(new Error('Login cancelled'));

    const session = this.store.get('session');
    this.sessionGeneration += 1;
    this.store.set('session', null);
    if (session?.accessToken) {
      try {
        await this.requestJson<{ loggedOut?: boolean }>(
          `${session.apiOrigin}/api/desktop/auth/logout`,
          {
            method: 'POST',
            headers: {
              Authorization: `${session.tokenType || 'Bearer'} ${session.accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ refreshToken: session.refreshToken }),
          }
        );
      } catch (error) {
        logWarn('[DesktopAuth] Logout request failed, clearing local session anyway:', error);
      }
    }

    return this.currentStatus();
  }

  async getAccessToken(): Promise<string | null> {
    if (!this.store.get('session')?.accessToken) return null;
    return (await this.getValidSession()).accessToken;
  }

  async requireAccessToken(): Promise<string> {
    const token = await this.getAccessToken();
    if (!token) {
      throw new Error('Please sign in before using the built-in LLM');
    }
    return token;
  }

  async requireLlmAccessToken(): Promise<string> {
    return (await this.getValidSession()).accessToken;
  }

  getApiOrigin(): string {
    return this.store.get('session')?.apiOrigin || this.resolveAuthOrigin();
  }

  async listLlmModels(): Promise<ProviderModelInfo[]> {
    const session = await this.getValidSession();
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
    return this.fetchAiCreditUsage(await this.getValidSession(), limit);
  }

  async getAiCredits(): Promise<AiCreditBalance> {
    return this.fetchAiCredits(await this.getValidSession());
  }

  private async runLogin(loginCancelled: Promise<never>): Promise<DesktopAuthStatus> {
    const generation = ++this.sessionGeneration;
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
      if (generation !== this.sessionGeneration) throw new Error('Login cancelled');
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
    return `Bearer ${session.accessToken}`;
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
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
    const text = await response.text();
    let payload: HiResponse<T>;
    try {
      payload = text ? (JSON.parse(text) as HiResponse<T>) : {};
    } catch {
      throw new Error(`Invalid JSON response from ${url}`);
    }

    if (!response.ok || payload.success === false || !payload.data) {
      throw new DesktopAuthRequestError(
        payload.message || `Request failed: HTTP ${response.status}`,
        response.status,
        payload.errorCode || payload.code
      );
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
