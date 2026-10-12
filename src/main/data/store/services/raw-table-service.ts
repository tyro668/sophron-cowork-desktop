/** Input/output table materialization: import, update, preview, export. */
import type {
  DataRawTableColumnTypeOverride,
  DataRawTableConfig,
  DataRawTablePreview,
  DataRawTableSourceKind,
  DataRawTable,
  DataImportRawTableInput,
  DataResultTable,
  DataPreviewRawTableSourceInput,
  DataPreviewRawTableInput,
  DataUpdateRawTableInput,
  DataUpdateResultTableInput,
} from '../../../../shared/contracts';
import { duckDbTypeForDataFieldType } from '../../../../shared/data-field-types';
import { quoteIdentifier, toNumber, quoteValueIdentifier } from '../../operators';
import { DataStoreContext } from '../data-store-context';
import {
  resultTableConfigJson,
  tableNameFromId,
  DataRawTableCsvExport,
} from '../data-store-records';
import {
  normalizeImportSourcePath,
  normalizeRawTableConfig,
  normalizeRawTableSourceKind,
  normalizePreviewLimit,
  normalizePreviewOffset,
  normalizePreviewRow,
  PreparedRawTableImport,
  buildUnionSqlFromTempTables,
  csvCell,
  rawTableNameFromPath,
  defaultExcelConfig,
  defaultFolderConfig,
  getImportSourceFiles,
  inferWorkbookColumnTypes,
  isExcelFile,
  normalizeCsvExportMaxRows,
  normalizeWorkbookValueForDuckDb,
  ParsedWorkbookRows,
  parseWorkbookRows,
  readImportRelationForPath,
} from '../input-source';
import { RawTableRepository } from '../repositories/raw-table-repository';
import { TableCommitJournal } from '../repositories/table-commit-journal';
import { NormalizerService } from './normalizer-service';
import { basename } from 'path';
import { v4 as uuidv4 } from 'uuid';

