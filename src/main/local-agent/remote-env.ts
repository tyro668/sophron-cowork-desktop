/**
 * 云端下发的运行参数，对应 Java `RemoteEnvs` + `EventFactory.update()`。
 */
import type { RemoteEnvBean } from './types';

export interface RemoteEnvSnapshot {
  baseUrl?: string;
  /** 秒 */
  rowcountTimeout: number;
  /** 秒 */
  contentTimeout: number;
  maxSyncExcelSize: number;
  maxColSize: number;
  /** 内网上传失败后的冷却时间（秒） */
  s3InternalCooldownTime: number;
  /** 表同步心跳间隔（秒） */
  tableHeartbeatInterval: number;
}

const DEFAULTS: RemoteEnvSnapshot = {
  baseUrl: undefined,
  rowcountTimeout: 0,
  contentTimeout: 0,
  maxSyncExcelSize: 10,
  maxColSize: 1000,
  s3InternalCooldownTime: 0,
  tableHeartbeatInterval: 0,
};

type Listener = (env: RemoteEnvSnapshot) => void;

export class RemoteEnvStore {
  private env: RemoteEnvSnapshot = { ...DEFAULTS };
  private readonly listeners = new Set<Listener>();

  get(): RemoteEnvSnapshot {
    return { ...this.env };
  }

  get baseUrl(): string | undefined {
    return this.env.baseUrl;
  }

  /** 解析 `connectSuccess` 的参数，可以是 JSON 字符串或对象（Java 端用 args[0].toString()）。 */
  static parse(payload: unknown): RemoteEnvBean | null {
    if (payload === null || payload === undefined) return null;
    if (typeof payload === 'string') {
      const text = payload.trim();
      if (!text) return null;
      return JSON.parse(text) as RemoteEnvBean;
    }
    if (typeof payload === 'object') return payload as RemoteEnvBean;
    return null;
  }

  update(bean: RemoteEnvBean | null): RemoteEnvSnapshot {
    if (bean) {
      const num = (v: unknown, fallback: number) =>
        typeof v === 'number' && Number.isFinite(v) ? v : fallback;
      this.env = {
        baseUrl: typeof bean.baseUrl === 'string' && bean.baseUrl ? bean.baseUrl : undefined,
        rowcountTimeout: num(bean.rowcountTimout, 0),
        contentTimeout: num(bean.contentTimout, 0),
        maxSyncExcelSize: num(bean.maxSyncExcelSize, DEFAULTS.maxSyncExcelSize),
        maxColSize: num(bean.maxColSize, DEFAULTS.maxColSize),
        s3InternalCooldownTime: num(bean.s3InternalCooldownTime, 0),
        tableHeartbeatInterval: num(bean.tableHeartbeatInterval, 0),
      };
    }
    const snapshot = this.get();
    for (const listener of this.listeners) listener(snapshot);
    return snapshot;
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
