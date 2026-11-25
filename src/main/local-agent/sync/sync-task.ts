/**
 * 单表 S3 同步任务，对应 Java `S3SyncTask`：
 * prepare() 上报 START_SYNC → 执行取数+上传 → 成功上报 UPLOAD_SUCCESS（带路径和列信息），
 * 任何异常上报 UPLOAD_FAILED（带错误信息）。
 */
import type { LocalAgentLogger } from '../logger';
import type { S3HttpClient } from '../s3/s3-http-client';
import { AgentSyncStatus, type FetchBean, type S3SourceData } from '../types';

export interface SyncTask {
  readonly sourceName: string;
  readonly tableName: string;
  readonly groupId?: string;
  run(): Promise<void>;
}

export class S3SyncTask implements SyncTask {
  constructor(
    private readonly fetchBean: FetchBean,
    private readonly work: () => Promise<S3SourceData>,
    private readonly client: S3HttpClient,
    private readonly logger: LocalAgentLogger
  ) {}

  get sourceName(): string {
    return this.fetchBean.sourceName;
  }

  get tableName(): string {
    return this.fetchBean.tableName;
  }

  get groupId(): string | undefined {
    return this.fetchBean.groupId;
  }

  async run(): Promise<void> {
    try {
      await this.prepare();
      const result = await this.work();
      await this.success(result);
    } catch (error) {
      await this.error(error);
    }
  }

  private async prepare(): Promise<void> {
    await this.client.notifySyncStatus({
      syncStatus: AgentSyncStatus.START_SYNC,
      groupId: this.fetchBean.groupId,
      messageId: this.fetchBean.messageId,
      sourceName: this.fetchBean.sourceName,
      tableName: this.fetchBean.tableName,
    });
  }

  private async success(result: S3SourceData): Promise<void> {
    await this.client.notifySyncStatus({
      syncStatus: AgentSyncStatus.UPLOAD_SUCCESS,
      messageId: result.messageId,
      sourceName: result.sourceName,
      tableName: result.tableName,
      path: result.path,
      tableColumns: result.meta?.tableColumns,
      tableColumnTypes: result.meta?.tableColumnTypes,
      tableColumnComments: result.meta?.tableColumnComments,
      equalsColumns: result.equalColumns,
      skipSync: result.skipSync ?? false,
      groupId: result.groupId,
      writeType: result.type,
    });
  }

  private async error(exception: unknown): Promise<void> {
    const message = exception instanceof Error ? exception.message : String(exception);
    this.logger.error(
      `table sync task failed, groupId: ${this.fetchBean.groupId}, messageId: ${this.fetchBean.messageId}, sourceName: ${this.fetchBean.sourceName}, tableName: ${this.fetchBean.tableName}`,
      exception
    );
    try {
      await this.client.notifySyncStatus({
        syncStatus: AgentSyncStatus.UPLOAD_FAILED,
        messageId: this.fetchBean.messageId,
        groupId: this.fetchBean.groupId,
        sourceName: this.fetchBean.sourceName,
        tableName: this.fetchBean.tableName,
        errorMsg: message,
      });
    } catch (notifyError) {
      this.logger.error('notify UPLOAD_FAILED failed', notifyError);
    }
  }
}
