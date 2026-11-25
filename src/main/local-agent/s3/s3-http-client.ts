/**
 * 预签名分片上传的 HTTP 客户端，对应 Java `S3HttpUtils`。
 *
 * 本地宝不直接持有 OSS/S3 密钥：所有对象路径、uploadId、每个分片的预签名 URL
 * 都由云端 Sync 通过 webhook 下发，本地只做 PUT 上传，最后再让云端合并分片。
 *
 *   POST {baseUrl}/webhook/agent/s3/files/url       申请新文件（换文件时）
 *   POST {baseUrl}/webhook/agent/s3/parts/url       申请第 N 片的预签名 URL
 *   PUT  {internal|external presigned url}          上传分片，取 ETag
 *   POST {baseUrl}/webhook/agent/s3/parts/complete  合并分片
 *   POST {baseUrl}/webhook/agent/s3/syncStatus      上报同步状态
 *   POST {baseUrl}/webhook/agent/s3/heartbeat       上报表同步心跳
 *
 * 所有 webhook 请求体都会合并 agentId + token。
 */
import { HttpEvent } from '../constants';
import type { LocalAgentLogger } from '../logger';
import { redactUrl } from '../logger';
import type { RemoteEnvStore } from '../remote-env';
import type { FetchLike } from '../transport/http-sender';
import { BaseUrlMissingError } from '../transport/http-sender';
import type { Resp, S3Path, SyncStatusRequest, SyncTableInfo } from '../types';
import { S3TransferError, SyncBizError } from './errors';
import { InternalNetworkState } from './internal-network-state';
import { DEFAULT_S3_RETRY_POLICY, type RetryPolicy, withS3Retry } from './retry';

/** Java readTimeout/writeTimeout：2 分钟。 */
export const S3_HTTP_TIMEOUT_MS = 2 * 60 * 1000;

export interface S3HttpClientOptions {
  remoteEnv: RemoteEnvStore;
  credentials: () => { agentId: string; token: string };
  logger: LocalAgentLogger;
  fetchImpl?: FetchLike;
  /** 对应 `-DenableInternalWork`，默认 true。 */
  enableInternalNetwork?: boolean;
  retryPolicy?: RetryPolicy;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface FetchFilePathParams {
  groupId?: string;
  sourceName: string;
  tableName: string;
  writeType: number;
  messageId?: string;
  index: number;
}

export interface NextPartParams {
  partNumber: number;
  uploadId: string;
  path: string;
  sourceName: string;
  tableName: string;
}

export class S3HttpClient {
  private readonly fetchImpl: FetchLike;
  private readonly retryPolicy: RetryPolicy;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  readonly networkState: InternalNetworkState;
  enableInternalNetwork: boolean;

  constructor(private readonly options: S3HttpClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.retryPolicy = options.retryPolicy ?? DEFAULT_S3_RETRY_POLICY;
    this.timeoutMs = options.timeoutMs ?? S3_HTTP_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
    this.enableInternalNetwork = options.enableInternalNetwork ?? true;
    this.networkState = new InternalNetworkState(
      () => options.remoteEnv.get().s3InternalCooldownTime,
      this.now
    );
  }

  private get logger(): LocalAgentLogger {
    return this.options.logger;
  }

