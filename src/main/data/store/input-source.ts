import { normalizeCsvEncoding } from './csv-encoding';
import * as fs from 'fs';
import * as os from 'os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'path';
import * as XLSX from '../../utils/xlsx';
import type {
  DataRawTableColumnTypeOverride,
  DataRawTableConfig,
  DataRawTableCloudConfig,
  DataRawTableCsvConfig,
  DataRawTableExcelConfig,
  DataRawTableExcelMergedCellSummary,
  DataRawTableFolderConfig,
  DataRawTableHeaderCandidate,
  DataRawTableSourceFileSummary,
  DataRawTableSourceKind,
  DataRawTableSourceSummary,
  DataSaveRawTableNormalizerDraftInput,
} from '../../../shared/contracts';
import { isDataFieldType, type DataFieldType } from '../../../shared/data-field-types';
import { isRecord, quoteIdentifier, stringArray } from '../operators';

export interface ParsedWorkbookRows {
  columns: string[];
  rows: Array<Array<string | number | boolean | null>>;
  sheetName: string;
  sheetNames: string[];
}

export interface PreparedRawTableNormalizerSourceContext {
  directory: string;
  files: PreparedRawTableNormalizerSourceFile[];
}

export interface PreparedRawTableNormalizerSourceFile {
  path: string;
  relativePath: string;
  originalPath: string;
  originalKind: 'excel' | 'csv';
  delimiter: ',';
  sheetName?: string;
  headerCandidates?: DataRawTableHeaderCandidate[];
  rowCountEstimate?: number;
  columnCountEstimate?: number;
}

export interface PreparedRawTableImport {
  rowCount: number;
  columnCount: number;
  fileCount: number;
  config: DataRawTableConfig;
}

export function normalizeRawTableNormalizerSourceKind(value: string): DataRawTableSourceKind {
  if (value === 'excel' || value === 'csv' || value === 'folder' || value === 'cloud') {
    return value;
  }
  return 'excel';
}

export function normalizeStoredRawTableSourceKind(
  value: string | null,
  sourcePath: string
): DataRawTableSourceKind {
  if (value === 'excel' || value === 'csv' || value === 'folder' || value === 'cloud') {
    return value;
  }
  if (sourcePath.endsWith('/') || !extname(sourcePath)) {
    return 'folder';
  }
  return isExcelFile(sourcePath) ? 'excel' : 'csv';
}

export function parseRawTableConfig(
  value: string | null,
  sourceKind: DataRawTableSourceKind,
  sourcePath: string
): DataRawTableConfig {
  if (value) {
    try {
      const parsed = JSON.parse(value) as DataRawTableConfig;
      return normalizeStoredRawTableConfig(parsed, sourceKind, sourcePath);
    } catch {
      return normalizeStoredRawTableConfig(undefined, sourceKind, sourcePath);
    }
  }
  return normalizeStoredRawTableConfig(undefined, sourceKind, sourcePath);
}

export function inferWorkbookColumnTypes(parsed: ParsedWorkbookRows): DataFieldType[] {
  return parsed.columns.map((_, columnIndex) =>
    inferDataFieldTypeFromValues(parsed.rows.map((row) => row[columnIndex]))
  );
}

export function inferDataFieldTypeFromValues(values: unknown[]): DataFieldType {
  const nonEmpty = values.filter(hasInferableValue);
  if (nonEmpty.length === 0) {
    return 'text';
  }
  if (nonEmpty.every(isBooleanLikeValue)) {
    return 'boolean';
  }
  if (nonEmpty.every(isDateLikeValue)) {
    return nonEmpty.some(isDateTimeLikeValue) ? 'datetime' : 'date';
  }
  if (nonEmpty.every(isIntegerLikeValue)) {
    return 'integer';
  }
  if (nonEmpty.every(isNumericLikeValue)) {
    return nonEmpty.every(isFixedDecimalLikeValue) ? 'decimal' : 'float';
  }
  return 'text';
}

export function hasInferableValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return typeof value === 'string' ? value.trim().length > 0 : true;
}

export function isBooleanLikeValue(value: unknown): boolean {
  if (typeof value === 'boolean') return true;
  if (typeof value !== 'string') return false;
  return /^(true|false)$/i.test(value.trim());
}

export function isDateLikeValue(value: unknown): boolean {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return isDateOnlyText(text) || isDateTimeText(text);
}

export function isDateTimeLikeValue(value: unknown): boolean {
  return value instanceof Date || (typeof value === 'string' && isDateTimeText(value.trim()));
}

export function isDateOnlyText(value: string): boolean {
  if (!/^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{8})$/.test(value)) return false;
  const normalized =
    value.length === 8
      ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
      : value.replace(/[/.]/g, '-');
  const timestamp = Date.parse(`${normalized}T00:00:00Z`);
  return Number.isFinite(timestamp);
}

