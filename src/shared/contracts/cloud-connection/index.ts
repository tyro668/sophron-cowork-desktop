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
 * 手动表配置（对应 Java `ExcelTableBean`）。文件密码只保存在主进程，渲染进程只知道是否设置。
 * 各数值字段的取值见 `src/main/local-agent/excel/local-config.ts` 的策略常量。
 */
export interface CloudConnectionTableConfig {
  tableName: string;
  /** `TableSourceStrategy`：0 = 单文件，1-5 = 合并表排序方式。 */
  strategy: number;
  /** `TableFieldTypeStrategy`：0 = 自动判断列类型，1 = 所有列作为文本。 */
  fieldStrategy: number;
  /** `TableReadStrategy`：0 = 仅读取当前目录，1 = 递归读取所有子目录。 */
  readStrategy: number;
  /** `TableAppendStrategy`：0 = 按字段顺序合并，1 = 按字段名称合并。 */
  appendStrategy: number;
  /** 相对分组目录的路径，Unix 分隔符、以 `/` 开头。 */
  relativeFilePath: string;
  headerRowNumber: number;
  /** `SheetSelectStrategy`：0 = 按序号，1 = 按名字，2 = 所有 sheet 合并。 */
  sheetStrategy: number;
  sheetNumber: number;
  sheetName: string;
  hasPassword: boolean;
}

/** 保存手动表时的输入：`password` 为 undefined 表示保持原密码，null / 空串表示清除。 */
export interface CloudConnectionTableInput extends Omit<CloudConnectionTableConfig, 'hasPassword'> {
  password?: string | null;
}

/** 分组里的一张表（手动表或自动扫描出的表）。 */
export interface CloudConnectionTableEntry {
  id: string;
  manual: boolean;
  fileName?: string;
  sheetName?: string;
}

/** 分组（对应 Java `LocalDatasourceBean`，分组名即 sourceName）。 */
export interface CloudConnectionGroup {
  id: string;
  sourceName: string;
  directoryPath: string;
  /** `LocalReadStrategy`：0 = 不自动读取，1 = 仅读取当前目录，2 = 递归读取所有子目录。 */
  strategy: number;
  tables: CloudConnectionTableConfig[];
  /** 早期版本逐个添加的文件（迁移保留，按自动表规则生成表）。 */
  files: string[];
  entries: CloudConnectionTableEntry[];
  entriesStatus: 'pending' | 'ready' | 'error';
  entriesError?: string;
}

export interface CloudConnectionGroupInput {
  sourceName: string;
  directoryPath: string;
  strategy: number;
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
