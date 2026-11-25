/** 可重试的网络/HTTP 错误，对应 Java 的 IOException。 */
export class S3TransferError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'S3TransferError';
  }
}

/** 上游业务错误（Resp.code 在 400~500），不重试，对应 Java `SyncBizException`。 */
export class SyncBizError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncBizError';
  }
}