export function isDateTimeText(value: string): boolean {
  const match =
    /^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{8})[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?$/i.exec(
      value
    );
  if (!match) return false;
  const datePart = match[1];
  return isDateOnlyText(datePart);
}

export function isIntegerLikeValue(value: unknown): boolean {
  if (typeof value === 'bigint') return true;
  if (typeof value === 'number') return Number.isInteger(value);
  if (typeof value !== 'string') return false;
  const normalized = normalizeNumericText(value);
  return normalized !== null && /^[+-]?\d+$/.test(normalized);
}

export function isNumericLikeValue(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string') return false;
  const normalized = normalizeNumericText(value);
  return normalized !== null && Number.isFinite(Number(normalized));
}

export function isFixedDecimalLikeValue(value: unknown): boolean {
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value !== 'string') return false;
  const text = normalizeNumericText(value);
  if (text === null) return false;
  if (/[eE]/.test(text)) return false;
  if (/^[+-]?\d+$/.test(text)) return true;
  const match = /^[+-]?(?:\d+)\.(\d+)$/.exec(text);
  return Boolean(match && match[1].length <= 6);
}

export function normalizeNumericText(value: string): string | null {
  const text = value
    .trim()
    .normalize('NFKC')
    .replace(/[\u2212\u2010\u2011\u2012\u2013\u2014]/g, '-')
    .replace(/[\s\u00a0\u202f]+/g, '');
  if (!text) return null;
  if (text.includes(',')) {
    if (!/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(text)) {
      return null;
    }
    return text.replace(/,/g, '');
  }
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text) ? text : null;
}

export function normalizeWorkbookValueForDuckDb(
  value: string | number | boolean | null | undefined,
  inferredType: DataFieldType
): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return String(value);
  if (typeof value !== 'string') return value;
  if (inferredType === 'integer' || inferredType === 'float' || inferredType === 'decimal') {
    return normalizeNumericText(value) ?? value;
  }
  return value;
}

