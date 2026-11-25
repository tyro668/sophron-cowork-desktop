/**
 * 云连接（本地宝能力）跨进程契约。token 只保存在主进程的加密存储里，不会出现在这些类型中。
 */

export type CloudConnectionStatus =
  'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'offline' | 'stopped';

/** 新安装或配置中缺少该字段时默认自动连接；仅保留用户在设置里明确关闭的 false。 */
export const DEFAULT_AUTO_CONNECT = true;
/** 首次连接等待时限（毫秒）。 */
export const CLOUD_CONNECT_TIMEOUT_MS = 15_000;
/** 与主进程超时失败文案一致（设置页 / toast 直接展示）。 */
export const CLOUD_CONNECT_TIMEOUT_ERROR = '连接超时，请检查云连接配置';

/** 缺省或未写入时视为开启自动连接。 */
export function resolveAutoConnect(value: boolean | undefined | null): boolean {
  return value ?? DEFAULT_AUTO_CONNECT;
}

/** 为新引用生成不与已用名冲突的上报表名（重名时追加 " (2)"、" (3)"…）。 */
export function suggestReportName(displayName: string, used: Set<string>): string {
  const base = displayName.trim() || '未命名表';
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base} (${i})`)) i += 1;
  return `${base} (${i})`;
}

/** 旧数据缺省该字段，视为已确认。 */
export function isCloudConnectionRefNameConfirmed(ref: { nameConfirmed?: boolean }): boolean {
  return ref.nameConfirmed !== false;
}

/** 未连接 / 连接失败 / 已断开 / 已下线时可点击徽标发起连接。 */
export function isCloudConnectionBadgeClickable(state: { status: CloudConnectionStatus }): boolean {
  return (
    state.status !== 'connected' && state.status !== 'connecting' && state.status !== 'reconnecting'
  );
}

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
 * `reportName` 是上报给云端的 tableName；确认后冻结。未确认（未完成）的引用不上报云端。
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
  /**
   * 上报表名是否已确认。缺省（旧数据）视为已确认。
   * `false` 表示未完成：可改名，且不会出现在上报给云端的表列表里。
   */
  nameConfirmed?: boolean;
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
