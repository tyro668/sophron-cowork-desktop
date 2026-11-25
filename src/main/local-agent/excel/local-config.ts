/**
 * 本地目录数据源（「分组」）与手动表的配置模型，对应 Java：
 *   - `LocalDatasourceBean`（type=local）：分组名 = sourceName，`directoryPath` 目录，
 *     `strategy` 自动读表策略（`LocalReadStrategy`），`tables` 手动表；
 *   - `ExcelTableBean`：手动表（UI 上带「手动」标签），字段与默认值逐一对应；
 *   - 各策略枚举的取值与 `config/bean/datasource/strategy/*.java` 一致。
 *
 * 与 Java 的唯一扩展：`files` —— 早期版本「逐个添加文件」的列表。为保证已有用户的表 id、
 * 上报内容完全不变，迁移后这些文件仍按自动表规则生成表（见 local-excel-source.ts）。
 */

/** `LocalReadStrategy`：分组的自动读表策略。 */
export const LocalReadStrategy = {
  NONE: 0,
  ONLY_CURRENT_DIRECTORY: 1,
  RECURSIVE_DIRECTORY: 2,
} as const;

/** `TableSourceStrategy`：0 = 单文件，其余为合并表的排序方式。 */
export const TableSourceStrategy = {
  SINGLE_FILE: 0,
  APPEND_BY_CREATE_TIME: 1,
  APPEND_BY_MODIFY_TIME: 2,
  APPEND_BY_FILE_NAME: 3,
  APPEND_BY_NATURAL_ORDER_FILE_NAME: 4,
  APPEND: 5,
} as const;

/** `TableFieldTypeStrategy`。 */
export const TableFieldTypeStrategy = { AUTO: 0, NONE: 1 } as const;
/** `TableReadStrategy`（合并表读取目录的方式）。 */
export const TableReadStrategy = { ONLY_CURRENT_DIRECTORY: 0, RECURSIVE_DIRECTORY: 1 } as const;
/** `TableAppendStrategy`：0 = 按字段顺序合并（IndexMerge），1 = 按字段名称合并（NameMerge）。 */
export const TableAppendStrategy = { INDEX: 0, NAME: 1 } as const;
/** `SheetSelectStrategy`。 */
export const SheetSelectStrategy = { INDEX: 0, NAME: 1, ALL: 2 } as const;

/** `ExcelTableBean`（手动表）。 */
export interface ExcelTableConfig {
  tableName: string;
  strategy: number;
  fieldStrategy: number;
  readStrategy: number;
  appendStrategy: number;
  /** 相对分组目录的路径（Unix 分隔符，开头带 `/`，与 Java getter 一致）。 */
  relativeFilePath: string;
  headerRowNumber: number;
  sheetStrategy: number;
  sheetNumber: number;
  sheetName: string;
  password?: string;
}

/** `LocalDatasourceBean`（分组）。 */
export interface LocalGroupConfig {
  /** 分组名，即上报给云端的 sourceName。 */
  sourceName: string;
  /** 绝对路径；早期迁移来的分组可能为空。 */
  directoryPath: string;
  strategy: number;
  tables: ExcelTableConfig[];
  /** 早期「逐个添加文件」的绝对路径列表（非 Java 字段）。 */
  files?: string[];
}

/** `ExcelTableBean` 字段默认值（Java 字段初始化 + agent-ui 新建表单的 initialValues）。 */
export const DEFAULT_EXCEL_TABLE: Omit<ExcelTableConfig, 'tableName' | 'relativeFilePath'> = {
  strategy: TableSourceStrategy.APPEND,
  fieldStrategy: TableFieldTypeStrategy.AUTO,
  readStrategy: TableReadStrategy.ONLY_CURRENT_DIRECTORY,
  appendStrategy: TableAppendStrategy.INDEX,
  headerRowNumber: 1,
  sheetStrategy: SheetSelectStrategy.INDEX,
  sheetNumber: 1,
  sheetName: 'Sheet1',
};

function toUnix(p: string): string {
  return p.replace(/\\/g, '/');
}