export function normalizeSourcePath(filePath: string): string {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Data source file does not exist: ${filePath}`);
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`Data source path is not a file: ${filePath}`);
  }
  readRelationForPath(filePath, 'sourcePath');
  return filePath;
}

export function normalizeImportSourcePath(sourcePath: string): string {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error(`Input table source does not exist: ${sourcePath}`);
  }
  const stat = fs.statSync(sourcePath);
  if (stat.isDirectory()) {
    return sourcePath;
  }
  if (!stat.isFile()) {
    throw new Error(`Input table source is not a file or folder: ${sourcePath}`);
  }
  if (!isImportableFile(sourcePath)) {
    throw new Error(
      `Unsupported input table source type: ${extname(sourcePath).toLowerCase() || '(none)'}`
    );
  }
  return sourcePath;
}

export function normalizeRawTableSourceKind(
  requestedKind: DataRawTableSourceKind | undefined,
  sourcePath: string
): DataRawTableSourceKind {
  if (requestedKind) {
    return requestedKind;
  }
  const stat = fs.statSync(sourcePath);
  if (stat.isDirectory()) {
    return 'folder';
  }
  return isExcelFile(sourcePath) ? 'excel' : 'csv';
}

export function normalizeColumnTypeOverrides(
  value: unknown
): DataRawTableColumnTypeOverride[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const overrides: DataRawTableColumnTypeOverride[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const name = String((entry as { name?: unknown }).name ?? '').trim();
    const type = String((entry as { type?: unknown }).type ?? '')
      .trim()
      .toLowerCase();
    if (!name || seen.has(name) || !isDataFieldType(type)) continue;
    seen.add(name);
    overrides.push({ name, type: type as DataFieldType });
  }
  return overrides.length > 0 ? overrides : undefined;
}

export function normalizeRawTableConfig(
  config: DataRawTableConfig | undefined,
  sourceKind: DataRawTableSourceKind,
  sourcePath: string
): DataRawTableConfig {
  if (sourceKind === 'cloud') {
    const cloudConfig = defaultCloudConfig(config);
    if (!cloudConfig.cloudMirror.tableId.trim()) throw new Error('Cloud tableId is required');
    return cloudConfig;
  }
  if (sourceKind === 'excel') {
    const fallback = defaultExcelConfig(sourcePath);
    if (config?.sourceKind !== 'excel') {
      return fallback;
    }
    const sheetName =
      config.sheetName && fallback.sheetNames.includes(config.sheetName)
        ? config.sheetName
        : fallback.sheetName;
    return {
      sourceKind: 'excel',
      sheetName,
      sheetNames: fallback.sheetNames,
      headerMode: config.headerMode === 'manual' ? 'manual' : 'auto',
      headerRow: Math.max(1, Math.floor(Number(config.headerRow) || 1)),
      columnTypeOverrides: normalizeColumnTypeOverrides(config.columnTypeOverrides),
      dataProcessing: normalizeRawTableDataProcessing(config.dataProcessing),
    };
  }

  if (sourceKind === 'folder') {
    if (config?.sourceKind !== 'folder') {
      return defaultFolderConfig();
    }
    return {
      sourceKind: 'folder',
      mergeMode: 'append_same_schema',
      schemaStrategy: 'align_by_name',
      fileRange:
        config.fileRange === 'excel' || config.fileRange === 'csv' ? config.fileRange : 'excel_csv',
      skipEmptyFiles: config.skipEmptyFiles !== false,
      keepSourceFileName: config.keepSourceFileName !== false,
      columnTypeOverrides: normalizeColumnTypeOverrides(config.columnTypeOverrides),
      dataProcessing: normalizeRawTableDataProcessing(config.dataProcessing),
    };
  }

  return defaultCsvConfig(config);
}

export function normalizeStoredRawTableConfig(
  config: DataRawTableConfig | undefined,
  sourceKind: DataRawTableSourceKind,
  sourcePath: string
): DataRawTableConfig {
  if (sourceKind === 'cloud') return defaultCloudConfig(config);
  if (sourceKind === 'excel') {
    const storedSheetNames =
      config?.sourceKind === 'excel'
        ? stringArray(config.sheetNames).filter((sheetName) => sheetName.trim())
        : [];
    const sheetNames = storedSheetNames.length > 0 ? storedSheetNames : ['Sheet1'];
    const storedSheetName =
      config?.sourceKind === 'excel' &&
      typeof config.sheetName === 'string' &&
      config.sheetName.trim()
        ? config.sheetName.trim()
        : '';
    return {
      sourceKind: 'excel',
      sheetName: storedSheetName || sheetNames[0] || 'Sheet1',
      sheetNames,
      headerMode:
        config?.sourceKind === 'excel' && config.headerMode === 'manual' ? 'manual' : 'auto',
      headerRow:
        config?.sourceKind === 'excel' ? Math.max(1, Math.floor(Number(config.headerRow) || 1)) : 1,
      columnTypeOverrides: normalizeColumnTypeOverrides(
        config?.sourceKind === 'excel' ? config.columnTypeOverrides : undefined
      ),
      dataProcessing: normalizeRawTableDataProcessing(
        config?.sourceKind === 'excel' ? config.dataProcessing : undefined
      ),
    };
  }

  if (sourceKind === 'folder') {
    return config?.sourceKind === 'folder'
      ? normalizeRawTableConfig(config, sourceKind, sourcePath)
      : defaultFolderConfig();
  }

  return defaultCsvConfig(config);
}

export function defaultExcelConfig(filePath?: string): DataRawTableExcelConfig {
  const sheetNames =
    filePath && fs.existsSync(filePath) && isExcelFile(filePath)
      ? getWorkbookSheetNames(filePath)
      : ['Sheet1'];
  return {
    sourceKind: 'excel',
    sheetName: sheetNames[0] ?? 'Sheet1',
    sheetNames,
    headerMode: 'auto',
    headerRow: 1,
    dataProcessing: defaultRawTableDataProcessing(),
  };
}

export function defaultCloudConfig(config?: DataRawTableConfig): DataRawTableCloudConfig {
  return {
    sourceKind: 'cloud',
    cloudMirror:
      (config?.sourceKind === 'cloud' || config?.sourceKind === 'csv') && config.cloudMirror
        ? { ...config.cloudMirror }
        : { tableId: '', contentHash: '' },
    dataProcessing: normalizeRawTableDataProcessing(config?.dataProcessing),
  };
}

export function defaultCsvConfig(config?: DataRawTableConfig): DataRawTableCsvConfig {
  return {
    sourceKind: 'csv',
    header: 'auto',
    dataRegion: 'auto',
    delimiter: 'auto',
    ...(config?.sourceKind === 'csv' ? config : {}),
    encoding: normalizeCsvEncoding(config?.sourceKind === 'csv' ? config.encoding : undefined),
    columnTypeOverrides: normalizeColumnTypeOverrides(
      config?.sourceKind === 'csv' ? config.columnTypeOverrides : undefined
    ),
    dataProcessing: normalizeRawTableDataProcessing(
      config?.sourceKind === 'csv' ? config.dataProcessing : undefined
    ),
  };
}

export function defaultFolderConfig(): DataRawTableFolderConfig {
  return {
    sourceKind: 'folder',
    mergeMode: 'append_same_schema',
    schemaStrategy: 'align_by_name',
    fileRange: 'excel_csv',
    skipEmptyFiles: true,
    keepSourceFileName: true,
    dataProcessing: defaultRawTableDataProcessing(),
  };
}

export function defaultRawTableDataProcessing(): DataRawTableConfig['dataProcessing'] {
  return { strategy: 'auto' };
}

export function normalizeRawTableDataProcessing(
  value: DataRawTableConfig['dataProcessing'] | undefined
): DataRawTableConfig['dataProcessing'] {
  if (value?.strategy === 'customize') {
    return {
      strategy: 'customize',
      rulePrompt: typeof value.rulePrompt === 'string' ? value.rulePrompt : '',
      selectedSkillNames: Array.isArray(value.selectedSkillNames)
        ? value.selectedSkillNames.filter(
            (name): name is string => typeof name === 'string' && name.trim().length > 0
          )
        : undefined,
      modelConfigSetId:
        typeof value.modelConfigSetId === 'string' && value.modelConfigSetId.trim()
          ? value.modelConfigSetId
          : undefined,
      model: typeof value.model === 'string' && value.model.trim() ? value.model : undefined,
      artifactId: typeof value.artifactId === 'string' ? value.artifactId : undefined,
      artifactVersionId:
        typeof value.artifactVersionId === 'string' ? value.artifactVersionId : undefined,
      artifactVersionStatus:
        value.artifactVersionStatus === 'draft' ||
        value.artifactVersionStatus === 'published' ||
        value.artifactVersionStatus === 'archived'
          ? value.artifactVersionStatus
          : undefined,
      fileTreeHash: typeof value.fileTreeHash === 'string' ? value.fileTreeHash : undefined,
      dependencyLockHash:
        typeof value.dependencyLockHash === 'string' ? value.dependencyLockHash : undefined,
      runtime: value.runtime,
      entrypoint: value.entrypoint,
      dependencyPrepare: value.dependencyPrepare,
      projectFiles: Array.isArray(value.projectFiles)
        ? value.projectFiles
            .filter(
              (file) =>
                file &&
                typeof file.path === 'string' &&
                typeof file.content === 'string' &&
                file.path.trim().length > 0
            )
            .map((file) => ({ path: file.path, content: file.content }))
        : undefined,
      sourceSummaryHash:
        typeof value.sourceSummaryHash === 'string' ? value.sourceSummaryHash : undefined,
    };
  }
  return defaultRawTableDataProcessing();
}

export function getWorkbookSheetNames(filePath: string): string[] {
  const workbook = readWorkbookFile(filePath);
  return workbook.SheetNames.length > 0 ? workbook.SheetNames : ['Sheet1'];
}

export function getImportSourceFiles(
  sourcePath: string,
  sourceKind: DataRawTableSourceKind,
  config: DataRawTableConfig
): string[] {
  const stat = fs.statSync(sourcePath);
  if (stat.isFile()) {
    return [sourcePath];
  }

  const folderConfig = config.sourceKind === 'folder' ? config : defaultFolderConfig();
  const files = listImportableFiles(sourcePath, folderConfig.fileRange);
  if (files.length === 0) {
    throw new Error(
      sourceKind === 'folder'
        ? 'No Excel or Csv files were found in the selected folder'
        : 'No input table file was found'
    );
  }
  return files;
}

export function writeRawTableNormalizerProjectFiles(
  projectDir: string,
  files: DataSaveRawTableNormalizerDraftInput['files']
): void {
  fs.rmSync(projectDir, { recursive: true, force: true });
  fs.mkdirSync(projectDir, { recursive: true });
  for (const file of files) {
    const targetPath = resolveSafeNormalizerProjectPath(projectDir, file.path);
    fs.mkdirSync(dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, file.content, 'utf8');
  }
}

export function resolveSafeNormalizerProjectPath(projectDir: string, filePath: string): string {
  if (isAbsolute(filePath)) {
    throw new Error(`Normalizer project file path must be relative: ${filePath}`);
  }
  const root = resolve(projectDir);
  const resolved = resolve(projectDir, filePath);
  if (!isPathInside(resolved, root)) {
    throw new Error(`Normalizer project file escapes project root: ${filePath}`);
  }
  return resolved;
}

export function isPathInside(childPath: string, rootPath: string): boolean {
  const child = resolve(childPath);
  const root = resolve(rootPath);
  return child === root || child.startsWith(`${root}${process.platform === 'win32' ? '\\' : '/'}`);
}

export function sanitizeNormalizerPathSegment(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 96);
  return sanitized || 'unknown';
}

export function prepareRawTableNormalizerSources(input: {
  sourcePath: string;
  sourceKind: DataRawTableSourceKind;
  config: DataRawTableConfig;
  summary: DataRawTableSourceSummary;
}): PreparedRawTableNormalizerSourceContext {
  const directory = fs.mkdtempSync(join(os.tmpdir(), 'sophron-normalizer-input-'));
  const importFiles = getImportSourceFiles(input.sourcePath, input.sourceKind, input.config);
  const summaryByPath = new Map(input.summary.files.map((file) => [file.path, file]));
  const files: PreparedRawTableNormalizerSourceFile[] = [];
  try {
    for (const [fileIndex, filePath] of importFiles.entries()) {
      const summary = summaryByPath.get(filePath);
      if (isExcelFile(filePath)) {
        files.push(
          ...prepareWorkbookNormalizerSources({
            filePath,
            sourcePath: input.sourcePath,
            config: input.config,
            summary,
            directory,
            fileIndex,
          })
        );
        continue;
      }
      if (isCsvLikeFile(filePath)) {
        files.push(
          prepareDelimitedNormalizerSource({
            filePath,
            sourcePath: input.sourcePath,
            summary,
            directory,
            fileIndex,
          })
        );
      }
    }
    return { directory, files };
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export function prepareWorkbookNormalizerSources(input: {
  filePath: string;
  sourcePath: string;
  config: DataRawTableConfig;
  summary: DataRawTableSourceFileSummary | undefined;
  directory: string;
  fileIndex: number;
}): PreparedRawTableNormalizerSourceFile[] {
  const workbook = readWorkbookFile(input.filePath);
  const selectedSheetNames = selectNormalizerWorkbookSheets(workbook.SheetNames, input.config);
  return selectedSheetNames.map((sheetName, sheetIndex) => {
    const sheet = workbook.Sheets[sheetName];
    const matrix = sheetToExpandedMatrix(sheet);
    const preparedPath = join(
      input.directory,
      createPreparedSourceFileName(input.fileIndex, sheetIndex, input.filePath)
    );
    writeCsvRows(preparedPath, matrix);
    const sheetSummary = input.summary?.sheets?.find((candidate) => candidate.name === sheetName);
    return {
      path: preparedPath,
      relativePath: `${getSourceRelativePath(input.sourcePath, input.filePath)}#${sheetName}`,
      originalPath: input.filePath,
      originalKind: 'excel',
      delimiter: ',',
      sheetName,
      headerCandidates: sheetSummary?.headerCandidates ?? detectHeaderCandidates(matrix, 80),
      rowCountEstimate: sheetSummary?.rowCountEstimate ?? matrix.length,
      columnCountEstimate:
        sheetSummary?.columnCountEstimate ?? Math.max(0, ...matrix.map((row) => row.length)),
    };
  });
}

