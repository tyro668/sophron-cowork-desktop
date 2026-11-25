/**
 * 对应 Java `S3HttpUtils.retryer`（guava-retrying）：
 * - 最多 3 次；
 * - 等待 = min(30ms × 2^n, 60s) + random(0~500ms)，n 为已失败次数；
 * - 只对 IOException 类错误重试（这里是 S3TransferError / 网络错误 / 超时），业务错误直接抛出。
 */
import { SyncBizError } from './errors';

export interface RetryPolicy {
  maxAttempts: number;
  multiplierMs: number;
  maxWaitMs: number;
  randomWaitMs: number;
}

export const DEFAULT_S3_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  multiplierMs: 30,
  maxWaitMs: 60_000,
  randomWaitMs: 500,
};

export function computeRetryDelay(
  failedAttempts: number,
  policy: RetryPolicy,
  random: () => number = Math.random
): number {
  const exp = Math.min(Math.round(policy.multiplierMs * 2 ** failedAttempts), policy.maxWaitMs);
  return exp + Math.floor(random() * policy.randomWaitMs);
}

export function isRetryableError(error: unknown): boolean {
  return !(error instanceof SyncBizError);
}

export async function withS3Retry<T>(
  operation: () => Promise<T>,
  policy: RetryPolicy = DEFAULT_S3_RETRY_POLICY,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error) || attempt === policy.maxAttempts) throw error;
      await sleep(computeRetryDelay(attempt, policy));
    }
  }
  throw lastError;
}
