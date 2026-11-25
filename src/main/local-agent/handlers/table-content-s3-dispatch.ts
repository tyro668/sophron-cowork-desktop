/**
 * `table_content_s3_dispatch` 任务处理，对应 Java `TableContentS3DispatchHandler`。
 *
 * 取数（JDBC/Excel 等）不在本次迁移范围内，通过 `TableContentProvider` 注入：
 * provider 往 `S3UploadStream` 里写数据，本处理器负责建流、关流（最后一片 + 合并）
 * 和状态上报（由 S3SyncTask 完成）。
 */
import type { LocalAgentLogger } from '../logger';
import type { S3HttpClient } from '../s3/s3-http-client';
import { S3UploadStream, type S3UploadStreamOptions } from '../s3/s3-upload-stream';
import { S3SyncTask } from '../sync/sync-task';
import type { SyncTaskDispatcher } from '../sync/sync-dispatcher';
import type { SocketTaskContext } from '../transport/event-dispatcher';
import { WriteType, type FetchBean, type S3SourceData } from '../types';

export interface TableContentProviderContext {
  fetchBean: FetchBean;
  /** 可以修改 type / equalColumns / skipSync / meta，成功上报时会带上。 */
  source: S3SourceData;
  stream: S3UploadStream;
}

export type TableContentProvider = (ctx: TableContentProviderContext) => Promise<void>;

export interface TableContentProviderRegistry {
  get(sourceName: string): TableContentProvider | undefined;
}

export function parseFetchBean(payload: unknown): FetchBean {
  const bean = (typeof payload === 'string' ? JSON.parse(payload) : payload) as FetchBean | null;
  if (!bean || typeof bean !== 'object') throw new Error('invalid fetch bean payload');
  return bean;
}

/** 对应 `S3SourceData.create(FetchBean)`。 */
export function createS3SourceData(fetchBean: FetchBean): S3SourceData {
  return {
    sourceName: fetchBean.sourceName,
    tableName: fetchBean.tableName,
    messageId: fetchBean.messageId,
    groupId: fetchBean.groupId,
    path: fetchBean.path,
    uploadId: fetchBean.uploadId,
    meta: fetchBean.tableMeta,
    type: WriteType.OVERWRITE,
  };
}

export interface TableContentS3DispatchDeps {
  client: S3HttpClient;
  dispatcher: SyncTaskDispatcher;
  providers: TableContentProviderRegistry;
  logger: LocalAgentLogger;
  streamOptions?: S3UploadStreamOptions;
}

export function createTableContentS3DispatchHandler(deps: TableContentS3DispatchDeps) {
  return async (ctx: SocketTaskContext): Promise<void> => {
    deps.logger.info(`start fetch table content s3 batch, messageId: ${ctx.messageId}`);
    const fetchBean = parseFetchBean(ctx.payload);
    fetchBean.messageId = ctx.messageId;
    const task = new S3SyncTask(
      fetchBean,
      async () => {
        const provider = deps.providers.get(fetchBean.sourceName);
        if (!provider) {
          throw new Error(`datasource not found: ${fetchBean.sourceName}`);
        }
        const source = createS3SourceData(fetchBean);
        const stream = new S3UploadStream(source, deps.client, deps.logger, deps.streamOptions);
        await provider({ fetchBean, source, stream });
        await stream.close();
        return source;
      },
      deps.client,
      deps.logger
    );
    // 不 await：与 Java 一样，事件回调里只负责入队
    void deps.dispatcher.submit(task);
  };
}
