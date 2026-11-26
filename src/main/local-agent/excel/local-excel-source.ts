/**
 * 本地目录数据源（一个「分组」），对应 Java `LocalClientProxy` + `LocalTableManager` +
 * `ExcelMetaReader` / `RowCountReader` / `TopNRowsReader` / `FullDataReader`。
 *
 * 表的来源（与 Java 一致，手动表在前、按添加顺序；自动表按 id 排序）：
 *   - 手动表（`ExcelTableBean`）：id = 表名，单文件或合并表（目录下多个文件按策略排序后
 *     追加），可配置 sheet 选择、表头行、列类型策略、文件密码；上报 JSON 为
 *     `{ id, manual: true, type: 'excel' }`；
 *   - 自动表（`LocalFileNameVisitor`）：分组目录下的文件，CSV id = 相对路径，Excel 每个
 *     sheet 一张表，id = `相对路径_sheet名`；上报 JSON 为 `{ id, fileName, sheetName?, manual:
 *     false, type: 'excel' }`；
 *   - 早期版本逐个添加的文件（`files`，非 Java 字段）：按自动表规则，目录 = 文件所在目录，
 *     保证迁移前后表 id 与上报内容不变。
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
import { FieldType, type AgentLocale, type CellData } from './field-type';
import {
  LocalReadStrategy,
  SheetSelectStrategy,
  TableFieldTypeStrategy,
  normalizeExcelTable,
  type ExcelTableConfig,
} from './local-config';
import { getNoEmptyTableFiles, scanAutoTableFiles, type LocalFileVersion } from './local-files';
import { createAppender } from './merge';
import { javaCompare } from './natural-order';
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
/** `AgentEnv.maxHeadSize()` 默认值：合并表最多参与表头合并的文件数。 */
export const MAX_HEAD_FILES = 100;

export interface ExcelTableInfo {
  id: string;
  /** 自动表：相对目录的路径；手动表为 undefined（Java ExcelTable(bean) 不设置）。 */
  fileName?: string;
  /** 自动表 Excel 的 sheet 名；CSV / 手动表为 undefined。 */
  sheetName?: string;
  manual: boolean;
  type: 'excel';
  /** 自动表的文件绝对路径。 */
  filePath?: string;
  directoryPath: string;
  /** 手动表配置。 */
  config?: ExcelTableConfig;
  sortIndex?: number;
}

/** 发给云端的 SourceTable JSON（Jackson NON_NULL）。 */
export function toSourceTableJson(table: ExcelTableInfo): Record<string, unknown> {
  const json: Record<string, unknown> = { id: table.id };
  if (table.fileName !== undefined) json.fileName = table.fileName;
  json.manual = table.manual;
  json.type = table.type;
  if (table.sheetName !== undefined) json.sheetName = table.sheetName;
  return json;
}

/** `ExcelUtils.dirName`：目录名（文件在子目录时追加相对路径）。 */
export function dirNameOf(filePath: string, directoryPath: string): string {
  const rel = path.relative(directoryPath, path.dirname(filePath)).split(path.sep).join('/');
  const base = path.basename(directoryPath) || directoryPath;
  return rel ? `${base}/${rel}` : base;
}

/** `EmptyDataException` 文案。 */
export function emptyDataMessage(id: string): string {
  return `文件 [${id}] 的数据为空，可能的原因有: sheet数据为空或不存在; 表头行超过数据总行数`;
}

/** `ColSizeOverException` 文案。 */
export function colSizeOverMessage(size: number): string {
  return `列数超过${size}, 请检查数据或配置`;
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
  /** 合并后的业务列（不含系统字段）。 */
  head: CellData[];
  /** 带系统字段的数据行。 */
  rows: (string | null)[][];
}

/** `ExcelReadItem`。 */
interface ReadItem {
  filePath: string;
  sheetNo?: number;
  sheetName?: string;
  headIndex: number;
  password?: string;
}

interface CachedFile {
  mtimeMs: number;
  size: number;
  workbook?: WorkbookHandle;
  csv?: { cells: CellData[][]; charset: string; delimiter: string };
  analyzed: Map<string, AnalyzedTable>;
}

