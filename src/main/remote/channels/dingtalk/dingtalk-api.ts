import { log, logError } from '../../../utils/logger';
import type { DingtalkOutboundContent, DingtalkTarget } from './dingtalk-types';

const DINGTALK_API_BASE = 'https://api.dingtalk.com';
const SESSION_WEBHOOK_HOSTS = new Set(['oapi.dingtalk.com', 'api.dingtalk.com']);

interface TokenResponse {
  accessToken?: string;
  expireIn?: number;
  code?: string;
  message?: string;
}

export class DingtalkAPIError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string
  ) {
    super(message);
    this.name = 'DingtalkAPIError';
  }

  get retryable(): boolean {
    return this.status === 429 || (this.status !== undefined && this.status >= 500);
  }
}

export class DingtalkAPI {
  private accessToken?: string;
  private tokenExpireAt = 0;
  private refreshPromise?: Promise<string>;

  constructor(
    private readonly appKey: string,
    private readonly appSecret: string
  ) {}

  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpireAt - 60_000) {
      return this.accessToken;
    }
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = this.refreshAccessToken();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = undefined;
    }
  }

  private async refreshAccessToken(): Promise<string> {
    const response = await fetch(`${DINGTALK_API_BASE}/v1.0/oauth2/accessToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appKey: this.appKey, appSecret: this.appSecret }),
    });
    const data = (await this.readJson(response)) as TokenResponse;
    if (!response.ok || !data.accessToken) {
      throw new DingtalkAPIError(
        `Failed to get DingTalk access token: ${data.message || response.statusText}`,
        response.status,
        data.code
      );
    }

    this.accessToken = data.accessToken;
    this.tokenExpireAt = Date.now() + Math.max(60, data.expireIn ?? 7200) * 1000;
    log('[DingTalkAPI] Access token refreshed');
    return data.accessToken;
  }

  async sendSessionWebhook(webhook: string, content: DingtalkOutboundContent): Promise<void> {
    const url = this.validateSessionWebhook(webhook);
    const token = await this.getAccessToken();
    const body =
      content.kind === 'markdown'
        ? { msgtype: 'markdown', markdown: { title: content.title, text: content.text } }
        : { msgtype: 'text', text: { content: content.text } };

    await this.request(url, body, token);
  }

  async sendProactive(
    target: DingtalkTarget,
    robotCode: string,
    content: DingtalkOutboundContent
  ): Promise<void> {
    const token = await this.getAccessToken();
    const message =
      content.kind === 'markdown'
        ? {
            msgKey: 'sampleMarkdown',
            msgParam: JSON.stringify({ title: content.title, text: content.text }),
          }
        : {
            msgKey: 'sampleText',
            msgParam: JSON.stringify({ content: content.text }),
          };

    if (target.kind === 'group') {
      await this.request(
        `${DINGTALK_API_BASE}/v1.0/robot/groupMessages/send`,
        { robotCode, openConversationId: target.id, ...message },
        token
      );
      return;
    }

    await this.request(
      `${DINGTALK_API_BASE}/v1.0/robot/oToMessages/batchSend`,
      { robotCode, userIds: [target.id], ...message },
      token
    );
  }

  private validateSessionWebhook(webhook: string): string {
    let url: URL;
    try {
      url = new URL(webhook);
    } catch {
      throw new DingtalkAPIError('Invalid DingTalk session webhook URL');
    }
    if (url.protocol !== 'https:' || !SESSION_WEBHOOK_HOSTS.has(url.hostname)) {
      throw new DingtalkAPIError('Rejected untrusted DingTalk session webhook URL');
    }
    return url.toString();
  }

  private async request(url: string, body: Record<string, unknown>, token: string): Promise<void> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': token,
      },
      body: JSON.stringify(body),
    });
    const data = (await this.readJson(response)) as {
      code?: string | number;
      errcode?: number;
      message?: string;
      errmsg?: string;
    };
    const businessFailed =
      (data.code !== undefined && data.code !== 0 && data.code !== '0') ||
      (data.errcode !== undefined && data.errcode !== 0);
    if (!response.ok || businessFailed) {
      logError('[DingTalkAPI] Request failed:', {
        status: response.status,
        code: data.code ?? data.errcode,
        message: data.message ?? data.errmsg,
      });
      throw new DingtalkAPIError(
        data.message || data.errmsg || `DingTalk HTTP ${response.status}`,
        response.status,
        String(data.code ?? data.errcode ?? '')
      );
    }
  }

  private async readJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      if (!response.ok) {
        throw new DingtalkAPIError(`DingTalk HTTP ${response.status}`, response.status);
      }
      return {};
    }
  }
}
