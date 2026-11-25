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

export interface CloudConnectionSheetSummary {
  sheetName?: string;
  tableId: string;
  columns: string[];
  columnTypes: number[];
  rowCount: number;
}

export type CloudConnectionFileStatus = 'pending' | 'parsing' | 'ready' | 'error';

export interface CloudConnectionFile {
  path: string;
  name: string;
  status: CloudConnectionFileStatus;
  error?: string;
  size?: number;
  modifyTime?: number;
  sheets?: CloudConnectionSheetSummary[];
}

export interface CloudConnectionFilePreview {
  path: string;
  name: string;
  charset?: string;
  delimiter?: string;
  sheets: Array<CloudConnectionSheetSummary & { sampleRows: (string | null)[][] }>;
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
  sourceName: string;
  files: CloudConnectionFile[];
  activities: CloudConnectionActivity[];
}

export interface CloudConnectionActionResult {
  success: boolean;
  error?: string;
  state: CloudConnectionState;
}
