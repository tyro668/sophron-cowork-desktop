/**
 * 同步任务调度，对应 Java `SyncTaskDispatcher` + `SyncTaskExecutor`：
 * - 按 sourceName 分组，每组有并发上限（Java 里是数据源的 `concurrent` 信号量）；
 * - 超出上限的任务排队；
 * - 每隔 tableHeartbeatInterval 秒把"等待中/同步中"的表上报到 /webhook/agent/s3/heartbeat。
 */
import type { LocalAgentLogger } from '../logger';
import type { S3HttpClient } from '../s3/s3-http-client';
import { SyncTaskStatus, type SyncTableInfo } from '../types';
import type { SyncTask } from './sync-task';

export const DEFAULT_SOURCE_CONCURRENCY = 5;

class SourceExecutor {
  readonly waiting: SyncTask[] = [];
  readonly running = new Set<SyncTask>();
  private readonly done = new Map<SyncTask, () => void>();
  private closed = false;

  constructor(
    readonly sourceName: string,
    private limit: number,
    private readonly logger: LocalAgentLogger
  ) {}

  setLimit(limit: number): void {
    this.limit = Math.max(1, limit);
    this.pump();
  }

  submit(task: SyncTask): Promise<void> {
    if (this.closed) return Promise.reject(new Error(`source ${this.sourceName} executor closed`));
    return new Promise<void>((resolve) => {
      this.done.set(task, resolve);
      this.waiting.push(task);
      this.pump();
    });
  }

  private pump(): void {
    while (!this.closed && this.running.size < this.limit && this.waiting.length > 0) {
      const task = this.waiting.shift()!;
      this.running.add(task);
      this.logger.info(`table get semaphore, tableId = ${this.sourceName}${task.tableName}`);
      void task
        .run()
        .catch((error) => this.logger.error('sync task crashed', error))
        .finally(() => {
          // 先释放"令牌"，再通知调用方，保证 submit() resolve 时任务已不在 running 中
          this.running.delete(task);
          const resolve = this.done.get(task);
          this.done.delete(task);
          resolve?.();
          this.pump();
        });
    }
  }

  collect(): SyncTableInfo[] {
    return [
      ...this.waiting.map((t) => ({
        groupId: t.groupId,
        sourceName: this.sourceName,
        tableName: t.tableName,
        syncStatus: SyncTaskStatus.WAITING,
      })),
      ...[...this.running].map((t) => ({
        groupId: t.groupId,
        sourceName: this.sourceName,
        tableName: t.tableName,
        syncStatus: SyncTaskStatus.RUNNING,
      })),
    ];
  }

  close(): void {
    this.closed = true;
    for (const task of this.waiting) this.done.get(task)?.();
    this.waiting.length = 0;
  }
}

export class SyncTaskDispatcher {
  private readonly executors = new Map<string, SourceExecutor>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatIntervalSec = 0;

  constructor(
    private readonly client: S3HttpClient,
    private readonly logger: LocalAgentLogger,
    private readonly defaultConcurrency: number = DEFAULT_SOURCE_CONCURRENCY
  ) {}

  setSourceConcurrency(sourceName: string, limit: number): void {
    this.executorFor(sourceName).setLimit(limit);
  }

  submit(task: SyncTask): Promise<void> {
    return this.executorFor(task.sourceName).submit(task);
  }

  collectSyncTables(): SyncTableInfo[] {
    return [...this.executors.values()].flatMap((e) => e.collect());
  }

  /** 按云端下发的间隔（秒）启动/重启心跳；≤0 时停止。 */
  startHeartbeat(intervalSec: number): void {
    if (intervalSec === this.heartbeatIntervalSec && this.heartbeatTimer) return;
    this.stopHeartbeat();
    this.heartbeatIntervalSec = intervalSec;
    if (!(intervalSec > 0)) return;
    this.logger.info(`start heartbeat task, interval: ${intervalSec}`);
    this.heartbeatTimer = setInterval(() => void this.reportHeartbeatOnce(), intervalSec * 1000);
    this.heartbeatTimer.unref?.();
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.heartbeatIntervalSec = 0;
  }

  async reportHeartbeatOnce(): Promise<void> {
    try {
      const tables = this.collectSyncTables();
      if (tables.length === 0) return;
      this.logger.info(`heartbeat task running, tableInfos size: ${tables.length}`);
      await this.client.reportHeartbeat(tables);
    } catch (error) {
      this.logger.error('table heartbeat task failed, scheduler skip this error.', error);
    }
  }

  close(): void {
    this.stopHeartbeat();
    for (const executor of this.executors.values()) executor.close();
    this.executors.clear();
  }

  private executorFor(sourceName: string): SourceExecutor {
    let executor = this.executors.get(sourceName);
    if (!executor) {
      executor = new SourceExecutor(sourceName, this.defaultConcurrency, this.logger);
      this.executors.set(sourceName, executor);
    }
    return executor;
  }
}