export interface LocalExcelSourceOptions {
  sourceName: string;
  /** 早期逐个添加的文件（自动表规则）。 */
  files?: string[];
  /** 分组目录（绝对路径）。 */
  directoryPath?: string;
  /** `LocalReadStrategy`，默认「仅读取当前目录」。 */
  strategy?: number;
  /** 手动表。 */
  tables?: ExcelTableConfig[];
  locale?: AgentLocale;
  versionStore?: ExcelVersionStore;
  maxColSize?: number;
}

export class LocalExcelSource {
  sourceName: string;
  private files: string[];
  directoryPath: string;
  strategy: number;
  private manualTables: ExcelTableConfig[];
  private readonly locale: AgentLocale;
  readonly versionStore: ExcelVersionStore;
  private readonly cache = new Map<string, CachedFile>();
  private tables = new Map<string, ExcelTableInfo>();
  maxColSize?: number;

  constructor(options: LocalExcelSourceOptions) {
    this.sourceName = options.sourceName;
    this.files = [...(options.files ?? [])];
    this.directoryPath = options.directoryPath ?? '';
    this.strategy = options.strategy ?? LocalReadStrategy.ONLY_CURRENT_DIRECTORY;
    this.manualTables = (options.tables ?? []).map((t) => normalizeExcelTable(t));
    this.locale = options.locale ?? 'zh';
    this.versionStore = options.versionStore ?? new MemoryExcelVersionStore();
    this.maxColSize = options.maxColSize;
  }

  get filePaths(): string[] {
    return [...this.files];
  }

  get manualTableConfigs(): ExcelTableConfig[] {
    return this.manualTables.map((t) => ({ ...t }));
  }

  setFiles(files: string[]): void {
    this.files = [...files];
    this.cache.clear();
  }

  /** 更新分组配置（目录 / 自动读表策略 / 手动表）。 */
  configure(options: { directoryPath?: string; strategy?: number; tables?: ExcelTableConfig[] }) {
    if (options.directoryPath !== undefined) this.directoryPath = options.directoryPath;
    if (options.strategy !== undefined) this.strategy = options.strategy;
    if (options.tables !== undefined) {
      this.manualTables = options.tables.map((t) => normalizeExcelTable(t));
    }
    this.cache.clear();
    this.tables.clear();
  }

  // ------------------------------------------------------------------ loading

  private async load(filePath: string, password?: string): Promise<CachedFile> {
    const st = await stat(filePath);
    const key = `${filePath}\u0000${password ?? ''}`;
    const hit = this.cache.get(key);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit;
    const entry: CachedFile = { mtimeMs: st.mtimeMs, size: st.size, analyzed: new Map() };
    if (isCsvFile(filePath)) {
      const csv = await readCsvCells(filePath);
      entry.csv = { cells: csv.rows, charset: csv.charset, delimiter: csv.delimiter };
    } else {
      entry.workbook = await openWorkbook(filePath, password);
    }
    this.cache.set(key, entry);
    return entry;
  }

  /** 读取一个 ReadItem，返回解析结果和系统字段里的 sheet 名。 */
  private async readItem(
    item: ReadItem,
    allText: boolean
  ): Promise<{ analyzed: AnalyzedTable; sheetName: string }> {
    const entry = await this.load(item.filePath, item.password);
    let sheet: string | undefined;
    let cells: CellData[][];
    if (entry.csv) {
      sheet = csvSheetName(item.filePath);
      cells = entry.csv.cells;
    } else {
      const names = entry.workbook!.sheetNames;
      if (item.sheetName !== undefined)
        sheet = names.includes(item.sheetName) ? item.sheetName : undefined;
      else sheet = names[item.sheetNo ?? 0];
      if (sheet === undefined) return { analyzed: { head: [], rows: [] }, sheetName: '' };
      cells = [];
    }
    const key = `${sheet}\u0000${item.headIndex}\u0000${allText ? 1 : 0}`;
    let analyzed = entry.analyzed.get(key);
    if (!analyzed) {
      analyzed = analyzeCells(entry.csv ? cells : entry.workbook!.readSheet(sheet), {
        locale: this.locale,
        maxColSize: this.maxColSize,
        headIndex: item.headIndex,
        allText,
      });
      entry.analyzed.set(key, analyzed);
    }
    return { analyzed, sheetName: sheet };
  }