export function selectNormalizerWorkbookSheets(
  sheetNames: string[],
  config: DataRawTableConfig
): string[] {
  if (sheetNames.length === 0) {
    return [];
  }
  if (config.sourceKind === 'excel') {
    const sheetName =
      config.sheetName && sheetNames.includes(config.sheetName) ? config.sheetName : sheetNames[0];
    return sheetName ? [sheetName] : [];
  }
  return [sheetNames[0]];
}

export function prepareDelimitedNormalizerSource(input: {
  filePath: string;
  sourcePath: string;
  summary: DataRawTableSourceFileSummary | undefined;
  directory: string;
  fileIndex: number;
}): PreparedRawTableNormalizerSourceFile {
  const delimiter = extname(input.filePath).toLowerCase() === '.csv' ? ',' : '\t';
  const rows = parseDelimitedRows(fs.readFileSync(input.filePath, 'utf8'), delimiter);
  const preparedPath = join(
    input.directory,
    createPreparedSourceFileName(input.fileIndex, 0, input.filePath)
  );
  writeCsvRows(preparedPath, rows);
  return {
    path: preparedPath,
    relativePath: getSourceRelativePath(input.sourcePath, input.filePath),
    originalPath: input.filePath,
    originalKind: 'csv',
    delimiter: ',',
    headerCandidates: input.summary?.sampleRows
      ? detectHeaderCandidates(input.summary.sampleRows, 80)
      : detectHeaderCandidates(rows, 80),
    rowCountEstimate: rows.length,
    columnCountEstimate: Math.max(0, ...rows.map((row) => row.length)),
  };
}

