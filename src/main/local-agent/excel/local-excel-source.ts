/**
 * 本地 Excel / CSV 数据源，对应 Java `LocalClientProxy`（自动表模式）+ `ExcelMetaReader` /
 * `RowCountReader` / `TopNRowsReader` / `FullDataReader`。
 *
 * 与 Java 本地宝"配置一个目录、自动扫描文件"不同，这里由用户逐个添加文件；每个文件按
 * Java 自动表规则生成表：
 *   - 目录（directoryPath）= 文件所在目录，相对路径 = 文件名；
 *   - CSV：表 id = 文件名，sheetName 为空；
 *   - Excel：每个 sheet 一张表，id = `文件名_sheet名`；
 *   - 表 JSON（SourceTable）= `{ id, fileName, sheetName?, manual: false, type: 'excel' }`。
 */
import { stat } from 'node:fs/promises';
import * as path from 'node:path';

import {
  analyzeCells,
  createExcelMeta,
  createSkipMeta,
  fillEmpty,
  type AnalyzedTable,
  type ExcelMetaPayload,
} from './analyzer';
import type { AgentLocale } from './field-type';
import {
  csvSheetName,
  isCsvFile,
  openWorkbook,
  readCsvCells,
  type WorkbookHandle,
} from './table-reader';

/** `ProjectConstants.Excel.SEPARATOR`。 */
export const EXCEL_TABLE_ID_SEPARATOR = '_';
export const TOP_N_ROWS = 100;

export interface ExcelTableInfo {
  id: string;
  /** 相对 directoryPath 的路径（这里就是文件名）。 */
  fileName: string;
  /** Excel 的 sheet 名；CSV 为 undefined。 */
  sheetName?: string;
  manual: false;
  type: 'excel';
  filePath: string;
  directoryPath: string;
}

/** 发给云端的 SourceTable JSON（Jackson NON_NULL）。 */
export function toSourceTableJson(table: ExcelTableInfo): Record<string, unknown> {
  const json: Record<string, unknown> = {
    id: table.id,
    fileName: table.fileName,
    manual: table.manual,
    type: table.type,
  };
  if (table.sheetName !== undefined) json.sheetName = table.sheetName;
  return json;
}

/** `ExcelUtils.dirName`：目录名（文件在子目录时追加相对路径；这里文件总在目录根下）。 */
export function dirNameOf(filePath: string, directoryPath: string): string {
  const rel = path.relative(directoryPath, path.dirname(filePath)).split(path.sep).join('/');
  const base = path.basename(directoryPath) || directoryPath;
  return rel ? `${base}/${rel}` : base;
}

export interface UnchangedFile {
  fileName: string;
  modifyTime: number;
}

/** `ExcelVersionProvider`：记录每张表上次同步时的文件修改时间（假同步判断用）。 */
export interface ExcelVersionStore {
  get(tableId: string): UnchangedFile[] | undefined;
  put(tableId: string, files: UnchangedFile[]): void;
  delete(tableId: string): void;
}

export class MemoryExcelVersionStore implements ExcelVersionStore {
  private readonly map = new Map<string, UnchangedFile[]>();
  get(id: string) {
    return this.map.get(id);
  }
  put(id: string, files: UnchangedFile[]) {
    this.map.set(id, files);
  }
  delete(id: string) {
    this.map.delete(id);
  }
}

export interface SheetSummary {
  sheetName?: string;
  tableId: string;
  columns: string[];
  columnTypes: number[];
  rowCount: number;
  sampleRows: (string | null)[][];
}

export interface FileParseSummary {
  filePath: string;
  fileName: string;
  size: number;
  modifyTime: number;
  sheets: SheetSummary[];
  charset?: string;
  delimiter?: string;
}

export interface TableRows {
  analyzed: AnalyzedTable;
  /** 带系统字段的数据行。 */
  rows: string[][];
}

interface CachedFile {
  mtimeMs: number;
  size: number;
  workbook?: WorkbookHandle;
  csv?: { rows: AnalyzedTable; charset: string; delimiter: string };
  sheets: Map<string, AnalyzedTable>;
}

export interface LocalExcelSourceOptions {
  sourceName: string;
  files: string[];
  locale?: AgentLocale;
  versionStore?: ExcelVersionStore;
  maxColSize?: number;
}

