/**
 * 把 schema v2 的 ExcelTableBean / 自动表扫描结果转成原始表导入输入。
 */
import { extname, isAbsolute, resolve } from 'node:path';

import type {
  DataImportRawTableInput,
  DataRawTableExcelConfig,
  DataRawTableFolderConfig,
  LegacyCloudConnectionTableConfig,
} from '../../../shared/contracts';
import {
  SheetSelectStrategy,
  TableAppendStrategy,
  TableFieldTypeStrategy,
  TableReadStrategy,
  TableSourceStrategy,
  formatAbsolutePath,
  normalizeExcelTable,
  type ExcelTableConfig,
} from '../../local-agent/excel/local-config';
import { getWorkbookSheetNames } from '../../data/store/input-source';
import { EXCEL_TABLE_ID_SEPARATOR } from '../../local-agent/excel/local-excel-source';
import { isJavaCsv, isJavaExcel, scanAutoTableFiles } from '../../local-agent/excel/local-files';

export type SortBy = NonNullable<DataRawTableFolderConfig['sortBy']>;

export function sortByFromStrategy(strategy: number): SortBy {
  if (strategy === TableSourceStrategy.APPEND_BY_NATURAL_ORDER_FILE_NAME) return 'natural';
  if (strategy === TableSourceStrategy.APPEND_BY_MODIFY_TIME) return 'mtime';
  if (strategy === TableSourceStrategy.APPEND_BY_CREATE_TIME) return 'ctime';
  if (
    strategy === TableSourceStrategy.APPEND_BY_FILE_NAME ||
    strategy === TableSourceStrategy.APPEND
  ) {
    return 'name';
  }
  return 'name';
}

export function toExcelTableConfig(input: LegacyCloudConnectionTableConfig): ExcelTableConfig {
  return normalizeExcelTable(input);
}

export function resolveLegacyTablePath(directoryPath: string, relativeFilePath: string): string {
  const table = normalizeExcelTable({ relativeFilePath, tableName: 'x' });
  const absolute = formatAbsolutePath(table, directoryPath);
  return isAbsolute(absolute) ? resolve(absolute) : resolve(directoryPath, absolute);
}

function excelConfigFromLegacy(
  table: ExcelTableConfig,
  sheetName: string
): DataRawTableExcelConfig {
  return {
    sourceKind: 'excel',
    sheetName,
    sheetNames: sheetName ? [sheetName] : [],
    headerMode: 'manual',
    headerRow: table.headerRowNumber || 1,
    password: table.password,
    fieldStrategy: table.fieldStrategy === TableFieldTypeStrategy.NONE ? 'all_text' : 'auto',
  };
}

export function importInputFromLegacyTable(
  directoryPath: string,
  legacy: LegacyCloudConnectionTableConfig
): DataImportRawTableInput {
  const table = toExcelTableConfig(legacy);
  const sourcePath = resolveLegacyTablePath(directoryPath, table.relativeFilePath);
  if (table.strategy === TableSourceStrategy.SINGLE_FILE) {
    const excel = isJavaExcel(sourcePath);
    const sheetName =
      table.sheetStrategy === SheetSelectStrategy.NAME
        ? table.sheetName
        : table.sheetStrategy === SheetSelectStrategy.INDEX
          ? ''
          : table.sheetName;
    return {
      filePath: sourcePath,
      name: table.tableName,
      sourceKind: excel ? 'excel' : 'csv',
      config: excel
        ? {
            ...excelConfigFromLegacy(table, sheetName || table.sheetName),
            ...(table.sheetStrategy === SheetSelectStrategy.INDEX
              ? { sheetName: null, sheetNames: [] }
              : {}),
            ...(table.sheetStrategy === SheetSelectStrategy.ALL
              ? { mergeSheets: getWorkbookSheetNames(sourcePath, table.password) }
              : {}),
          }
        : undefined,
    };
  }
  const folder: DataRawTableFolderConfig = {
    sourceKind: 'folder',
    mergeMode: 'append_same_schema',
    schemaStrategy:
      table.appendStrategy === TableAppendStrategy.NAME ? 'align_by_name' : 'align_by_index',
    fileRange: 'excel_csv',
    skipEmptyFiles: true,
    keepSourceFileName: false,
    recursive: table.readStrategy === TableReadStrategy.RECURSIVE_DIRECTORY,
    sortBy: sortByFromStrategy(table.strategy),
    headerMode: 'manual',
    headerRow: table.headerRowNumber || 1,
    fieldStrategy: table.fieldStrategy === TableFieldTypeStrategy.NONE ? 'all_text' : 'auto',
    systemFields: 'local_agent',
    password: table.password,
    sheetStrategy: table.sheetStrategy === SheetSelectStrategy.ALL ? 'all' : 'selector',
    sheetSelector:
      table.sheetStrategy === SheetSelectStrategy.NAME
        ? { by: 'name', name: table.sheetName }
        : { by: 'index', index: table.sheetNumber || 1 },
  };
  return {
    filePath: sourcePath,
    name: table.tableName,
    sourceKind: 'folder',
    config: folder,
  };
}

export interface AutoTableImport {
  reportName: string;
  input: DataImportRawTableInput;
}

/** 按 Java 自动表规则，为目录或早期 files 生成原始表导入清单。 */
export async function planAutoTableImports(options: {
  directoryPath: string;
  strategy: number;
  manualTables: LegacyCloudConnectionTableConfig[];
  files?: string[];
}): Promise<AutoTableImport[]> {
  const planned: AutoTableImport[] = [];
  const manual = options.manualTables.map(toExcelTableConfig);
  if (options.directoryPath && options.strategy) {
    const scanned = await scanAutoTableFiles(options.directoryPath, options.strategy, manual);
    for (const file of scanned) {
      planned.push(...planForScannedFile(file.filePath, file.relativePath));
    }
  }
  for (const absolute of options.files ?? []) {
    const relativePath = absolute;
    planned.push(...planForScannedFile(absolute, relativePath));
  }
  return planned;
}

function planForScannedFile(filePath: string, relativePath: string): AutoTableImport[] {
  if (isJavaCsv(filePath) || extname(filePath).toLowerCase() === '.csv') {
    return [
      {
        reportName: relativePath,
        input: { filePath, name: relativePath, sourceKind: 'csv' },
      },
    ];
  }
  if (!isJavaExcel(filePath)) return [];
  try {
    return getWorkbookSheetNames(filePath).map((sheetName) => ({
      reportName: `${relativePath}${EXCEL_TABLE_ID_SEPARATOR}${sheetName}`,
      input: {
        filePath,
        name: `${relativePath}${EXCEL_TABLE_ID_SEPARATOR}${sheetName}`,
        sourceKind: 'excel' as const,
        config: {
          sourceKind: 'excel' as const,
          sheetName,
          sheetNames: [sheetName],
          headerMode: 'auto' as const,
          headerRow: 1,
        },
      },
    }));
  } catch {
    return [];
  }
}

/** For index-based single-file sheet selection, resolve after the file is readable. */
export function resolveSingleFileSheetName(
  filePath: string,
  table: ExcelTableConfig
): string | null {
  if (table.sheetStrategy === SheetSelectStrategy.NAME) return table.sheetName;
  if (table.sheetStrategy === SheetSelectStrategy.ALL) return null;
  const names = getWorkbookSheetNames(filePath, table.password);
  return names[(table.sheetNumber || 1) - 1] ?? names[0] ?? null;
}