export function createPreparedSourceFileName(
  fileIndex: number,
  sheetIndex: number,
  filePath: string
): string {
  const baseName =
    basename(filePath, extname(filePath)).replace(/[^A-Za-z0-9_-]+/g, '_') || 'source';
  return `${String(fileIndex + 1).padStart(3, '0')}_${String(sheetIndex + 1).padStart(3, '0')}_${baseName}.csv`;
}

export function writeCsvRows(
  filePath: string,
  rows: Array<Array<string | number | boolean | null>>
): void {
  const content = rows
    .map((row) =>
      row
        .map((cell) => escapeCsvCell(cell === null || cell === undefined ? '' : String(cell)))
        .join(',')
    )
    .join('\n');
  fs.writeFileSync(filePath, `${content}${content ? '\n' : ''}`, 'utf8');
}

export function parseDelimitedRows(text: string, delimiter: ',' | '\t'): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === delimiter && !inQuotes) {
      row.push(cell.trim());
      cell = '';
      continue;
    }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      row.push(cell.trim());
      if (row.some((value) => value.trim().length > 0)) {
        rows.push(row);
      }
      row = [];
      cell = '';
      continue;
    }
    cell += char;
  }
  row.push(cell.trim());
  if (row.some((value) => value.trim().length > 0)) {
    rows.push(row);
  }
  return rows;
}