export class RawTableService {
  /** Fired after a staged table commit completes — 'reimport' carries a raw
   * table id, 'rebind_output' a result table id. Listener errors are swallowed. */
  onTableCommitted?: (tableId: string, operation: 'reimport' | 'rebind_output') => void;
  constructor(
    private readonly ctx: DataStoreContext,
    private readonly rawTables: RawTableRepository,
    private readonly normalizerService: NormalizerService,
    private readonly tableCommits: TableCommitJournal
  ) {}
  async importRawTable(input: DataImportRawTableInput): Promise<DataRawTable> {
    return this.ctx.runExclusive(() => this.importRawTableUnsafe(input), 'importRawTable');
  }
  private async importRawTableUnsafe(input: DataImportRawTableInput): Promise<DataRawTable> {
    await this.ctx.ensureReady();
    const sourcePath = normalizeImportSourcePath(input.filePath);
    const id = uuidv4();
    const tableName = tableNameFromId('rawTable', id);
    try {
      const sourceKind = normalizeRawTableSourceKind(input.sourceKind, sourcePath);
      const prepared = await this.createRawTableTableFromSource(
        tableName,
        sourcePath,
        sourceKind,
        input.config
      );
      const now = this.ctx.now();
      const name = input.name?.trim() || rawTableNameFromPath(sourcePath);
      await this.rawTables.insertRawTable({
        id,
        name,
        sourcePath,
        sourceKind,
        configJson: JSON.stringify(prepared.config),
        fileCount: prepared.fileCount,
        tableName,
        rowCount: prepared.rowCount,
        columnCount: prepared.columnCount,
        createdAt: now,
        updatedAt: now,
      });
      return this.rawTables.requireRawTable(id);
    } catch (error) {
      await this.ctx.dropTableIfExists(tableName);
      throw error;
    }
  }
  async updateRawTable(input: DataUpdateRawTableInput): Promise<DataRawTable> {
    return this.ctx.runExclusive(
      () => this.updateRawTableUnsafe(input),
      `updateRawTable:${input.id}`
    );
  }
  private async updateRawTableUnsafe(input: DataUpdateRawTableInput): Promise<DataRawTable> {
    await this.ctx.ensureMetadataReady();
    const rawTable = await this.rawTables.requireRawTable(input.id);
    // A cloud binding must be materialized by the cloud import service first.
    // A config-only save may change processing settings, never relabel stale rows.
    if (!input.filePath && input.config?.sourceKind === 'cloud') {
      const previous =
        rawTable.inputConfig.sourceKind === 'cloud' || rawTable.inputConfig.sourceKind === 'csv'
          ? rawTable.inputConfig.cloudMirror
          : undefined;
      const next = input.config.cloudMirror;
      if (
        !previous ||
        previous.tableId !== next.tableId ||
        previous.spaceId !== next.spaceId ||
        previous.projectId !== next.projectId
      ) {
        throw new Error('Use cloud import to change the linked cloud table');
      }
    }
    const name = input.name?.trim();
    const shouldReimport =
      Boolean(input.filePath) || Boolean(input.config) || Boolean(input.sourceKind);
    const sourcePath = input.filePath
      ? normalizeImportSourcePath(input.filePath)
      : shouldReimport
        ? rawTable.sourcePath
        : null;

    if (!sourcePath) {
      if (name && name !== rawTable.name) {
        await this.rawTables.renameRawTable(rawTable.id, name, this.ctx.now());
      }
      return this.rawTables.requireRawTable(rawTable.id);
    }

    const replacementTable = tableNameFromId('rawTable_update', uuidv4());
    try {
      await this.ctx.ensureReady();
      const sourceKind = normalizeRawTableSourceKind(
        input.sourceKind ?? rawTable.sourceKind,
        sourcePath
      );
      const prepared = await this.createRawTableTableFromSource(
        replacementTable,
        sourcePath,
        sourceKind,
        input.config ?? rawTable.inputConfig
      );
      const now = this.ctx.now();
      await this.commitStagedTable({
        rawTableId: rawTable.id,
        operation: 'reimport',
        stagingTable: replacementTable,
        targetTable: rawTable.tableName,
        writeMetadata: () =>
          this.rawTables.updateRawTableAfterReimport({
            id: rawTable.id,
            name: name || rawTable.name,
            sourcePath,
            sourceKind,
            configJson: JSON.stringify(prepared.config),
            fileCount: prepared.fileCount,
            rowCount: prepared.rowCount,
            columnCount: prepared.columnCount,
            updatedAt: now,
          }),
      });
      return this.rawTables.requireRawTable(rawTable.id);
    } catch (error) {
      await this.ctx.dropTableIfExists(replacementTable).catch(() => undefined);
      throw error;
    }
  }
  async updateResultTable(input: DataUpdateResultTableInput): Promise<DataResultTable> {
    return this.ctx.runExclusive(
      () => this.updateResultTableUnsafe(input),
      `updateResultTable:${input.id}`
    );
  }
  private async updateResultTableUnsafe(
    input: DataUpdateResultTableInput
  ): Promise<DataResultTable> {
    await this.ctx.ensureMetadataReady();
    const resultTable = await this.rawTables.requireResultTable(input.id);
    const name = input.name?.trim();
    const nextName = name && name !== resultTable.name ? name : null;
    const hasSourceRawTableChange =
      Object.prototype.hasOwnProperty.call(input, 'sourceRawTableId') &&
      (input.sourceRawTableId ?? null) !== resultTable.sourceRawTableId;

    if (!nextName && !hasSourceRawTableChange) {
      return resultTable;
    }

    if (hasSourceRawTableChange && input.sourceRawTableId) {
      const sourceRawTable = await this.rawTables.requireInputRawTable(input.sourceRawTableId);
      await this.ctx.ensureReady();
      if (!(await this.ctx.physicalTableExists(sourceRawTable.tableName))) {
        throw new Error(`Input table is not materialized: ${sourceRawTable.id}`);
      }
      const stagingTable = tableNameFromId('output_rebind', uuidv4());
      try {
        await this.ctx.runSql(
          `CREATE TABLE ${quoteIdentifier(stagingTable)} AS SELECT * FROM ${quoteIdentifier(
            sourceRawTable.tableName
          )}`
        );
        const rowCount = await this.ctx.countRows(stagingTable);
        const columnCount = (await this.ctx.getTableColumns(stagingTable)).length;
        await this.commitStagedTable({
          rawTableId: resultTable.id,
          operation: 'rebind_output',
          stagingTable,
          targetTable: resultTable.tableName,
          writeMetadata: () =>
            this.rawTables.updateResultTableForSource({
              id: resultTable.id,
              name: nextName,
              sourcePath: `raw-table://${sourceRawTable.id}`,
              configJson: resultTableConfigJson(sourceRawTable.id, resultTable.cloudAction),
              rowCount,
              columnCount,
              updatedAt: this.ctx.now(),
            }),
        });
      } catch (error) {
        await this.ctx.dropTableIfExists(stagingTable).catch(() => undefined);
        throw error;
      }
      return this.rawTables.requireResultTable(input.id);
    }

    if (hasSourceRawTableChange) {
      await this.rawTables.updateResultTableMetadata({
        id: resultTable.id,
        name: nextName,
        sourcePath: `duckdb://outputs/${resultTable.tableName}`,
        configJson: resultTableConfigJson(undefined, resultTable.cloudAction),
        updatedAt: this.ctx.now(),
      });
      return this.rawTables.requireResultTable(input.id);
    }

    if (nextName) {
      await this.rawTables.renameRawTable(resultTable.id, nextName, this.ctx.now());
    }
    return this.rawTables.requireResultTable(input.id);
  }
  /**
   * Journaled physical+metadata commit for a staged replacement table. The
   * old target survives under a backup name until metadata commits, so a
   * mid-commit failure can always restore the pre-commit state. When the
   * restore itself fails the journal row stays recoverable ('prepared' or
   * 'data_committed') and startup recovery retries it — mirroring the
   * data_output_commits contract. Callers must already hold runExclusive.
   */
  private async commitStagedTable(input: {
    rawTableId: string;
    operation: 'reimport' | 'rebind_output';
    stagingTable: string;
    targetTable: string;
    writeMetadata: () => Promise<void>;
  }): Promise<void> {
    const journalId = uuidv4();
    const targetExisted = await this.ctx.physicalTableExists(input.targetTable);
    const backupTable = targetExisted ? tableNameFromId('table_backup', journalId) : null;
    await this.tableCommits.insertPreparedCommit({
      id: journalId,
      rawTableId: input.rawTableId,
      operation: input.operation,
      stagingTable: input.stagingTable,
      targetTable: input.targetTable,
      backupTable,
      targetExisted,
      at: this.ctx.now(),
    });

    let physicalCommitted = false;
    let metadataTransactionStarted = false;
    try {
      await this.ctx.runSql('BEGIN TRANSACTION');
      if (backupTable) {
        await this.ctx.dropTableIfExists(backupTable);
        await this.ctx.runSql(
          `ALTER TABLE ${quoteIdentifier(input.targetTable)} RENAME TO ${quoteIdentifier(backupTable)}`
        );
      }
      await this.ctx.runSql(
        `ALTER TABLE ${quoteIdentifier(input.stagingTable)} RENAME TO ${quoteIdentifier(input.targetTable)}`
      );
      await this.ctx.runSql('COMMIT');
      physicalCommitted = true;
      await this.tableCommits.updateCommitState(journalId, 'data_committed');

      await this.ctx.metaRunSql('BEGIN TRANSACTION');
      metadataTransactionStarted = true;
      await input.writeMetadata();
      // Mark the journal inside the metadata transaction so the state
      // flips atomically with the rawTable row it describes.
      await this.tableCommits.updateCommitState(journalId, 'metadata_committed');
      await this.ctx.metaRunSql('COMMIT');
      metadataTransactionStarted = false;
    } catch (error) {
      if (metadataTransactionStarted) {
        await this.ctx.metaRunSql('ROLLBACK').catch(() => undefined);
      }
      const message = error instanceof Error ? error.message : String(error);
      let restored = false;
      if (physicalCommitted) {
        try {
          await this.restoreTableCommit({
            targetTable: input.targetTable,
            backupTable,
            targetExisted,
          });
          restored = true;
        } catch {
          restored = false;
        }
      } else {
        try {
          await this.ctx.runSql('ROLLBACK');
          restored = true;
        } catch {
          restored = false;
        }
      }
      if (restored) {
        await this.tableCommits
          .updateCommitState(journalId, 'failed', message)
          .catch(() => undefined);
      } else {
        await this.tableCommits
          .updateCommitState(
            journalId,
            physicalCommitted ? 'data_committed' : 'prepared',
            `commit failed and restore also failed; pending recovery: ${message}`
          )
          .catch(() => undefined);
      }
      throw error;
    }

    if (backupTable) {
      await this.ctx.dropTableIfExists(backupTable).catch(() => undefined);
    }
    await this.ctx.dropTableIfExists(input.stagingTable).catch(() => undefined);
    await this.tableCommits.updateCommitState(journalId, 'completed').catch(() => undefined);
    try {
      this.onTableCommitted?.(input.rawTableId, input.operation);
    } catch {
      // Listener errors must never fail the commit.
    }
  }
  private async restoreTableCommit(input: {
    targetTable: string;
    backupTable: string | null;
    targetExisted: boolean;
  }): Promise<void> {
    await this.ctx.runSql('BEGIN TRANSACTION');
    try {
      if (input.targetExisted && input.backupTable) {
        if (await this.ctx.physicalTableExists(input.backupTable)) {
          await this.ctx.dropTableIfExists(input.targetTable);
          await this.ctx.runSql(
            `ALTER TABLE ${quoteIdentifier(input.backupTable)} RENAME TO ${quoteIdentifier(input.targetTable)}`
          );
        }
      } else {
        await this.ctx.dropTableIfExists(input.targetTable);
      }
      await this.ctx.runSql('COMMIT');
    } catch (error) {
      await this.ctx.runSql('ROLLBACK').catch(() => undefined);
      throw error;
    }
  }
  /**
   * Startup recovery for interrupted table commits (crash between the
   * physical swap and the metadata commit). 'metadata_committed' rows only
   * need leftover tables dropped; 'prepared'/'data_committed' rows get the
   * pre-commit physical state restored. Registered as a post-ready hook.
   */
  async recoverPendingTableCommits(): Promise<void> {
    const rows = await this.tableCommits.listPendingCommits();
    for (const row of rows) {
      const targetTable = String(row.target_table);
      const backupTable = row.backup_table ? String(row.backup_table) : null;
      const targetExisted = toNumber(row.target_existed) === 1;
      if (row.state === 'metadata_committed') {
        if (backupTable) {
          await this.ctx.dropTableIfExists(backupTable).catch(() => undefined);
        }
        await this.ctx.dropTableIfExists(String(row.staging_table)).catch(() => undefined);
        await this.tableCommits.updateCommitState(String(row.id), 'completed');
        continue;
      }
      await this.restoreTableCommit({ targetTable, backupTable, targetExisted });
      await this.ctx.dropTableIfExists(String(row.staging_table)).catch(() => undefined);
      await this.tableCommits.updateCommitState(
        String(row.id),
        'failed',
        'Recovered an interrupted table commit by restoring the previous table'
      );
    }
  }
  async previewRawTableSource(input: DataPreviewRawTableSourceInput): Promise<DataRawTablePreview> {
    // Builds and drops TEMP tables on the shared connection — DDL must
    // serialize with commits, so previews hold the exclusive section.
    return this.ctx.runExclusive(
      () => this.previewRawTableSourceUnsafe(input),
      `previewRawTableSource:${input.filePath ?? 'rawTable'}`
    );
  }
  private async previewRawTableSourceUnsafe(
    input: DataPreviewRawTableSourceInput
  ): Promise<DataRawTablePreview> {
    await this.ctx.ensureReady();
    const sourcePath = normalizeImportSourcePath(input.filePath);
    const sourceKind = normalizeRawTableSourceKind(input.sourceKind, sourcePath);
    const config = normalizeRawTableConfig(input.config, sourceKind, sourcePath);
    const limit = normalizePreviewLimit(input.limit);
    const offset = normalizePreviewOffset(input.offset);
    if (config.dataProcessing?.strategy === 'customize') {
      return this.normalizerService.previewPublishedRawTableNormalizerVersion({
        sourcePath,
        sourceKind,
        config,
        limit,
        offset,
      });
    }
    const tempTables: string[] = [];
    let previewTable: string | null = null;
    try {
      const importFiles = getImportSourceFiles(sourcePath, sourceKind, config);
      const forceVarchar = sourceKind === 'folder';
      for (const [index, filePath] of importFiles.entries()) {
        const tempTable = tableNameFromId('rawTable_preview', `${uuidv4()}_${index}`);
        tempTables.push(tempTable);
        await this.createImportTempTable(tempTable, filePath, index, forceVarchar, config);
        if (sourceKind === 'folder') {
          const folderConfig = config.sourceKind === 'folder' ? config : defaultFolderConfig();
          if (folderConfig.skipEmptyFiles && (await this.ctx.countRows(tempTable)) === 0) {
            await this.ctx.dropTableIfExists(tempTable);
            tempTables.pop();
            continue;
          }
          if (folderConfig.keepSourceFileName) {
            await this.appendSourceFileNameColumn(tempTable, filePath);
          }
        }
      }
      if (tempTables.length === 0) {
        throw new Error('No Excel or Csv files were found for the input table');
      }

      const unionSql = buildUnionSqlFromTempTables(tempTables);
      previewTable = tableNameFromId('rawTable_preview_union', uuidv4());
      await this.ctx.runSql(`CREATE TEMP TABLE ${quoteIdentifier(previewTable)} AS ${unionSql}`);
      const countRows = await this.ctx.queryRows<{ count: number | string }>(
        `SELECT count(*) AS count FROM ${quoteIdentifier(previewTable)}`
      );
      const totalRows = toNumber(countRows[0]?.count);
      const rows = await this.ctx.queryRows<Record<string, unknown>>(
        `SELECT * FROM ${quoteIdentifier(previewTable)} LIMIT ${limit} OFFSET ${offset}`
      );
      const columns = await this.ctx.getTableColumns(previewTable);
      return {
        columns,
        columnTypes: await this.ctx.inferTableColumnTypes(previewTable),
        rows: rows.map(normalizePreviewRow),
        fileCount: tempTables.length,
        limit,
        offset,
        totalRows,
      };
    } finally {
      if (previewTable) {
        await this.ctx.dropTableIfExists(previewTable).catch(() => undefined);
      }
      for (const tempTable of tempTables) {
        await this.ctx.dropTableIfExists(tempTable).catch(() => undefined);
      }
    }
  }
  async previewRawTable(input: DataPreviewRawTableInput): Promise<DataRawTablePreview> {
    await this.ctx.ensureMetadataReady();
    const rawTable = await this.rawTables.requireRawTable(input.id);
    await this.ctx.ensureReady();
    const limit = normalizePreviewLimit(input.limit);
    const offset = normalizePreviewOffset(input.offset);
    const tableName = quoteIdentifier(rawTable.tableName);
    if (!(await this.ctx.physicalTableExists(rawTable.tableName))) {
      return {
        columns: [],
        columnTypes: [],
        rows: [],
        fileCount: rawTable.fileCount,
        limit,
        offset,
        totalRows: 0,
      };
    }
    const countRows = await this.ctx.queryRows<{ count: number | string }>(
      `SELECT count(*) AS count FROM ${tableName}`
    );
    const rows = await this.ctx.queryRows<Record<string, unknown>>(
      `SELECT * FROM ${tableName} LIMIT ${limit} OFFSET ${offset}`
    );
    return {
      columns: await this.ctx.getTableColumns(rawTable.tableName),
      columnTypes: await this.ctx.getTableColumnTypes(rawTable.tableName),
      rows: rows.map(normalizePreviewRow),
      fileCount: rawTable.fileCount,
      limit,
      offset,
      totalRows: toNumber(countRows[0]?.count),
    };
  }
  async exportRawTableCsv(input: {
    tableKind: 'raw' | 'result';
    id: string;
    maxRows?: number;
  }): Promise<DataRawTableCsvExport> {
    await this.ctx.ensureMetadataReady();
    const rawTable =
      input.tableKind === 'result'
        ? await this.rawTables.requireResultTable(input.id)
        : await this.rawTables.requireInputRawTable(input.id);
    await this.ctx.ensureReady();
    if (!(await this.ctx.physicalTableExists(rawTable.tableName))) {
      throw new Error(`Data table is not materialized: ${input.id}`);
    }

    const rowCount = await this.ctx.countRows(rawTable.tableName);
    const maxRows = normalizeCsvExportMaxRows(input.maxRows);
    if (rowCount > maxRows) {
      throw new Error(`Data table has ${rowCount} rows, above export limit ${maxRows}`);
    }

    const columns = await this.ctx.getTableColumns(rawTable.tableName);
    const rows = await this.ctx.queryRows<Record<string, unknown>>(
      `SELECT * FROM ${quoteIdentifier(rawTable.tableName)}`
    );
    const csv = [
      columns.map(csvCell).join(','),
      ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
    ].join('\n');

    return {
      tableKind: input.tableKind,
      id: rawTable.id,
      name: rawTable.name,
      tableName: rawTable.tableName,
      columns,
      rowCount,
      columnCount: columns.length,
      csv: `${csv}\n`,
    };
  }
  async deleteRawTable(id: string): Promise<boolean> {
    return this.ctx.runExclusive(async () => {
      await this.ctx.ensureReady();
      const rawTable = await this.rawTables.getRawTable(id);
      if (!rawTable) {
        return false;
      }
      // Physical drop first: if the process dies before the row delete, the
      // leftover metadata row is a ghost that deleteRawTable can retry. The
      // reverse order would orphan an invisible physical table.
      await this.ctx.dropTableIfExists(rawTable.tableName);
      await this.rawTables.deleteRawTableRow(id);
      return true;
    }, `deleteRawTable:${id}`);
  }
  async createRawTableTableFromSource(
    tableName: string,
    sourcePath: string,
    sourceKind: DataRawTableSourceKind,
    inputConfig?: DataRawTableConfig
  ): Promise<PreparedRawTableImport> {
    const config = normalizeRawTableConfig(inputConfig, sourceKind, sourcePath);
    if (config.dataProcessing?.strategy === 'customize') {
      return this.normalizerService.createRawTableTableFromPublishedNormalizer(
        tableName,
        sourcePath,
        sourceKind,
        config
      );
    }
    const tempTables: string[] = [];
    try {
      const importFiles = getImportSourceFiles(sourcePath, sourceKind, config);
      const forceVarchar = sourceKind === 'folder';
      for (const [index, filePath] of importFiles.entries()) {
        const tempTable = tableNameFromId('rawTable_import', `${uuidv4()}_${index}`);
        tempTables.push(tempTable);
        await this.createImportTempTable(tempTable, filePath, index, forceVarchar, config);
        if (sourceKind === 'folder') {
          const folderConfig = config.sourceKind === 'folder' ? config : defaultFolderConfig();
          if (folderConfig.skipEmptyFiles && (await this.ctx.countRows(tempTable)) === 0) {
            await this.ctx.dropTableIfExists(tempTable);
            tempTables.pop();
            continue;
          }
          if (folderConfig.keepSourceFileName) {
            await this.appendSourceFileNameColumn(tempTable, filePath);
          }
        }
      }

      await this.createRawTableTableFromTempTables(tableName, tempTables);
      const rowCount = await this.ctx.countRows(tableName);
      const columnCount = (await this.ctx.getTableColumns(tableName)).length;
      return {
        rowCount,
        columnCount,
        fileCount: tempTables.length,
        config,
      };
    } finally {
      for (const tempTable of tempTables) {
        await this.ctx.dropTableIfExists(tempTable).catch(() => undefined);
      }
    }
  }
  async createImportTempTable(
    tableName: string,
    filePath: string,
    index: number,
    forceVarchar: boolean,
    config: DataRawTableConfig
  ): Promise<void> {
    const columnTypeOverrides =
      config.sourceKind === 'cloud' ? undefined : config.columnTypeOverrides;
    if (isExcelFile(filePath)) {
      const workbookConfig = config.sourceKind === 'excel' ? config : defaultExcelConfig(filePath);
      await this.createTempTableFromWorkbookRows(
        tableName,
        parseWorkbookRows(filePath, workbookConfig),
        columnTypeOverrides
      );
      return;
    }

    const parameterName = `sourcePath${index}`;
    const relation = readImportRelationForPath(filePath, parameterName, forceVarchar);
    const castClauses = (columnTypeOverrides ?? []).map(
      (override) =>
        `TRY_CAST(${quoteValueIdentifier(override.name)} AS ${duckDbTypeForDataFieldType(override.type)}) AS ${quoteValueIdentifier(override.name)}`
    );
    const selectSql =
      castClauses.length > 0
        ? `SELECT * REPLACE (${castClauses.join(', ')}) FROM ${relation}`
        : `SELECT * FROM ${relation}`;
    await this.ctx.runSql(`CREATE TEMP TABLE ${quoteIdentifier(tableName)} AS ${selectSql}`, {
      [parameterName]: filePath,
    });
  }
  async appendSourceFileNameColumn(tableName: string, filePath: string): Promise<void> {
    const existingColumns = new Set(
      (await this.ctx.getTableColumns(tableName)).map((column) => column.toLowerCase())
    );
    let columnName = 'source_file_name';
    let suffix = 2;
    while (existingColumns.has(columnName.toLowerCase())) {
      columnName = `source_file_name_${suffix}`;
      suffix += 1;
    }
    await this.ctx.runSql(
      `ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteValueIdentifier(columnName)} VARCHAR`
    );
    await this.ctx.runSql(
      `UPDATE ${quoteIdentifier(tableName)} SET ${quoteValueIdentifier(columnName)} = $sourceFileName`,
      { sourceFileName: basename(filePath) }
    );
  }
  async createTempTableFromWorkbookRows(
    tableName: string,
    parsed: ParsedWorkbookRows,
    columnTypeOverrides?: DataRawTableColumnTypeOverride[]
  ): Promise<void> {
    if (parsed.columns.length === 0) {
      throw new Error('Excel workbook has no readable columns');
    }

    const overrideMap = new Map(
      (columnTypeOverrides ?? []).map((override) => [override.name, override.type])
    );
    const inferredTypes = inferWorkbookColumnTypes(parsed);
    const resolvedTypes = parsed.columns.map(
      (column, index) => overrideMap.get(column) ?? inferredTypes[index]
    );
    const columnSql = parsed.columns
      .map(
        (column, index) =>
          `${quoteValueIdentifier(column)} ${duckDbTypeForDataFieldType(resolvedTypes[index])}`
      )
      .join(', ');
    await this.ctx.runSql(`CREATE TEMP TABLE ${quoteIdentifier(tableName)} (${columnSql})`);

    if (parsed.rows.length === 0) {
      return;
    }

    const columnList = parsed.columns.map(quoteValueIdentifier).join(', ');
    const placeholders = parsed.columns
      .map((column, index) =>
        overrideMap.has(column)
          ? `TRY_CAST($value${index} AS ${duckDbTypeForDataFieldType(resolvedTypes[index])})`
          : `$value${index}`
      )
      .join(', ');
    const sql = `INSERT INTO ${quoteIdentifier(tableName)} (${columnList}) VALUES (${placeholders})`;
    for (const row of parsed.rows) {
      const values: Record<string, string | number | null> = {};
      for (let index = 0; index < parsed.columns.length; index += 1) {
        const value = row[index];
        values[`value${index}`] = normalizeWorkbookValueForDuckDb(value, resolvedTypes[index]);
      }
      await this.ctx.runSql(sql, values);
    }
  }
  async createRawTableTableFromTempTables(tableName: string, tempTables: string[]): Promise<void> {
    if (tempTables.length === 0) {
      throw new Error('No Excel or Csv files were found for the input table');
    }

    const unionSql = buildUnionSqlFromTempTables(tempTables);
    const unionTable = tableNameFromId('rawTable_import_union', uuidv4());
    try {
      await this.ctx.runSql(`CREATE TEMP TABLE ${quoteIdentifier(unionTable)} AS ${unionSql}`);
      await this.ctx.createTypedTableFromRelation(tableName, unionTable);
    } finally {
      await this.ctx.dropTableIfExists(unionTable).catch(() => undefined);
    }
  }
}