export class LocalExcelSource {
  sourceName: string;
  private files: string[];
  private readonly locale: AgentLocale;
  readonly versionStore: ExcelVersionStore;
  private readonly cache = new Map<string, CachedFile>();
  private tables = new Map<string, ExcelTableInfo>();
  maxColSize?: number;

  constructor(options: LocalExcelSourceOptions) {
    this.sourceName = options.sourceName;
    this.files = [...options.files];
    this.locale = options.locale ?? 'zh';
    this.versionStore = options.versionStore ?? new MemoryExcelVersionStore();
    this.maxColSize = options.maxColSize;
  }

  get filePaths(): string[] {
    return [...this.files];
  }

  setFiles(files: string[]): void {
    this.files = [...files];
    for (const key of [...this.cache.keys()]) if (!files.includes(key)) this.cache.delete(key);
  }

  private async load(filePath: string): Promise<CachedFile> {
    const st = await stat(filePath);
    const hit = this.cache.get(filePath);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit;
    const entry: CachedFile = { mtimeMs: st.mtimeMs, size: st.size, sheets: new Map() };
    if (isCsvFile(filePath)) {
      const csv = await readCsvCells(filePath);
      entry.csv = {
        rows: analyzeCells(csv.rows, { locale: this.locale, maxColSize: this.maxColSize }),
        charset: csv.charset,
        delimiter: csv.delimiter,
      };
    } else {
      entry.workbook = await openWorkbook(filePath);
    }
    this.cache.set(filePath, entry);
    return entry;
  }

  private analyzed(entry: CachedFile, sheetName?: string): AnalyzedTable {
    if (entry.csv) return entry.csv.rows;
    const name = sheetName ?? '';
    let hit = entry.sheets.get(name);
    if (!hit) {
      hit = analyzeCells(entry.workbook!.readSheet(name), {
        locale: this.locale,
        maxColSize: this.maxColSize,
      });
      entry.sheets.set(name, hit);
    }
    return hit;
  }

  /** `LocalTableId.createTables`：按文件生成表。读失败的文件跳过（记录在 errors）。 */
  async listTables(errors?: Map<string, string>): Promise<ExcelTableInfo[]> {
    const tables: ExcelTableInfo[] = [];
    for (const filePath of this.files) {
      const directoryPath = path.dirname(filePath);
      const fileName = path.basename(filePath);
      try {
        if (isCsvFile(filePath)) {
          await stat(filePath);
          tables.push({
            id: fileName,
            fileName,
            manual: false,
            type: 'excel',
            filePath,
            directoryPath,
          });
        } else {
          const entry = await this.load(filePath);
          for (const sheetName of entry.workbook!.sheetNames) {
            tables.push({
              id: `${fileName}${EXCEL_TABLE_ID_SEPARATOR}${sheetName}`,
              fileName,
              sheetName,
              manual: false,
              type: 'excel',
              filePath,
              directoryPath,
            });
          }
        }
      } catch (error) {
        errors?.set(filePath, error instanceof Error ? error.message : String(error));
      }
    }
    this.tables = new Map(tables.map((t) => [t.id, t]));
    return tables;
  }

  async getTable(tableId: string): Promise<ExcelTableInfo | undefined> {
    if (!this.tables.has(tableId)) await this.listTables();
    return this.tables.get(tableId);
  }

  private systemValues(table: ExcelTableInfo): [string, string, string] {
    return [
      dirNameOf(table.filePath, table.directoryPath),
      path.basename(table.filePath),
      table.sheetName ?? csvSheetName(table.filePath),
    ];
  }

  async readTable(table: ExcelTableInfo): Promise<TableRows> {
    const entry = await this.load(table.filePath);
    const analyzed = this.analyzed(entry, table.sheetName);
    if (analyzed.head.length === 0) throw new Error(`table ${table.id} is empty`);
    const sys = this.systemValues(table);
    return { analyzed, rows: analyzed.rows.map((r) => [...r, ...sys]) };
  }

  async queryMeta(table: ExcelTableInfo, messageId?: string): Promise<ExcelMetaPayload> {
    const { analyzed } = await this.readTable(table);
    return createExcelMeta(analyzed.head, messageId, this.locale);
  }