export function escapeCsvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function listImportableFiles(
  folderPath: string,
  fileRange: DataRawTableFolderConfig['fileRange'] = 'excel_csv'
): string[] {
  const files: string[] = [];
  const visit = (directory: string) => {
    const entries = fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith('.') && !entry.name.startsWith('~$'))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }
      if (entry.isFile() && isFolderRangeFile(entryPath, fileRange)) {
        files.push(entryPath);
      }
    }
  };
  visit(folderPath);
  return files;
}

export function readRelationForPath(filePath: string, parameterName: string): string {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.csv') {
    return `read_csv_auto($${parameterName}, header = true)`;
  }
  if (extension === '.tsv' || extension === '.tab') {
    return `read_csv_auto($${parameterName}, header = true, delim = '\t')`;
  }
  if (extension === '.json' || extension === '.jsonl' || extension === '.ndjson') {
    return `read_json_auto($${parameterName})`;
  }
  if (extension === '.parquet') {
    return `read_parquet($${parameterName})`;
  }
  throw new Error(`Unsupported data file type: ${extension || '(none)'}`);
}

export function readNormalizerOutputRelationForPath(
  filePath: string,
  parameterName: string
): string {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.csv') {
    return `read_csv($${parameterName}, header = true, delim = ',', quote = '"', escape = '"', all_varchar = true, strict_mode = false, null_padding = true)`;
  }
  return readRelationForPath(filePath, parameterName);
}

export function readImportRelationForPath(
  filePath: string,
  parameterName: string,
  forceVarchar: boolean
): string {
  if (!forceVarchar) {
    return readRelationForPath(filePath, parameterName);
  }
  const extension = extname(filePath).toLowerCase();
  if (extension === '.csv') {
    return `read_csv_auto($${parameterName}, header = true, all_varchar = true)`;
  }
  if (extension === '.tsv' || extension === '.tab') {
    return `read_csv_auto($${parameterName}, header = true, delim = '\t', all_varchar = true)`;
  }
  return readRelationForPath(filePath, parameterName);
}

export function buildUnionSqlFromTempTables(tempTables: string[]): string {
  return tempTables
    .map((tempTable, index) => {
      const selectSql = `SELECT * FROM ${quoteIdentifier(tempTable)}`;
      return index === 0 ? selectSql : `UNION ALL BY NAME ${selectSql}`;
    })
    .join('\n');
}

export function normalizePreviewLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) {
    return 100;
  }
  return Math.max(1, Math.min(100, Math.floor(Number(limit))));
}

export function normalizePreviewOffset(offset: number | undefined): number {
  if (!Number.isFinite(offset)) {
    return 0;
  }
  return Math.max(0, Math.floor(Number(offset)));
}

export function normalizeCsvExportMaxRows(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(1, Math.floor(Number(value)));
}

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function normalizePreviewRow(
  row: Record<string, unknown>
): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, normalizePreviewCell(value)])
  );
}

export function normalizePreviewCell(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return String(value);
}

export function isImportableFile(filePath: string): boolean {
  return (
    isRawTableFile(filePath) ||
    ['.json', '.jsonl', '.ndjson', '.parquet'].includes(extname(filePath).toLowerCase())
  );
}

export function isRawTableFile(filePath: string): boolean {
  const extension = extname(filePath).toLowerCase();
  return (
    extension === '.csv' || extension === '.tsv' || extension === '.tab' || isExcelFile(filePath)
  );
}

export function isFolderRangeFile(
  filePath: string,
  fileRange: DataRawTableFolderConfig['fileRange']
): boolean {
  if (fileRange === 'excel') {
    return isExcelFile(filePath);
  }
  if (fileRange === 'csv') {
    return isCsvLikeFile(filePath);
  }
  return isRawTableFile(filePath);
}

export function isCsvLikeFile(filePath: string): boolean {
  const extension = extname(filePath).toLowerCase();
  return extension === '.csv' || extension === '.tsv' || extension === '.tab';
}

export function isExcelFile(filePath: string): boolean {
  const extension = extname(filePath).toLowerCase();
  return extension === '.xlsx' || extension === '.xls';
}

