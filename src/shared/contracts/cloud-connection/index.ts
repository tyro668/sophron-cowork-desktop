/**
 * 云连接（本地宝能力）跨进程契约。token 只保存在主进程的加密存储里，不会出现在这些类型中。
 */

export type CloudConnectionStatus =
  'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'offline' | 'stopped';

/** 已导入配置的脱敏信息。 */
export interface CloudConnectionConfigSummary {
  /** agentId 脱敏显示（前 4 位 + 后 4 位）。 */
  agentIdMasked: string;
  protocol: string;
  host: string;
  port: number;
  path?: string;
  /** 导入时的文件名（不含目录）。 */
  fileName?: string;
  importedAt: number;
  hasToken: boolean;
}

/**
 * 云连接中的一张表：只能引用已有原始表或结果表，自身不再保存目录或文件读取配置。
 * `reportName` 是上报给云端的 tableName，绑定时冻结。
 */
export type CloudConnectionRefKind = 'raw' | 'result';

export type CloudConnectionRefStatus = 'ok' | 'missing' | 'unmaterialized' | 'abnormal' | 'pending';

export interface CloudConnectionTableRefInput {
  reportName?: string;
  kind: CloudConnectionRefKind;
  tableId: string;
}

export interface CloudConnectionTableRef {
  reportName: string;
  kind: CloudConnectionRefKind;
  tableId: string;
  /** 被引用表当前显示名；删除后为空。 */
  displayName?: string;
  status: CloudConnectionRefStatus;
  /** 状态说明（缺失、尚未物化、数据异常原因）。 */
  statusReason?: string;
  rowCount?: number;
  columnCount?: number;
}

/** @deprecated 仅用于读取 schema v2 及以前的落盘数据并迁移。 */
export interface LegacyCloudConnectionTableConfig {
  tableName: string;
  strategy: number;
  fieldStrategy: number;
  readStrategy: number;
  appendStrategy: number;
  relativeFilePath: string;
  headerRowNumber: number;
  sheetStrategy: number;
  sheetNumber: number;
  sheetName: string;
  password?: string;
  hasPassword?: boolean;
}

/** 分组里展示用的一行（id = reportName）。 */
export interface CloudConnectionTableEntry {
  id: string;
  kind: CloudConnectionRefKind;
  tableId: string;
  displayName?: string;
  status: CloudConnectionRefStatus;
}

/** 分组：纯逻辑分组，分组名即上报用的 sourceName。 */
export interface CloudConnectionGroup {
  id: string;
  sourceName: string;
  tables: CloudConnectionTableRef[];
  entries: CloudConnectionTableEntry[];
  entriesStatus: 'pending' | 'ready' | 'error';
  entriesError?: string;
}

export interface CloudConnectionGroupInput {
  sourceName: string;
}

export interface CloudConnectionTablePreview {
  tableName: string;
  columns: string[];
  columnTypes: number[];
  rowCount: number;
  rows: (string | null)[][];
}

export interface CloudConnectionActivity {
  at: number;
  type: 'request' | 'response' | 'error' | 'info';
  event: string;
  tableName?: string;
  detail?: string;
}

export interface CloudConnectionState {
  configured: boolean;
  config: CloudConnectionConfigSummary | null;
  status: CloudConnectionStatus;
  connectedAt: number | null;
  /** connectSuccess 下发的环境参数（baseUrl、超时、心跳间隔等）。 */
  remoteEnv: Record<string, unknown> | null;
  lastError: string | null;
  autoConnect: boolean;
  groups: CloudConnectionGroup[];
  activities: CloudConnectionActivity[];
}

export interface CloudConnectionActionResult {
  success: boolean;
  error?: string;
  state: CloudConnectionState;
}