  /** `ExcelMetaReader.read`：update && !forceOverwrite 且文件未变化时返回 skipSync 元数据。 */
  async queryStructure(
    table: ExcelTableInfo,
    fetchBean: { update?: boolean; forceOverwrite?: boolean },
    messageId?: string
  ): Promise<ExcelMetaPayload> {
    if (fetchBean.update && !fetchBean.forceOverwrite && (await this.isUnchanged(table))) {
      return createSkipMeta(messageId);
    }
    return this.queryMeta(table, messageId);
  }

  async isUnchanged(table: ExcelTableInfo): Promise<boolean> {
    const old = this.versionStore.get(table.id);
    if (!old) return false;
    const now = await this.currentFiles(table);
    return (
      old.length === now.length &&
      old.every((f, i) => f.fileName === now[i].fileName && f.modifyTime === now[i].modifyTime)
    );
  }

  private async currentFiles(table: ExcelTableInfo): Promise<UnchangedFile[]> {
    const st = await stat(table.filePath);
    return [
      {
        fileName: path.join(table.directoryPath, table.fileName).split(path.sep).join('/'),
        modifyTime: Math.trunc(st.mtimeMs),
      },
    ];
  }

  /** `RowCountReader`：非空数据行数。 */
  async rowCount(table: ExcelTableInfo): Promise<number> {
    const { analyzed } = await this.readTable(table);
    return analyzed.rows.length;
  }

  /** `TopNRowsReader`：元数据 + 前 100 行（带系统字段、按表头长度 fillEmpty）。 */
  async topRows(
    table: ExcelTableInfo,
    messageId?: string,
    limit = TOP_N_ROWS
  ): Promise<{ meta: ExcelMetaPayload; rows: (string | null)[][] }> {
    const { analyzed, rows } = await this.readTable(table);
    const meta = createExcelMeta(analyzed.head, messageId, this.locale);
    const size = meta.tableColumns!.length;
    return { meta, rows: rows.slice(0, limit).map((r) => fillEmpty(r, size)) };
  }

  /**
   * `FullDataReader`（自动表 → OVERWRITE）：按 `tableMeta` 的列数补齐 / 截断后逐行写出，
   * 成功后记录文件版本。
   */
  async writeFullData(
    table: ExcelTableInfo,
    headerSize: number,
    writeRow: (row: (string | null)[]) => Promise<void>
  ): Promise<number> {
    const files = await this.currentFiles(table);
    const { rows } = await this.readTable(table);
    for (const row of rows) await writeRow(fillEmpty(row, headerSize));
    this.versionStore.put(table.id, files);
    return rows.length;
  }

  /** 给 UI 用的解析概要：每个 sheet 的列、类型、行数和前几行。 */
  async summarize(filePath: string, sampleSize = 20): Promise<FileParseSummary> {
    const entry = await this.load(filePath);
    const fileName = path.basename(filePath);
    const directoryPath = path.dirname(filePath);
    const sheetNames = entry.csv ? [undefined] : entry.workbook!.sheetNames;
    const sheets: SheetSummary[] = [];
    for (const sheetName of sheetNames) {
      const table: ExcelTableInfo = {
        id:
          sheetName === undefined ? fileName : `${fileName}${EXCEL_TABLE_ID_SEPARATOR}${sheetName}`,
        fileName,
        sheetName,
        manual: false,
        type: 'excel',
        filePath,
        directoryPath,
      };
      const analyzed = this.analyzed(entry, sheetName);
      if (analyzed.head.length === 0) {
        sheets.push({
          sheetName,
          tableId: table.id,
          columns: [],
          columnTypes: [],
          rowCount: 0,
          sampleRows: [],
        });
        continue;
      }
      const top = await this.topRows(table, undefined, sampleSize);
      sheets.push({
        sheetName,
        tableId: table.id,
        columns: top.meta.tableColumns ?? [],
        columnTypes: top.meta.tableColumnTypes ?? [],
        rowCount: analyzed.rows.length,
        sampleRows: top.rows,
      });
    }
    return {
      filePath,
      fileName,
      size: entry.size,
      modifyTime: Math.trunc(entry.mtimeMs),
      sheets,
      charset: entry.csv?.charset,
      delimiter: entry.csv?.delimiter,
    };
  }
}