export function parseWorkbookRows(
  filePath: string,
  config: DataRawTableExcelConfig
): ParsedWorkbookRows {
  const workbook = readWorkbookFile(filePath);
  const sheetNames = workbook.SheetNames;
  const sheetName =
    config.sheetName && sheetNames.includes(config.sheetName) ? config.sheetName : sheetNames[0];
  if (!sheetName) {
    throw new Error(`Excel workbook has no sheets: ${filePath}`);
  }
  const sheet = workbook.Sheets[sheetName];
  const matrix = sheetToExpandedMatrix(sheet);
  const headerIndex =
    config.headerMode === 'manual'
      ? Math.max(0, config.headerRow - 1)
      : matrix.findIndex((row) => row.some(hasCellValue));
  if (headerIndex < 0) {
    throw new Error(`Excel workbook has no header row: ${filePath}`);
  }

  const headerRow = matrix[headerIndex];
  if (!headerRow) {
    throw new Error(`Excel header row does not exist: ${filePath}`);
  }

  const columns = normalizeWorkbookColumns(headerRow);
  const rows = matrix
    .slice(headerIndex + 1)
    .filter((row) => row.some(hasCellValue))
    .map((row) => columns.map((_, index) => normalizeWorkbookCell(row[index])));
  return { columns, rows, sheetName, sheetNames };
}

export function summarizeRawTableFile(
  filePath: string,
  sourcePath: string,
  options: {
    maxSheetsPerFile: number;
    maxRowsPerSheet: number;
    maxColumnsPerRow: number;
  }
): DataRawTableSourceFileSummary {
  const stat = fs.statSync(filePath);
  const extension = extname(filePath).toLowerCase();
  const baseSummary: DataRawTableSourceFileSummary = {
    path: filePath,
    name: basename(filePath),
    relativePath: getSourceRelativePath(sourcePath, filePath),
    extension,
    kind: isExcelFile(filePath) ? 'excel' : isCsvLikeFile(filePath) ? 'csv' : 'other',
    sizeBytes: stat.size,
    modifiedAt: Math.floor(stat.mtimeMs),
  };

  try {
    if (isExcelFile(filePath)) {
      return {
        ...baseSummary,
        sheets: summarizeWorkbookSheets(filePath, options),
      };
    }
    if (isCsvLikeFile(filePath)) {
      const delimiter = extension === '.tsv' || extension === '.tab' ? '\t' : ',';
      return {
        ...baseSummary,
        delimiter,
        sampleRows: summarizeDelimitedFileRows(filePath, delimiter, options),
      };
    }
    return baseSummary;
  } catch (error) {
    return {
      ...baseSummary,
      warning: error instanceof Error ? error.message : String(error),
    };
  }
}

export function summarizeWorkbookSheets(
  filePath: string,
  options: {
    maxSheetsPerFile: number;
    maxRowsPerSheet: number;
    maxColumnsPerRow: number;
  }
): DataRawTableSourceFileSummary['sheets'] {
  const workbook = readWorkbookFile(filePath, {
    sheetRows: Math.max(options.maxRowsPerSheet * 3, 24),
  });
  return workbook.SheetNames.slice(0, options.maxSheetsPerFile).map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const range = typeof sheet?.['!ref'] === 'string' ? sheet['!ref'] : null;
    const matrix = sheetToExpandedMatrix(sheet);
    const normalizedRows = matrix
      .slice(0, options.maxRowsPerSheet)
      .map((row) => summarizeRowValues(row, options.maxColumnsPerRow));
    const decodedRange = range ? XLSX.utils.decode_range(range) : null;
    const columnCountEstimate = decodedRange
      ? decodedRange.e.c - decodedRange.s.c + 1
      : Math.max(0, ...matrix.map((row) => row.length));
    const rowCountEstimate = decodedRange ? decodedRange.e.r - decodedRange.s.r + 1 : matrix.length;
    return {
      name: sheetName,
      range,
      mergeCount: Array.isArray(sheet?.['!merges']) ? sheet['!merges'].length : 0,
      mergedCells: summarizeWorkbookMergedCells(sheet, matrix),
      rowCountEstimate,
      columnCountEstimate,
      headerCandidates: detectHeaderCandidates(matrix, options.maxColumnsPerRow),
      sampleRows: normalizedRows,
    };
  });
}

export function summarizeWorkbookMergedCells(
  sheet: XLSX.WorkSheet,
  expandedRows: Array<Array<string | number | boolean | null>>,
  maxMergedCells = 40
): DataRawTableExcelMergedCellSummary[] {
  const merges = Array.isArray(sheet['!merges']) ? sheet['!merges'] : [];
  return merges.slice(0, maxMergedCells).map((merge) => {
    const value = expandedRows[merge.s.r]?.[merge.s.c];
    return {
      range: XLSX.utils.encode_range(merge),
      startRow: merge.s.r + 1,
      endRow: merge.e.r + 1,
      startColumn: merge.s.c + 1,
      endColumn: merge.e.c + 1,
      value: value === null || value === undefined ? '' : String(value).replace(/\s+/g, ' ').trim(),
    };
  });
}

