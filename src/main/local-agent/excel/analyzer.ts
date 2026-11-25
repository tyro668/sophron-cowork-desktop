/**
 * 表头 / 类型 / 数据行处理，对应 hihidata-excel `AbstractExcelAnalyzer`（removeBlankColumn、
 * expandHeader、inferHeadTypes、fixHeader）+ `ExcelReader.toDataInfo` + agent 端
 * `ExcelFieldsHook`（全空列置 INFER、YEAR_MONTH_DAY 合并为 DATE、追加 3 个系统字段）
 * 与 `ExcelMeta.createMeta`。
 */
import {
  ExcelFieldTypeParser,
  FieldType,
  getTreatedFieldNames,
  speType,
  type AgentLocale,
  type CellData,
} from './field-type';

export const INFER_SIZE = 100;
export const SYSTEM_COLS_COUNT = 3;

export const SYSTEM_FIELD_NAMES: Record<AgentLocale, [string, string, string]> = {
  zh: ['文件夹名(系统字段)', '表名(系统字段)', 'sheet名(系统字段)'],
  en: ['Folder name (system field)', 'Table name (system field)', 'Sheet name (system field)'],
};

export interface SystemValues {
  dirName: string;
  fileName: string;
  sheetName: string;
}

export interface AnalyzedTable {
  /** 业务列（不含系统字段），类型已经过 hook 处理。 */
  head: CellData[];
  /** 数据行（已去空行、去空列、按表头补齐/截断，不含系统字段）。 */
  rows: string[][];
}

function isBlankRow(row: CellData[]): boolean {
  return !row.some((c) => c && c.data);
}

/** `ExcelUtils.getMaxColumnSize`：前 100 个非空行的最大列数。 */
export function getMaxColumnSize(rows: CellData[][]): number {
  let max = 0;
  let seen = 0;
  for (const row of rows) {
    if (isBlankRow(row)) continue;
    max = Math.max(max, row.length);
    if (++seen >= 100) break;
  }
  return max;
}

export function getBlankColumnIndex(rows: CellData[][], compSize = INFER_SIZE): Set<number> {
  const maxColumnSize = getMaxColumnSize(rows);
  const maxRowSize = Math.min(compSize, rows.length);
  const blank = new Set<number>();
  for (let i = 0; i < maxColumnSize; i++) {
    let isBlank = true;
    for (let j = 0; j < maxRowSize; j++) {
      const row = rows[j];
      if (i < row.length && row[i] && row[i].data) {
        isBlank = false;
        break;
      }
    }
    if (isBlank) blank.add(i);
  }
  return blank;
}

function removeColumns(row: CellData[], blank: Set<number>): CellData[] {
  return blank.size === 0 ? row : row.filter((_c, i) => !blank.has(i));
}

function expandHeader(rows: CellData[][]): CellData[] {
  const header = rows[0];
  if (rows.length > 1) {
    const real = getMaxColumnSize(rows);
    if (header.length < real) {
      const expanded = header.slice();
      for (let i = header.length; i < real; i++) expanded.push({ data: '', type: FieldType.INFER });
      return expanded;
    }
  }
  return header;
}

/**
 * 解析一个工作表（或 CSV）的单元格矩阵。`rows[0]` 为表头行。
 * `inferLimit` 为类型推断取样的数据行数（Java page(100) → 100）。
 */
export function analyzeCells(
  input: CellData[][],
  options: { locale?: AgentLocale; inferLimit?: number; maxColSize?: number } = {}
): AnalyzedTable {
  const locale = options.locale ?? 'zh';
  if (input.length === 0) return { head: [], rows: [] };
  // filterBodyEmpty：保留表头，去掉全空的数据行
  let list: CellData[][] = [input[0], ...input.slice(1).filter((r) => !isBlankRow(r))];
  const blank = getBlankColumnIndex(list, INFER_SIZE);
  if (blank.size > 0) {
    list = list.map((r) => removeColumns(r, blank));
    list = [list[0], ...list.slice(1).filter((r) => !isBlankRow(r))];
  }
  const headerCells = expandHeader(list);
  const data = list.slice(1);
  const inferLimit = options.inferLimit ?? INFER_SIZE;
  const types = new ExcelFieldTypeParser(headerCells.length, Math.min(inferLimit, data.length))
    .addData(data)
    .getResult();
  const names = getTreatedFieldNames(
    headerCells.map((c) => c?.data ?? ''),
    locale
  );
  const head: CellData[] = headerCells.map((_c, i) => ({ data: names[i], type: types[i] }));
  if (options.maxColSize && head.length > options.maxColSize) {
    throw new Error(`列数超过上限 ${options.maxColSize}`);
  }
  // ExcelFieldsHook.filterHead：样本内全空的列置 INFER；appendHeaderTypes：YEAR_MONTH_DAY → DATE
  const sample = data.slice(0, inferLimit);
  for (let i = 0; i < head.length; i++) {
    const allEmpty = sample.every((r) => !(r[i] && r[i].data));
    if (allEmpty) head[i].type = FieldType.INFER;
    if (head[i].type === FieldType.YEAR_MONTH_DAY) head[i].type = FieldType.DATE;
  }
  const width = head.length;
  const rows = data.map((r) => {
    const out = new Array<string>(width);
    for (let i = 0; i < width; i++) out[i] = r[i]?.data ?? '';
    return out;
  });
  return { head, rows };
}

export interface ExcelMetaPayload {
  messageId?: string;
  error: boolean;
  hasNext: boolean;
  tableColumns?: string[];
  tableColumnTypes?: number[];
  tableColumnComments?: string[];
  skipSync: boolean;
}

/** `ExcelMeta.createMeta(head + 系统字段)`。 */
export function createExcelMeta(
  head: CellData[],
  messageId: string | undefined,
  locale: AgentLocale = 'zh'
): ExcelMetaPayload {
  const full = [
    ...head,
    ...SYSTEM_FIELD_NAMES[locale].map((name) => ({ data: name, type: FieldType.STRING })),
  ];
  return {
    messageId,
    error: false,
    hasNext: false,
    tableColumns: getTreatedFieldNames(
      full.map((c) => c.data),
      locale
    ),
    tableColumnTypes: full.map((c) => speType(c.type)),
    skipSync: false,
  };
}

export function createSkipMeta(messageId: string | undefined): ExcelMetaPayload {
  return { messageId, error: false, hasNext: false, skipSync: true };
}

/** `AbstractExcelTableReader.fillEmpty`：业务列不足补 null、超出截断，系统字段保持在末尾。 */
export function fillEmpty(row: (string | null)[], headerSize: number): (string | null)[] {
  if (row.length === headerSize) return row;
  const out = new Array<string | null>(headerSize).fill(null);
  const notSystem = Math.min(row.length - SYSTEM_COLS_COUNT, headerSize - SYSTEM_COLS_COUNT);
  for (let i = 0; i < notSystem; i++) out[i] = row[i];
  for (let k = 0; k < SYSTEM_COLS_COUNT; k++) {
    out[headerSize - SYSTEM_COLS_COUNT + k] = row[row.length - SYSTEM_COLS_COUNT + k];
  }
  return out;
}
