/**
 * 内网上传可用性缓存，对应 Java `S3HttpUtils.NETWORK_STATE_CACHE`。
 * 探测结果（可用/不可用）缓存 max(300, s3InternalCooldownTime) 秒；
 * 内网上传失败后写入"不可用"，冷却期内一律走外网。
 *
 * 差异：Java 的缓存 TTL 在类加载时就定死了（那时通常还没收到 connectSuccess，等于 300 秒）；
 * 这里每次写入时按当前的云端参数计算。
 */
import { MIN_INTERNAL_COOLDOWN_SECONDS } from '../constants';

export class InternalNetworkState {
  private value: boolean | undefined;
  private expiresAt = 0;

  constructor(
    private readonly cooldownSeconds: () => number,
    private readonly now: () => number = Date.now
  ) {}

  get(): boolean | undefined {
    if (this.value === undefined) return undefined;
    if (this.now() >= this.expiresAt) {
      this.value = undefined;
      return undefined;
    }
    return this.value;
  }

  set(value: boolean): void {
    const ttl = Math.max(MIN_INTERNAL_COOLDOWN_SECONDS, this.cooldownSeconds() || 0);
    this.value = value;
    this.expiresAt = this.now() + ttl * 1000;
  }

  clear(): void {
    this.value = undefined;
    this.expiresAt = 0;
  }
}