export function readWorkbookFile(
  filePath: string,
  options: XLSX.ParsingOptions = {}
): XLSX.WorkBook {
  return XLSX.read(fs.readFileSync(filePath), {
    cellDates: false,
    raw: false,
    type: 'buffer',
    ...options,
  });
}

export function sheetToExpandedMatrix(
  sheet: XLSX.WorkSheet
): Array<Array<string | number | boolean | null>> {
  const matrix = XLSX.utils.sheet_to_json<Array<string | number | boolean | null>>(sheet, {
    header: 1,
    blankrows: false,
    defval: null,
    raw: false,
  });
  const expanded = matrix.map((row) => [...row]);
  const merges = Array.isArray(sheet['!merges']) ? sheet['!merges'] : [];
  for (const merge of merges) {
    const sourceValue = expanded[merge.s.r]?.[merge.s.c] ?? null;
    for (let rowIndex = merge.s.r; rowIndex <= merge.e.r; rowIndex += 1) {
      const row = expanded[rowIndex] ?? [];
      expanded[rowIndex] = row;
      for (let columnIndex = merge.s.c; columnIndex <= merge.e.c; columnIndex += 1) {
        if (
          row[columnIndex] === null ||
          row[columnIndex] === undefined ||
          row[columnIndex] === ''
        ) {
          row[columnIndex] = sourceValue;
        }
      }
    }
  }
  return expanded;
}

export function summarizeDelimitedFileRows(
  filePath: string,
  delimiter: string,
  options: {
    maxRowsPerSheet: number;
    maxColumnsPerRow: number;
  }
): string[][] {
  const sampleText = readTextSample(filePath, 65_536);
  return sampleText
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, options.maxRowsPerSheet)
    .map((line) =>
      line
        .split(delimiter)
        .slice(0, options.maxColumnsPerRow)
        .map((cell) => cell.trim())
    );
}

export function detectHeaderCandidates(
  rows: Array<Array<string | number | boolean | null>>,
  maxColumnsPerRow: number
): DataRawTableHeaderCandidate[] {
  return rows
    .map((row, index) => {
      const values = summarizeRowValues(row, maxColumnsPerRow);
      return {
        rowNumber: index + 1,
        nonEmptyCellCount: values.filter((value) => value.length > 0).length,
        values,
      };
    })
    .filter((candidate) => candidate.nonEmptyCellCount > 0)
    .sort((left, right) => right.nonEmptyCellCount - left.nonEmptyCellCount)
    .slice(0, 3)
    .sort((left, right) => left.rowNumber - right.rowNumber);
}

export function summarizeRowValues(
  row: Array<string | number | boolean | null>,
  maxColumnsPerRow: number
): string[] {
  return row.slice(0, maxColumnsPerRow).map((value) => {
    if (value === null || value === undefined) return '';
    const text = String(value).replace(/\s+/g, ' ').trim();
    return text.length > 80 ? `${text.slice(0, 77)}...` : text;
  });
}

export function readTextSample(filePath: string, maxBytes: number): string {
  const handle = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = fs.readSync(handle, buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    fs.closeSync(handle);
  }
}

export function getSourceRelativePath(sourcePath: string, filePath: string): string {
  const sourceStat = fs.statSync(sourcePath);
  return sourceStat.isDirectory()
    ? relative(sourcePath, filePath) || basename(filePath)
    : basename(filePath);
}

export function clampSummaryLimit(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(Number(value))));
}

export function createStableJsonHash(value: unknown): string {
  return createStableTextHash(JSON.stringify(value, sortJsonKeys));
}

export function createStableTextHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function sortJsonKeys(_key: string, value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
  );
}

export function normalizeWorkbookColumns(row: Array<string | number | boolean | null>): string[] {
  const used = new Map<string, number>();
  return row.map((value, index) => {
    const rawName = value === null || value === undefined ? '' : String(value).trim();
    const baseName = rawName || `column_${index + 1}`;
    const nextCount = (used.get(baseName) ?? 0) + 1;
    used.set(baseName, nextCount);
    return nextCount === 1 ? baseName : `${baseName}_${nextCount}`;
  });
}

export function normalizeWorkbookCell(
  value: string | number | boolean | null | undefined
): string | number | boolean | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function hasCellValue(value: string | number | boolean | null | undefined): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  return typeof value === 'string' ? value.trim().length > 0 : true;
}

export function rawTableNameFromPath(filePath: string): string {
  const name = basename(filePath);
  const extension = extname(name);
  return extension ? name.slice(0, -extension.length) : name;
}