function intOr(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/** `ExcelTableBean.getRelativeFilePath`：Unix 分隔符，保证以 `/` 开头。 */
export function normalizeRelativeFilePath(p: string): string {
  const unix = toUnix(p ?? '');
  return unix.startsWith('/') ? unix : `/${unix}`;
}

/** 规范化一张手动表（getter 语义：表头行 / sheet 序号 < 1 时按 1 处理）。 */
export function normalizeExcelTable(input: Partial<ExcelTableConfig>): ExcelTableConfig {
  const header = intOr(input.headerRowNumber, 1);
  const sheetNumber = intOr(input.sheetNumber, 1);
  const table: ExcelTableConfig = {
    tableName: (input.tableName ?? '').trim(),
    strategy: intOr(input.strategy, DEFAULT_EXCEL_TABLE.strategy),
    fieldStrategy: intOr(input.fieldStrategy, DEFAULT_EXCEL_TABLE.fieldStrategy),
    readStrategy: intOr(input.readStrategy, DEFAULT_EXCEL_TABLE.readStrategy),
    appendStrategy: intOr(input.appendStrategy, DEFAULT_EXCEL_TABLE.appendStrategy),
    relativeFilePath: normalizeRelativeFilePath(input.relativeFilePath ?? ''),
    headerRowNumber: header < 1 ? 1 : header,
    sheetStrategy: intOr(input.sheetStrategy, DEFAULT_EXCEL_TABLE.sheetStrategy),
    sheetNumber: sheetNumber < 1 ? 1 : sheetNumber,
    sheetName: input.sheetName ? String(input.sheetName) : DEFAULT_EXCEL_TABLE.sheetName,
  };
  if (input.password) table.password = String(input.password);
  return table;
}

export function normalizeGroup(input: Partial<LocalGroupConfig>): LocalGroupConfig {
  const group: LocalGroupConfig = {
    sourceName: (input.sourceName ?? '').trim(),
    directoryPath: input.directoryPath ? toUnix(input.directoryPath) : '',
    strategy: intOr(input.strategy, LocalReadStrategy.ONLY_CURRENT_DIRECTORY),
    tables: (input.tables ?? []).map((t) => normalizeExcelTable(t)),
  };
  if (input.files && input.files.length > 0) group.files = [...input.files];
  return group;
}

/** 分组名校验（agent-ui FolderForm：必填、不能含 `&`、不能重复）。返回错误码。 */
export function validateGroupName(
  name: string,
  existing: string[]
): 'required' | 'ampersand' | 'duplicate' | null {
  const trimmed = name.trim();
  if (!trimmed) return 'required';
  if (trimmed.includes('&')) return 'ampersand';
  if (existing.includes(trimmed)) return 'duplicate';
  return null;
}

/** 手动表校验（ExcelTableForm：表名必填且组内不重复，文件路径必填）。 */
export function validateExcelTable(
  table: ExcelTableConfig,
  existingNames: string[]
): 'nameRequired' | 'nameDuplicate' | 'pathRequired' | null {
  if (!table.tableName) return 'nameRequired';
  if (existingNames.includes(table.tableName)) return 'nameDuplicate';
  if (!table.relativeFilePath || table.relativeFilePath === '/') {
    // 合并表允许选分组根目录本身（Java 里 relativeFilePath = "/" 合法），单文件必须是文件
    if (table.strategy === TableSourceStrategy.SINGLE_FILE) return 'pathRequired';
  }
  return null;
}

/** `ExcelTableBean.formatAbsolutePath`。 */
export function formatAbsolutePath(table: ExcelTableConfig, baseDir: string): string {
  const base = toUnix(baseDir).replace(/\/+$/, '');
  const rel = normalizeRelativeFilePath(table.relativeFilePath).substring(1);
  return rel ? `${base}/${rel}` : base;
}

/** `LocalTableManager.isWatchConfigChanged` 之外的整体比较（用于判断是否需要上报）。 */
export function sameTableConfig(a: ExcelTableConfig, b: ExcelTableConfig): boolean {
  return JSON.stringify(normalizeExcelTable(a)) === JSON.stringify(normalizeExcelTable(b));
}