  // ------------------------------------------------------------------ tables

  private manualInfo(config: ExcelTableConfig, sortIndex: number): ExcelTableInfo {
    return {
      id: config.tableName,
      manual: true,
      type: 'excel',
      directoryPath: this.directoryPath,
      config,
      sortIndex,
    };
  }

  /** 用表单里的草稿配置构造一张手动表（预览用，不加入表列表）。 */
  draftTable(config: Partial<ExcelTableConfig>): ExcelTableInfo {
    return this.manualInfo(normalizeExcelTable(config), -1);
  }

  private async autoTablesOf(
    filePath: string,
    relativePath: string,
    directoryPath: string
  ): Promise<ExcelTableInfo[]> {
    if (isCsvFile(filePath)) {
      await stat(filePath);
      return [
        {
          id: relativePath,
          fileName: relativePath,
          manual: false,
          type: 'excel',
          filePath,
          directoryPath,
        },
      ];
    }
    const entry = await this.load(filePath);
    return entry.workbook!.sheetNames.map((sheetName) => ({
      id: `${relativePath}${EXCEL_TABLE_ID_SEPARATOR}${sheetName}`,
      fileName: relativePath,
      sheetName,
      manual: false,
      type: 'excel' as const,
      filePath,
      directoryPath,
    }));
  }

  /**
   * `fetchAllTables` → `LocalTableManager.getSortedTables`：手动表在前（按添加顺序），
   * 自动表按 id 排序；id 重复时保留先出现的（手动表优先）。读失败的文件跳过（记录在 errors）。
   */
  async listTables(errors?: Map<string, string>): Promise<ExcelTableInfo[]> {
    const manual = this.manualTables.map((c, i) => this.manualInfo(c, i));
    const auto: ExcelTableInfo[] = [];
    if (this.directoryPath && this.strategy !== LocalReadStrategy.NONE) {
      const found = await scanAutoTableFiles(this.directoryPath, this.strategy, this.manualTables);
      for (const f of found) {
        try {
          auto.push(...(await this.autoTablesOf(f.filePath, f.relativePath, this.directoryPath)));
        } catch (error) {
          // Java ExcelUtils.sheets 读失败返回空列表：该文件不产生表
          errors?.set(f.filePath, error instanceof Error ? error.message : String(error));
        }
      }
    }
    auto.sort((a, b) => javaCompare(a.id, b.id));
    // 早期逐个添加的文件保持添加顺序（迁移前后上报顺序不变）
    for (const filePath of this.files) {
      try {
        auto.push(
          ...(await this.autoTablesOf(filePath, path.basename(filePath), path.dirname(filePath)))
        );
      } catch (error) {
        errors?.set(filePath, error instanceof Error ? error.message : String(error));
      }
    }
    const map = new Map<string, ExcelTableInfo>();
    for (const t of [...manual, ...auto]) if (!map.has(t.id)) map.set(t.id, t);
    this.tables = map;
    return [...map.values()];
  }

  async getTable(tableId: string): Promise<ExcelTableInfo | undefined> {
    if (!this.tables.has(tableId)) await this.listTables();
    return this.tables.get(tableId);
  }

  // ------------------------------------------------------------------ read items