  private retry<T>(op: () => Promise<T>): Promise<T> {
    return withS3Retry(op, this.retryPolicy, this.options.sleep);
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (error) {
      throw new S3TransferError(
        `request failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  /** POST JSON 到 webhook，自动带上 agentId/token，校验 Resp.code。 */
  async postWithCredentials<T>(
    suffix: string,
    payload: object,
    action: string
  ): Promise<T | undefined> {
    const baseUrl = this.options.remoteEnv.baseUrl;
    if (!baseUrl) throw new BaseUrlMissingError();
    const url = baseUrl + suffix;
    const body = JSON.stringify({ ...payload, ...this.options.credentials() });
    try {
      const resp = await this.retry(async () => {
        const response = await this.request(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body,
        });
        if (!response.ok) {
          throw new S3TransferError(`${action}: HTTP ${response.status} ${response.statusText}`);
        }
        const text = await response.text();
        if (!text) throw new S3TransferError(`Empty response from endpoint ${suffix}`);
        let parsed: Resp<T>;
        try {
          parsed = JSON.parse(text) as Resp<T>;
        } catch (error) {
          throw new S3TransferError(`Invalid JSON from endpoint ${suffix}`, { cause: error });
        }
        validateResp(parsed, suffix);
        return parsed;
      });
      return resp.data;
    } catch (error) {
      this.logger.error(`${action}, endpoint=${suffix}`, error);
      throw error;
    }
  }

  /** 申请文件路径（单文件超过 10000 片时换文件用）。 */
  async fetchFilePathInfo(params: FetchFilePathParams): Promise<S3Path> {
    const data = await this.postWithCredentials<S3Path>(
      HttpEvent.S3_FILE_PATH,
      { ...params },
      'Failed to fetch file url'
    );
    return requireS3Path(data, HttpEvent.S3_FILE_PATH);
  }

  /** 申请下一个分片的预签名 URL。 */
  async fetchNextPartUploadInfo(params: NextPartParams): Promise<S3Path> {
    const data = await this.postWithCredentials<S3Path>(
      HttpEvent.S3_NEXT_PART_URL,
      { ...params },
      'Failed to fetch next part upload url'
    );
    return requireS3Path(data, HttpEvent.S3_NEXT_PART_URL);
  }

  /**
   * 上传一个分片，返回去掉引号的 ETag。
   * 预签名过期则重新申请；启用内网时优先走 internalUploadUrl，失败则冷却期内改走外网。
   */
  async multiPartUpload(params: NextPartParams, s3Path: S3Path, data: Uint8Array): Promise<string> {
    let path = s3Path;
    if ((path.expiration ?? 0) <= this.now()) {
      path = await this.fetchNextPartUploadInfo({ ...params, path: path.path ?? params.path });
    }
    if (this.enableInternalNetwork && path.internalUploadUrl) {
      if (await this.checkInternalUrl(path.internalUploadUrl)) {
        try {
          this.logger.info('Upload part via internal network.');
          return await this.uploadPartToUrl(path.internalUploadUrl, params.partNumber, data);
        } catch (error) {
          this.logger.warn(
            'Internal network upload failed, attempting to use external network.',
            error
          );
          this.networkState.set(false);
        }
      } else {
        this.logger.warn('Internal network unreachable, attempting to use external network.');
      }
    }
    if (!path.externalUploadUrl) {
      throw new S3TransferError(`No upload url returned for part ${params.partNumber}`);
    }
    this.logger.info('Upload part via external network.');
    return this.uploadPartToUrl(path.externalUploadUrl, params.partNumber, data);
  }

  /** 探测内网地址：对预签名 URL 发一个空 PUT，2xx 即可用（与 Java 相同），结果缓存。 */
  async checkInternalUrl(url: string): Promise<boolean> {
    const cached = this.networkState.get();
    if (cached !== undefined) return cached;
    let internal = false;
    try {
      const response = await this.fetchImpl(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(0),
        signal: AbortSignal.timeout(Math.min(this.timeoutMs, 10_000)),
      });
      internal = response.status >= 200 && response.status < 300;
    } catch (error) {
      this.logger.warn(`Internal url call failed: ${redactUrl(url)}`, error);
    }
    this.networkState.set(internal);
    return internal;
  }

  async uploadPartToUrl(uploadUrl: string, partNumber: number, data: Uint8Array): Promise<string> {
    return this.retry(async () => {
      const response = await this.request(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: data as unknown as BodyInit,
      });
      if (!response.ok) {
        throw new S3TransferError(
          `Upload failed for part ${partNumber}: HTTP ${response.status} ${response.statusText}`
        );
      }
      let eTag = response.headers.get('ETag');
      if (!eTag) throw new S3TransferError(`No ETag returned for part ${partNumber}`);
      if (eTag.length >= 2 && eTag.startsWith('"') && eTag.endsWith('"')) {
        eTag = eTag.slice(1, -1);
      }
      return eTag;
    });
  }

  /** 合并分片，tags 必须按分片号顺序。 */
  async completePartUpload(path: string, uploadId: string, tags: string[]): Promise<void> {
    await this.postWithCredentials(
      HttpEvent.S3_COMPLETE_PART_URL,
      { path, uploadId, tags },
      'Failed to complete part upload'
    );
  }

  async notifySyncStatus(request: SyncStatusRequest = {}): Promise<void> {
    await this.postWithCredentials(
      HttpEvent.S3_NOTIFY_SYNC_STATUS,
      // Java 端整个 bean 序列化，基本类型字段总会带上
      stripUndefined({ skipSync: false, writeType: 0, ...request }),
      'Failed to notify sync status'
    );
  }

  async reportHeartbeat(tables: SyncTableInfo[]): Promise<void> {
    await this.postWithCredentials(
      HttpEvent.REPORT_TABLE_HEARTBEAT,
      { tables },
      'Failed to report heartbeat'
    );
  }
}

export function validateResp<T>(resp: Resp<T> | null | undefined, uri: string): void {
  if (!resp) throw new S3TransferError(`request failed without data, uri = ${uri}`);
  if (resp.code !== 200) {
    if (resp.code >= 400 && resp.code <= 500) {
      throw new SyncBizError(resp.msg ?? `request failed with code ${resp.code}`);
    }
    throw new S3TransferError(
      `request failed with code ${resp.code}, the reason is ${resp.msg}, uri = ${uri}`
    );
  }
}

function requireS3Path(data: S3Path | undefined, uri: string): S3Path {
  if (!data) throw new S3TransferError(`request returned empty data, uri = ${uri}`);
  return { ...data, expiration: Number(data.expiration ?? 0) };
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
