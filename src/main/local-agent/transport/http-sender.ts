/**
 * HTTP webhook 发送器，对应 Java `HttpMessageSender`。
 *
 * URL = `connectSuccess.baseUrl` + eventType（例如 `/webhook/agent/source/single`），
 * POST JSON，返回响应体文本（与 Java 一致，不检查 HTTP 状态码）。
 */
import type { RemoteEnvStore } from '../remote-env';
import { encodeMessage } from './agent-socket';

export type FetchLike = typeof fetch;

/** Java readTimeout/writeTimeout 为 10 分钟。 */
export const HTTP_SENDER_TIMEOUT_MS = 10 * 60 * 1000;

export class BaseUrlMissingError extends Error {
  constructor() {
    super(
      'Base URL is not exists. Please check on the page whether the agent is connected to Jiushuyun.'
    );
    this.name = 'BaseUrlMissingError';
  }
}

/** 连接被对端重置一类的错误（Java 里是 OkHttp 的 StreamResetException）。 */
export function isConnectionResetError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const code = (current as { code?: unknown }).code;
    if (
      code === 'ECONNRESET' ||
      code === 'EPIPE' ||
      code === 'UND_ERR_SOCKET' ||
      code === 'UND_ERR_CLOSED'
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export class HttpMessageSender {
  constructor(
    private readonly remoteEnv: RemoteEnvStore,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly timeoutMs: number = HTTP_SENDER_TIMEOUT_MS
  ) {}

  private buildRequest(eventType: string, data: unknown): { url: string; init: RequestInit } {
    const baseUrl = this.remoteEnv.baseUrl;
    if (!baseUrl) throw new BaseUrlMissingError();
    return {
      url: baseUrl + eventType,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(encodeMessage(data)),
      },
    };
  }

  /** 最近一次请求的 HTTP 状态码（仅用于日志 / UI 诊断，不改变 Java 的"只取响应文本"语义）。 */
  lastStatus: number | null = null;

  private async execute(url: string, init: RequestInit): Promise<string> {
    const response = await this.fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    this.lastStatus = response.status;
    return response.text();
  }

  async blockSend(eventType: string, data: unknown): Promise<string> {
    const { url, init } = this.buildRequest(eventType, data);
    return this.execute(url, init);
  }

  /**
   * 连接被重置时重试一次。只能用于幂等接口（如 SOURCE_SINGLE / SOURCE_ALL）。
   * Java 端的兜底是强制 HTTP/1.1；Node fetch 本来就是 HTTP/1.1，这里只保留"重试一次"的语义。
   */
  async blockSendWithFallback(eventType: string, data: unknown): Promise<string> {
    const { url, init } = this.buildRequest(eventType, data);
    try {
      return await this.execute(url, init);
    } catch (error) {
      if (!isConnectionResetError(error)) throw error;
      return this.execute(url, init);
    }
  }
}
