import * as http from 'http';
import * as crypto from 'crypto';
import Store, { type Options as StoreOptions } from 'electron-store';
import { shell } from 'electron';
import type { DesktopAuthStatus, DesktopAuthUser } from '../../renderer/types';
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
  remainingCredits?: unknown;
  credits?: unknown;
  creditBalance?: unknown;
  points?: unknown;
  remainingPoints?: unknown;
  quotaRemaining?: unknown;
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

  async getStatus(): Promise<DesktopAuthStatus> {
    const session = this.store.get('session');
    if (!session?.accessToken) {
      return this.emptyStatus();
    }

    try {
      const me = await this.getCurrentUser(session);
      const user = this.normalizeUser(me.user, me);
      const nextSession: DesktopAuthSession = {
        ...session,
        user,
        expiresAt: me.expiresAt ? Date.parse(me.expiresAt) : session.expiresAt,
        updatedAt: Date.now(),
      };
      this.store.set('session', nextSession);
      return this.sessionToStatus(nextSession);
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

  private async runLogin(loginCancelled: Promise<never>): Promise<DesktopAuthStatus> {
    const apiOrigin = this.resolveAuthOrigin();
    const state = crypto.randomBytes(16).toString('hex');
    const callbackServer = await this.createCallbackServer(state);

    try {
      const authorizeUrl = new URL(`${apiOrigin}/api/desktop/auth/authorize`);
      authorizeUrl.searchParams.set('clientId', CLIENT_ID);
      authorizeUrl.searchParams.set('redirectUri', callbackServer.redirectUri);
      authorizeUrl.searchParams.set('state', state);
      authorizeUrl.searchParams.set('scope', 'profile');

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

  private sessionToStatus(session: DesktopAuthSession): DesktopAuthStatus {
    return {
      authenticated: true,
      user: session.user,
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
      'remainingCredits',
      'credits',
      'creditBalance',
      'points',
      'remainingPoints',
      'quotaRemaining',
    ];

    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }

    return null;
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
