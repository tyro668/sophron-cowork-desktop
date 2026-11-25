/**
 * 事件名、webhook 路径与默认值，逐一对应 Java：
 * `ProjectConstants.Ws`、`ReceiveEvent`、`SendEvent`、`HTTPEvent`、`AgentEnv`。
 */

export const WS = {
  TOKEN: 'token',
  AGENT_ID: 'agentId',
  VERSION: 'version',
  API_LEVEL: 'apiLevel',
  INSTANCE_ID: 'instanceId',
  NAMESPACE: '/database',
} as const;

/** Java `ProductVersion` 当前的 DEFAULT_API_LEVEL。 */
export const DEFAULT_API_LEVEL = '5';

/** 未在 config.yaml 指定 server.version 时上报的本地宝版本号（与冒烟测试一致）。 */
export const DEFAULT_AGENT_VERSION = '4.0';

/** Java `VerifyUtil.DEMO_ID`：示例配置，不连接云端。 */
export const DEMO_AGENT_ID = 'DEMO_AGENTID';

/** 云端 → 本地宝的任务事件（Java `ReceiveEvent`）。 */
export const ReceiveEvent = {
  QUERY_ALL_TABLES: 'tables',
  QUERY_ROWCOUNT_OF_TABLE: 'table_rowcount',
  QUERY_CONTENT_OF_TABLE: 'table_content',
  QUERY_CONTENT_OF_TABLE_S3: 'table_content_s3',
  QUERY_CONTENT_OF_TABLE_S3_DISPATCH: 'table_content_s3_dispatch',
  QUERY_STRUCTURE_OF_TABLE: 'table_structure',
  QUERY_CDC_OF_TABLE: 'table_cdc_info',
  CDC_SWITCH: 'cdc_switch',
  QUERY_CONNECTION_DIALECT_METADATA: 'connection_dialect_metadata',
} as const;

/** 本地宝 → 云端的结果事件（Java `SendEvent`）。 */
export const SendEvent = {
  SEND_ALL_GROUP: 'groups_result',
  SEND_ALL_TABLES: 'tables_result',
  SEND_ROWCOUNT_OF_TABLE: 'table_rowcount_result',
  SEND_CONTENT_OF_TABLE: 'table_content_result',
  SEND_CONTENT_OF_TABLE_S3: 'table_content_s3_result',
  SEND_STRUCTURE_OF_TABLE: 'table_structure_result',
  SEND_PREVIEW_OF_TABLE: 'table_preview_result',
  SEND_CDC_INFO_OF_TABLE: 'table_cdc_info_result',
  SEND_CDC_MESSAGE_OF_TABLE: 'table_cdc_message_result',
  CDC_SWITCH_RESULT: 'cdc_switch_result',
  SEND_CONNECTION_DIALECT_METADATA: 'connection_dialect_metadata_result',
  CMD: 'agent_cmd',
} as const;

/** 连接生命周期相关的服务端自定义事件（Java `EventFactory.initFlowEvent`）。 */
export const FlowEvent = {
  CONNECT_SUCCESS: 'connectSuccess',
  CONNECT_ERROR_MESSAGE: 'connectErrorMessage',
  OFFLINE: 'offline',
} as const;

/** HTTP webhook 路径，拼在 `connectSuccess.baseUrl` 后面（Java `HTTPEvent`）。 */
export const HttpEvent = {
  CDC_DATA: '/webhook/agent/cdc',
  SOURCE_SINGLE: '/webhook/agent/source/single',
  SOURCE_ALL: '/webhook/agent/source/all',
  S3_FILE_PATH: '/webhook/agent/s3/files/url',
  S3_NEXT_PART_URL: '/webhook/agent/s3/parts/url',
  S3_COMPLETE_PART_URL: '/webhook/agent/s3/parts/complete',
  S3_NOTIFY_SYNC_STATUS: '/webhook/agent/s3/syncStatus',
  REPORT_TABLE_HEARTBEAT: '/webhook/agent/s3/heartbeat',
} as const;

export const DEFAULT_SOCKET_IO = {
  reconnectionAttempts: 0,
  reconnectionDelay: 1000,
  timeout: 20000,
} as const;

/** Java `AgentEnv.s3BatchSize()`：默认 10MB 一个分片（系统属性 s3BatchSize，单位 MB）。 */
export const DEFAULT_S3_BATCH_SIZE = 10 * 1024 * 1024;

/** Java `FileUploadTask.MAX_PART_NUMBER`：单文件最多 10000 片，超过换下一个文件。 */
export const MAX_PART_NUMBER = 10000;

/** Java `S3HttpUtils.NETWORK_STATE_CACHE` 的最小冷却时间（秒）。 */
export const MIN_INTERNAL_COOLDOWN_SECONDS = 300;

/** Java `MessageQueueEmitter` 的队列容量。 */
export const SOCKET_EMIT_QUEUE_CAPACITY = 16;
