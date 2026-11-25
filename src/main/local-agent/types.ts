/**
 * 本地宝（hihidata-agent）云端通道的数据结构。
 *
 * 字段名与 Java 端 Jackson 序列化结果保持一致（包括服务端拼写错误的
 * `rowcountTimout` / `contentTimout`），不要"修正"拼写，否则云端解析不到。
 */

/** config.yaml 中的 `server` 段，对应 Java `ServerConfig`。 */
export interface LocalAgentServerConfig {
  agentId: string;
  token: string;
  protocol: 'http' | 'https' | string;
  host: string;
  port: number;
  /** 网关前缀，例如 `/agent`；最终 Socket.IO path 为 `${path}/socket.io`。 */
  path?: string;
  /** 配置文件里的版本号（例如 `v4.0`），Java 端不使用；握手用的是产品版本。 */
  version?: string;
}

/** config.yaml 中的 `socket.io` 段，对应 Java `SocketIoConfig`。 */
export interface LocalAgentSocketIoConfig {
  /** 0 表示无限重试（Java socket.io-client 2.x 语义）。 */
  reconnectionAttempts: number;
  reconnectionDelay: number;
  timeout: number;
}

export interface LocalAgentConfig {
  server: LocalAgentServerConfig;
  socketIO: LocalAgentSocketIoConfig;
}

/** 云端 `connectSuccess` 事件下发的环境参数，对应 Java `RemoteEnvBean`。 */
export interface RemoteEnvBean {
  baseUrl?: string;
  rowcountTimout?: number;
  contentTimout?: number;
  maxSyncExcelSize?: number;
  maxColSize?: number;
  s3InternalCooldownTime?: number;
  tableHeartbeatInterval?: number;
}

/** webhook 通用返回体，对应 Java `Resp<T>`。 */
export interface Resp<T> {
  code: number;
  msg?: string;
  data?: T;
}

/** 分片上传地址，对应 Java `S3Path`。 */
export interface S3Path {
  uploadId?: string;
  internalUploadUrl?: string;
  externalUploadUrl?: string;
  httpMethod?: string;
  /** 预签名过期时间，毫秒时间戳。 */
  expiration: number;
  /** 实际的 OSS 对象路径。 */
  path?: string;
}

/** 表元信息，对应 Java `SimpleSourceMeta`。 */
export interface SimpleSourceMeta {
  tableColumns?: string[];
  tableColumnTypes?: number[];
  tableColumnComments?: string[];
}

/** 云端下发的取数请求，对应 Java `FetchBean`（只保留上传链路用到的字段）。 */
export interface FetchBean {
  tableName: string;
  sourceName: string;
  messageId?: string;
  groupId?: string;
  /** 云端预先分配好的首个文件路径。 */
  path?: string;
  /** 云端预先创建好的首个 multipart uploadId。 */
  uploadId?: string;
  tableMeta?: SimpleSourceMeta;
  queryTimout?: number;
  /** 预览需要的行数；Java `FetchBean.isPreview()` 就是 `rowSize > 0`（没有单独的 preview 字段）。 */
  rowSize?: number;
  offset?: number;
  sourceTableId?: string;
  forceOverwrite?: boolean;
  update?: boolean;
  [key: string]: unknown;
}

/** Java `FetchBean.isPreview()`：`rowSize > 0`（`@JsonIgnore`，云端不会下发 preview 字段）。 */
export function isPreviewFetch(bean: Pick<FetchBean, 'rowSize'>): boolean {
  return Number(bean.rowSize ?? 0) > 0;
}

/** 写入方式，对应 Java `WriteType`。 */
export enum WriteType {
  OVERWRITE = 0,
  APPEND = 1,
  UPSERT = 3,
}

/** 批量同步状态，对应 Java `AgentSyncStatusEnum`。 */
export enum AgentSyncStatus {
  UPLOAD_SUCCESS = 0,
  UPLOAD_FAILED = 1,
  START_SYNC = 2,
  UNDEFINE = -1,
}

/** 心跳里的表状态，对应 Java `SyncTaskStatus`（0 等待中，1 同步中）。 */
export enum SyncTaskStatus {
  WAITING = 0,
  RUNNING = 1,
}

/** 上传源信息，对应 Java `S3SourceData` 中上传链路用到的部分。 */
export interface S3SourceData {
  sourceName: string;
  tableName: string;
  messageId?: string;
  groupId?: string;
  path?: string;
  uploadId?: string;
  /** WriteType。 */
  type: number;
  meta?: SimpleSourceMeta;
  equalColumns?: string[];
  skipSync?: boolean;
}

/** `/webhook/agent/s3/syncStatus` 请求体，对应 Java `SyncStatusRequest`。 */
export interface SyncStatusRequest {
  syncStatus?: number;
  messageId?: string;
  groupId?: string;
  sourceName?: string;
  tableName?: string;
  agentClientId?: string;
  path?: string;
  equalsColumns?: string[];
  tableColumns?: string[];
  tableColumnTypes?: number[];
  tableColumnComments?: string[];
  skipSync?: boolean;
  writeType?: number;
  errorMsg?: string;
}

/** 心跳表信息，对应 Java `SyncTableInfo`。 */
export interface SyncTableInfo {
  groupId?: string;
  sourceName: string;
  tableName: string;
  syncStatus: SyncTaskStatus;
}

export type LocalAgentConnectionState =
  'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'offline' | 'stopped';