  /** `AbstractExcelTableReader.readItemsIterator` + `ReadItemsIterator`。 */
  private async readItems(table: ExcelTableInfo, files?: LocalFileVersion[]): Promise<ReadItem[]> {
    if (!table.manual) {
      return [{ filePath: table.filePath!, sheetName: table.sheetName, headIndex: 0 }];
    }
    const config = table.config!;
    const list = files ?? (await getNoEmptyTableFiles(table.directoryPath, config));
    const items: ReadItem[] = [];
    const headIndex = config.headerRowNumber - 1;
    const password = config.password || undefined;
    for (const f of list) {
      const base = { filePath: f.fileName, headIndex, password };
      if (config.sheetStrategy === SheetSelectStrategy.INDEX) {
        items.push({ ...base, sheetNo: config.sheetNumber - 1 });
      } else if (config.sheetStrategy === SheetSelectStrategy.NAME) {
        items.push({ ...base, sheetName: config.sheetName });
      } else if (isCsvFile(f.fileName)) {
        items.push({ ...base, sheetNo: 0 });
      } else {
        // ExcelUtils.sheets(file, password)：读失败直接抛错（不像单个 item 那样可跳过）
        let sheetNames: string[];
        try {
          sheetNames = (await this.load(f.fileName, password)).workbook!.sheetNames;
        } catch (error) {
          throw new Error(
            `read sheets failed, file is ${f.fileName}: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error }
          );
        }
        sheetNames.forEach((_n, i) => items.push({ ...base, sheetNo: i }));
      }
    }
    return items;
  }

  /**
   * `ExcelReadException.throwException`：sheetName 为空的 item（按序号 / 全部 sheet、CSV）
   * 读失败时忽略，按名字选 sheet 时抛出。
   */
  private static rethrowUnlessSkippable(item: ReadItem, error: unknown): void {
    if (item.sheetName === undefined) return;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `excel read error: ${message}, readItem file: ${item.filePath}, sheetName: ${item.sheetName}, sheetNum: ${item.sheetNo ?? 'null'}`
    );
  }

  private systemValues(item: ReadItem, sheetName: string, table: ExcelTableInfo) {
    return [
      dirNameOf(item.filePath, table.directoryPath),
      path.basename(item.filePath),
      sheetName,
    ] as [string, string, string];
  }

  /**
   * 合并读取（`ExcelFieldsHook` + appender）。`maxRows` 限制返回行数（预览）；
   * `headOnly` 只读表头（元数据）；`fixedHead` 为同步时的表头（tableMeta 业务列）。
   */
  private async readMerged(
    table: ExcelTableInfo,
    options: {
      maxRows?: number;
      headOnly?: boolean;
      fixedHead?: string[];
      files?: LocalFileVersion[];
    } = {}
  ): Promise<TableRows> {
    const items = await this.readItems(table, options.files);
    const config = table.config;
    const allText = Boolean(config && config.fieldStrategy === TableFieldTypeStrategy.NONE);
    const appender = createAppender(config?.appendStrategy ?? 0, table.manual);
    let result: CellData[] | null = options.fixedHead
      ? options.fixedHead.map((name): CellData => ({ data: name, type: FieldType.STRING }))
      : null;
    const freezeAll = Boolean(options.fixedHead);
    const rows: (string | null)[][] = [];
    let headFiles = 0;
    const limit = options.maxRows ?? Number.POSITIVE_INFINITY;
    for (const item of items) {
      if (options.headOnly && headFiles >= MAX_HEAD_FILES) break;
      let read: { analyzed: AnalyzedTable; sheetName: string };
      try {
        read = await this.readItem(item, allText);
      } catch (error) {
        LocalExcelSource.rethrowUnlessSkippable(item, error);
        continue;
      }
      const { analyzed, sheetName } = read;
      if (!freezeAll && headFiles < MAX_HEAD_FILES) {
        if (analyzed.head.length > 0 || result === null) {
          result = appender.appendHeaderNames(result, analyzed.head);
          result = appender.appendHeaderTypes(result, analyzed.head);
          if (this.maxColSize && result.length > this.maxColSize) {
            throw new Error(colSizeOverMessage(this.maxColSize));
          }
        }
        headFiles++;
      }
      if (!options.headOnly && rows.length < limit) {
        const sys = this.systemValues(item, sheetName, table);
        for (const r of analyzed.rows) {
          if (rows.length >= limit) break;
          rows.push(appender.appendRow(result, analyzed.head, r, sys));
        }
      }
      if (rows.length >= limit && headFiles >= MAX_HEAD_FILES) break;
    }
    return { head: result ?? [], rows };
  }

  async readTable(table: ExcelTableInfo): Promise<TableRows> {
    const merged = await this.readMerged(table);
    if (merged.head.length === 0) throw new Error(emptyDataMessage(table.id));
    return merged;
  }

  async queryMeta(table: ExcelTableInfo, messageId?: string): Promise<ExcelMetaPayload> {
    const { head } = await this.readMerged(table, { headOnly: true });
    if (head.length === 0) throw new Error(emptyDataMessage(table.id));
    return createExcelMeta(head, messageId, this.locale);
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
    if (table.manual) {
      const files = await getNoEmptyTableFiles(table.directoryPath, table.config!);
      return files.map((f) => ({ fileName: f.fileName, modifyTime: f.modifyTime }));
    }
    const st = await stat(table.filePath!);
    return [
      {
        fileName: path.join(table.directoryPath, table.fileName!).split(path.sep).join('/'),
        modifyTime: Math.trunc(st.mtimeMs),
      },
    ];
  }

  /** `RowCountReader`：各文件非空数据行数之和（读失败按 ExcelReadException 规则处理）。 */
  async rowCount(table: ExcelTableInfo): Promise<number> {
    let total = 0;
    for (const item of await this.readItems(table)) {
      try {
        total += (await this.readItem(item, false)).analyzed.rows.length;
      } catch (error) {
        LocalExcelSource.rethrowUnlessSkippable(item, error);
      }
    }
    return total;
  }

  /** `TopNRowsReader`：元数据 + 前 100 行（带系统字段、按表头长度 fillEmpty）。 */
  async topRows(
    table: ExcelTableInfo,
    messageId?: string,
    limit = TOP_N_ROWS
  ): Promise<{ meta: ExcelMetaPayload; rows: (string | null)[][] }> {
    const { head, rows } = await this.readMerged(table, { maxRows: limit });
    if (head.length === 0) throw new Error(emptyDataMessage(table.id));
    const meta = createExcelMeta(head, messageId, this.locale);
    const size = meta.tableColumns!.length;
    return { meta, rows: rows.map((r) => fillEmpty(r, size)) };
  }

  /**
   * `FullDataReader`（OVERWRITE）：按 `tableMeta` 的列补齐 / 截断后逐行写出，成功后记录文件版本。
   * `header` 为 tableMeta 的列名（含 3 个系统字段）或列数。
   */
  async writeFullData(
    table: ExcelTableInfo,
    header: number | string[],
    writeRow: (row: (string | null)[]) => Promise<void>
  ): Promise<number> {
    const headerSize = typeof header === 'number' ? header : header.length;
    const files = await this.currentFiles(table);
    const fixedHead =
      table.manual && Array.isArray(header) && table.config?.appendStrategy === 1
        ? header.slice(0, Math.max(0, header.length - 3))
        : undefined;
    const manualFiles = table.manual
      ? files.map((f) => ({ fileName: f.fileName, modifyTime: f.modifyTime }))
      : undefined;
    const { head, rows } = await this.readMerged(table, { fixedHead, files: manualFiles });
    if (head.length === 0 && !fixedHead) throw new Error(emptyDataMessage(table.id));
    for (const row of rows) await writeRow(fillEmpty(row, headerSize));
    this.versionStore.put(table.id, files);
    return rows.length;
  }

  /** 给 UI 用的表预览：列、类型、行数和前几行。 */
  async previewTable(
    table: ExcelTableInfo,
    sampleSize = 50
  ): Promise<{
    columns: string[];
    columnTypes: number[];
    rowCount: number;
    rows: (string | null)[][];
  }> {
    const top = await this.topRows(table, undefined, sampleSize);
    return {
      columns: top.meta.tableColumns ?? [],
      columnTypes: top.meta.tableColumnTypes ?? [],
      rowCount: await this.rowCount(table),
      rows: top.rows,
    };
  }

  /** 给 UI 用的解析概要（早期逐个添加的文件）：每个 sheet 的列、类型、行数和前几行。 */
  async summarize(filePath: string, sampleSize = 20): Promise<FileParseSummary> {
    const entry = await this.load(filePath);
    const fileName = path.basename(filePath);
    const directoryPath = path.dirname(filePath);
    const tables = await this.autoTablesOf(filePath, fileName, directoryPath);
    const sheets: SheetSummary[] = [];
    for (const table of tables) {
      const { analyzed } = await this.readItem(
        { filePath, sheetName: table.sheetName, headIndex: 0 },
        false
      );
      if (analyzed.head.length === 0) {
        sheets.push({
          sheetName: table.sheetName,
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
        sheetName: table.sheetName,
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
