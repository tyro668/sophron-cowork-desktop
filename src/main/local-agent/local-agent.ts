/**
 * 本地宝云端通道的组合入口：连接 + 事件分发 + 发送器 + OSS 分片上传 + 同步调度。
 *
 * 用法（主进程）：
 *   const agent = await LocalAgent.fromConfigFile(configPath, { version: '3.0.0' });
 *   agent.registerTableContentProvider('mysql-1', async ({ stream }) => { ... });
 *   agent.on('offline', () => notifyUser());
 *   agent.start();
 */
import { EventEmitter } from 'node:events';

import { loadLocalAgentConfig } from './config';
import { LocalAgentConnection, type IoFactory } from './connection';
import { DEFAULT_API_LEVEL, ReceiveEvent } from './constants';
import {
  createTableContentS3DispatchHandler,
  type TableContentProvider,
} from './handlers/table-content-s3-dispatch';
import { consoleLocalAgentLogger, type LocalAgentLogger } from './logger';
import { RemoteEnvStore, type RemoteEnvSnapshot } from './remote-env';
import { S3HttpClient } from './s3/s3-http-client';
import type { S3UploadStreamOptions } from './s3/s3-upload-stream';
import { uploadLocalFile, type UploadLocalFileOptions } from './s3/upload-file';
import { SyncTaskDispatcher } from './sync/sync-dispatcher';
import { SocketEventDispatcher, type SocketTaskHandler } from './transport/event-dispatcher';
import { HttpMessageSender, type FetchLike } from './transport/http-sender';
import { SocketMessageSender } from './transport/socket-sender';
import type { LocalAgentConfig, LocalAgentConnectionState, S3SourceData } from './types';

export interface LocalAgentOptions {
  version: string;
  apiLevel?: string;
  logger?: LocalAgentLogger;
  fetchImpl?: FetchLike;
  ioFactory?: IoFactory;
  enableInternalNetwork?: boolean;
  streamOptions?: S3UploadStreamOptions;
  aliveLogIntervalMs?: number;
  /**
   * 是否注册内置任务处理器（table_content_s3_dispatch）。冒烟测试连生产环境时设为 false，
   * 保证不响应云端任务。默认 true。
   */
  registerDefaultHandlers?: boolean;
}

export interface LocalAgentEvents {
  state: [LocalAgentConnectionState];
  connectSuccess: [RemoteEnvSnapshot];
  connectError: [string];
  disconnect: [string];
  offline: [];
}

export class LocalAgent extends EventEmitter<LocalAgentEvents> {
  readonly remoteEnv = new RemoteEnvStore();
  readonly events: SocketEventDispatcher;
  readonly connection: LocalAgentConnection;
  readonly socketSender = new SocketMessageSender();
  readonly httpSender: HttpMessageSender;
  readonly s3: S3HttpClient;
  readonly syncDispatcher: SyncTaskDispatcher;
  private readonly providers = new Map<string, TableContentProvider>();
  private readonly logger: LocalAgentLogger;
  /** 上报给云端的版本号（Java `ProductVersion.getVersion()`，即 jarVersion）。 */
  readonly version: string;
  readonly apiLevel: string;

  static async fromConfigFile(configPath: string, options: LocalAgentOptions): Promise<LocalAgent> {
    return new LocalAgent(await loadLocalAgentConfig(configPath), options);
  }

  constructor(
    readonly config: LocalAgentConfig,
    options: LocalAgentOptions
  ) {
    super();
    this.version = options.version;
    this.apiLevel = options.apiLevel ?? DEFAULT_API_LEVEL;
    this.logger = options.logger ?? consoleLocalAgentLogger;
    this.events = new SocketEventDispatcher(this.logger);
    this.connection = new LocalAgentConnection({
      config,
      version: options.version,
      apiLevel: options.apiLevel,
      logger: this.logger,
      remoteEnv: this.remoteEnv,
      dispatcher: this.events,
      ioFactory: options.ioFactory,
      aliveLogIntervalMs: options.aliveLogIntervalMs,
    });
    this.httpSender = new HttpMessageSender(this.remoteEnv, options.fetchImpl);
    this.s3 = new S3HttpClient({
      remoteEnv: this.remoteEnv,
      credentials: () => ({ agentId: config.server.agentId, token: config.server.token }),
      logger: this.logger,
      fetchImpl: options.fetchImpl,
      enableInternalNetwork: options.enableInternalNetwork,
    });
    this.syncDispatcher = new SyncTaskDispatcher(this.s3, this.logger);

    if (options.registerDefaultHandlers !== false)
      this.events.register(
        ReceiveEvent.QUERY_CONTENT_OF_TABLE_S3_DISPATCH,
        createTableContentS3DispatchHandler({
          client: this.s3,
          dispatcher: this.syncDispatcher,
          providers: this.providers,
          logger: this.logger,
          streamOptions: options.streamOptions,
        })
      );

    this.connection.on('state', (s) => this.emit('state', s));
    this.connection.on('connectError', (m) => this.emit('connectError', m));
    this.connection.on('disconnect', (r) => this.emit('disconnect', r));
    this.connection.on('connectSuccess', (env) => {
      this.socketSender.setSocket(this.connection.getSocket());
      this.syncDispatcher.startHeartbeat(env.tableHeartbeatInterval);
      this.emit('connectSuccess', env);
    });
    this.connection.on('offline', () => {
      this.syncDispatcher.close();
      this.emit('offline');
    });
  }

  get state(): LocalAgentConnectionState {
    return this.connection.state;
  }

  start(): boolean {
    const started = this.connection.start();
    this.socketSender.setSocket(this.connection.getSocket());
    return started;
  }

  stop(): void {
    this.syncDispatcher.close();
    this.connection.stop();
    this.socketSender.setSocket(null);
  }

  /** 注册某个数据源的取数实现（JDBC/Excel 等不在本模块范围内）。 */
  registerTableContentProvider(
    sourceName: string,
    provider: TableContentProvider,
    concurrency?: number
  ): void {
    this.providers.set(sourceName, provider);
    if (concurrency) this.syncDispatcher.setSourceConcurrency(sourceName, concurrency);
  }

  unregisterTableContentProvider(sourceName: string): void {
    this.providers.delete(sourceName);
  }

  /** 注册其它云端任务事件（tables / table_structure 等），参数约定见 SocketEventDispatcher。 */
  onTask(event: string, handler: SocketTaskHandler): void {
    this.events.register(event, handler);
  }

  /** 把本地文件分片上传到云端分配的 OSS 路径。 */
  uploadFile(filePath: string, source: S3SourceData, options?: UploadLocalFileOptions) {
    return uploadLocalFile(filePath, source, this.s3, this.logger, options);
  }
}
