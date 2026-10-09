/** Input/output table materialization: import, update, preview, export. */
import type {
  DataInputTableConfig,
  DataInputTablePreview,
  DataInputTableSourceKind,
  DataDataset,
  DataImportDatasetInput,
  DataOutputTable,
  DataPreviewDatasetInput,
  DataPreviewInputTableInput,
  DataUpdateDatasetInput,
  DataUpdateOutputTableInput,
} from '../../../../shared/contracts';
import { duckDbTypeForDataFieldType } from '../../../../shared/data-field-types';
import { quoteIdentifier, toNumber, quoteValueIdentifier } from '../../operators';
import { DataStoreContext } from '../data-store-context';
import {
  outputTableConfigJson,
  tableNameFromId,
  DataDatasetCsvExport,
} from '../data-store-records';
import {
  normalizeImportSourcePath,
  normalizeInputTableConfig,
  normalizeInputTableSourceKind,
  normalizePreviewLimit,
  normalizePreviewOffset,
  normalizePreviewRow,
  PreparedInputTableImport,
  buildUnionSqlFromTempTables,
  csvCell,
  datasetNameFromPath,
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
import { DatasetRepository } from '../repositories/dataset-repository';
import { TableCommitJournal } from '../repositories/table-commit-journal';
import { NormalizerService } from './normalizer-service';
import { basename } from 'path';
import { v4 as uuidv4 } from 'uuid';

export class InputTableService {
  constructor(
    private readonly ctx: DataStoreContext,
    private readonly datasets: DatasetRepository,
    private readonly normalizerService: NormalizerService,
    private readonly tableCommits: TableCommitJournal
  ) {}
  async importDataset(input: DataImportDatasetInput): Promise<DataDataset> {
    return this.ctx.runExclusive(() => this.importDatasetUnsafe(input), 'importDataset');
  }
  private async importDatasetUnsafe(input: DataImportDatasetInput): Promise<DataDataset> {
    await this.ctx.ensureReady();
    const sourcePath = normalizeImportSourcePath(input.filePath);
    const id = uuidv4();
    const tableName = tableNameFromId('dataset', id);
    try {
      const sourceKind = normalizeInputTableSourceKind(input.sourceKind, sourcePath);
      const prepared = await this.createDatasetTableFromSource(
        tableName,
        sourcePath,
        sourceKind,
        input.config
      );
      const now = this.ctx.now();
      const name = input.name?.trim() || datasetNameFromPath(sourcePath);
      await this.datasets.insertDataset({
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
      return this.datasets.requireDataset(id);
    } catch (error) {
      await this.ctx.dropTableIfExists(tableName);
      throw error;
    }
  }
  async updateDataset(input: DataUpdateDatasetInput): Promise<DataDataset> {
    return this.ctx.runExclusive(
      () => this.updateDatasetUnsafe(input),
      `updateDataset:${input.id}`
    );
  }
  private async updateDatasetUnsafe(input: DataUpdateDatasetInput): Promise<DataDataset> {
    await this.ctx.ensureMetadataReady();
    const dataset = await this.datasets.requireDataset(input.id);
    // A cloud binding must be materialized by the cloud import service first.
    // A config-only save may change processing settings, never relabel stale rows.
    if (!input.filePath && input.config?.sourceKind === 'cloud') {
      const previous =
        dataset.inputConfig.sourceKind === 'cloud' || dataset.inputConfig.sourceKind === 'csv'
          ? dataset.inputConfig.cloudMirror
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
        ? dataset.sourcePath
        : null;

    if (!sourcePath) {
      if (name && name !== dataset.name) {
        await this.datasets.renameDataset(dataset.id, name, this.ctx.now());
      }
      return this.datasets.requireDataset(dataset.id);
    }

    const replacementTable = tableNameFromId('dataset_update', uuidv4());
    try {
      await this.ctx.ensureReady();
      const sourceKind = normalizeInputTableSourceKind(
        input.sourceKind ?? dataset.sourceKind,
        sourcePath
      );
      const prepared = await this.createDatasetTableFromSource(
        replacementTable,
        sourcePath,
        sourceKind,
        input.config ?? dataset.inputConfig
      );
      const now = this.ctx.now();
      await this.commitStagedTable({
        datasetId: dataset.id,
        operation: 'reimport',
        stagingTable: replacementTable,
        targetTable: dataset.tableName,
        writeMetadata: () =>
          this.datasets.updateDatasetAfterReimport({
            id: dataset.id,
            name: name || dataset.name,
            sourcePath,
            sourceKind,
            configJson: JSON.stringify(prepared.config),
            fileCount: prepared.fileCount,
            rowCount: prepared.rowCount,
            columnCount: prepared.columnCount,
            updatedAt: now,
          }),
      });
      return this.datasets.requireDataset(dataset.id);
    } catch (error) {
      await this.ctx.dropTableIfExists(replacementTable).catch(() => undefined);
      throw error;
    }
  }
  async updateOutputTable(input: DataUpdateOutputTableInput): Promise<DataOutputTable> {
    return this.ctx.runExclusive(
      () => this.updateOutputTableUnsafe(input),
      `updateOutputTable:${input.id}`
    );
  }
  private async updateOutputTableUnsafe(
    input: DataUpdateOutputTableInput
  ): Promise<DataOutputTable> {
    await this.ctx.ensureMetadataReady();
    const outputTable = await this.datasets.requireOutputTable(input.id);
    const name = input.name?.trim();
    const nextName = name && name !== outputTable.name ? name : null;
    const hasSourceDatasetChange =
      Object.prototype.hasOwnProperty.call(input, 'sourceDatasetId') &&
      (input.sourceDatasetId ?? null) !== outputTable.sourceDatasetId;

    if (!nextName && !hasSourceDatasetChange) {
      return outputTable;
    }

    if (hasSourceDatasetChange && input.sourceDatasetId) {
      const sourceDataset = await this.datasets.requireInputDataset(input.sourceDatasetId);
      await this.ctx.ensureReady();
      if (!(await this.ctx.physicalTableExists(sourceDataset.tableName))) {
        throw new Error(`Input table is not materialized: ${sourceDataset.id}`);
      }
      const stagingTable = tableNameFromId('output_rebind', uuidv4());
      try {
        await this.ctx.runSql(
          `CREATE TABLE ${quoteIdentifier(stagingTable)} AS SELECT * FROM ${quoteIdentifier(
            sourceDataset.tableName
          )}`
        );
        const rowCount = await this.ctx.countRows(stagingTable);
        const columnCount = (await this.ctx.getTableColumns(stagingTable)).length;
        await this.commitStagedTable({
          datasetId: outputTable.id,
          operation: 'rebind_output',
          stagingTable,
          targetTable: outputTable.tableName,
          writeMetadata: () =>
            this.datasets.updateOutputTableForSource({
              id: outputTable.id,
              name: nextName,
              sourcePath: `input-table://${sourceDataset.id}`,
              configJson: outputTableConfigJson(sourceDataset.id, outputTable.cloudAction),
              rowCount,
              columnCount,
              updatedAt: this.ctx.now(),
            }),
        });
      } catch (error) {
        await this.ctx.dropTableIfExists(stagingTable).catch(() => undefined);
        throw error;
      }
      return this.datasets.requireOutputTable(input.id);
    }

    if (hasSourceDatasetChange) {
      await this.datasets.updateOutputTableMetadata({
        id: outputTable.id,
        name: nextName,
        sourcePath: `duckdb://outputs/${outputTable.tableName}`,
        configJson: outputTableConfigJson(undefined, outputTable.cloudAction),
        updatedAt: this.ctx.now(),
      });
      return this.datasets.requireOutputTable(input.id);
    }

    if (nextName) {
      await this.datasets.renameDataset(outputTable.id, nextName, this.ctx.now());
    }
    return this.datasets.requireOutputTable(input.id);
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
    datasetId: string;
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
      datasetId: input.datasetId,
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
      // flips atomically with the dataset row it describes.
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
  async previewInputTable(input: DataPreviewInputTableInput): Promise<DataInputTablePreview> {
    // Builds and drops TEMP tables on the shared connection — DDL must
    // serialize with commits, so previews hold the exclusive section.
    return this.ctx.runExclusive(
      () => this.previewInputTableUnsafe(input),
      `previewInputTable:${input.filePath ?? 'dataset'}`
    );
  }
  private async previewInputTableUnsafe(
    input: DataPreviewInputTableInput
  ): Promise<DataInputTablePreview> {
    await this.ctx.ensureReady();
    const sourcePath = normalizeImportSourcePath(input.filePath);
    const sourceKind = normalizeInputTableSourceKind(input.sourceKind, sourcePath);
    const config = normalizeInputTableConfig(input.config, sourceKind, sourcePath);
    const limit = normalizePreviewLimit(input.limit);
    const offset = normalizePreviewOffset(input.offset);
    if (config.dataProcessing?.strategy === 'customize') {
      return this.normalizerService.previewPublishedInputTableNormalizerVersion({
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
        const tempTable = tableNameFromId('dataset_preview', `${uuidv4()}_${index}`);
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
        throw new Error('No Excel or CSV files were found for the input table');
      }

      const unionSql = buildUnionSqlFromTempTables(tempTables);
      previewTable = tableNameFromId('dataset_preview_union', uuidv4());
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
  async previewDataset(input: DataPreviewDatasetInput): Promise<DataInputTablePreview> {
    await this.ctx.ensureMetadataReady();
    const dataset = await this.datasets.requireDataset(input.id);
    await this.ctx.ensureReady();
    const limit = normalizePreviewLimit(input.limit);
    const offset = normalizePreviewOffset(input.offset);
    const tableName = quoteIdentifier(dataset.tableName);
    if (!(await this.ctx.physicalTableExists(dataset.tableName))) {
      return {
        columns: [],
        columnTypes: [],
        rows: [],
        fileCount: dataset.fileCount,
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
      columns: await this.ctx.getTableColumns(dataset.tableName),
      columnTypes: await this.ctx.getTableColumnTypes(dataset.tableName),
      rows: rows.map(normalizePreviewRow),
      fileCount: dataset.fileCount,
      limit,
      offset,
      totalRows: toNumber(countRows[0]?.count),
    };
  }
  async exportDatasetCsv(input: {
    tableKind: 'input' | 'output';
    id: string;
    maxRows?: number;
  }): Promise<DataDatasetCsvExport> {
    await this.ctx.ensureMetadataReady();
    const dataset =
      input.tableKind === 'output'
        ? await this.datasets.requireOutputTable(input.id)
        : await this.datasets.requireInputDataset(input.id);
    await this.ctx.ensureReady();
    if (!(await this.ctx.physicalTableExists(dataset.tableName))) {
      throw new Error(`Data table is not materialized: ${input.id}`);
    }

    const rowCount = await this.ctx.countRows(dataset.tableName);
    const maxRows = normalizeCsvExportMaxRows(input.maxRows);
    if (rowCount > maxRows) {
      throw new Error(`Data table has ${rowCount} rows, above export limit ${maxRows}`);
    }

    const columns = await this.ctx.getTableColumns(dataset.tableName);
    const rows = await this.ctx.queryRows<Record<string, unknown>>(
      `SELECT * FROM ${quoteIdentifier(dataset.tableName)}`
    );
    const csv = [
      columns.map(csvCell).join(','),
      ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
    ].join('\n');

    return {
      tableKind: input.tableKind,
      id: dataset.id,
      name: dataset.name,
      tableName: dataset.tableName,
      columns,
      rowCount,
      columnCount: columns.length,
      csv: `${csv}\n`,
    };
  }
  async deleteDataset(id: string): Promise<boolean> {
    return this.ctx.runExclusive(async () => {
      await this.ctx.ensureReady();
      const dataset = await this.datasets.getDataset(id);
      if (!dataset) {
        return false;
      }
      // Physical drop first: if the process dies before the row delete, the
      // leftover metadata row is a ghost that deleteDataset can retry. The
      // reverse order would orphan an invisible physical table.
      await this.ctx.dropTableIfExists(dataset.tableName);
      await this.datasets.deleteDatasetRow(id);
      return true;
    }, `deleteDataset:${id}`);
  }
  async createDatasetTableFromSource(
    tableName: string,
    sourcePath: string,
    sourceKind: DataInputTableSourceKind,
    inputConfig?: DataInputTableConfig
  ): Promise<PreparedInputTableImport> {
    const config = normalizeInputTableConfig(inputConfig, sourceKind, sourcePath);
    if (config.dataProcessing?.strategy === 'customize') {
      return this.normalizerService.createDatasetTableFromPublishedNormalizer(
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
        const tempTable = tableNameFromId('dataset_import', `${uuidv4()}_${index}`);
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

      await this.createDatasetTableFromTempTables(tableName, tempTables);
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
    config: DataInputTableConfig
  ): Promise<void> {
    if (isExcelFile(filePath)) {
      const workbookConfig = config.sourceKind === 'excel' ? config : defaultExcelConfig(filePath);
      await this.createTempTableFromWorkbookRows(
        tableName,
        parseWorkbookRows(filePath, workbookConfig)
      );
      return;
    }

    const parameterName = `sourcePath${index}`;
    const relation = readImportRelationForPath(filePath, parameterName, forceVarchar);
    await this.ctx.runSql(
      `CREATE TEMP TABLE ${quoteIdentifier(tableName)} AS SELECT * FROM ${relation}`,
      {
        [parameterName]: filePath,
      }
    );
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
    parsed: ParsedWorkbookRows
  ): Promise<void> {
    if (parsed.columns.length === 0) {
      throw new Error('Excel workbook has no readable columns');
    }

    const inferredTypes = inferWorkbookColumnTypes(parsed);
    const columnSql = parsed.columns
      .map(
        (column, index) =>
          `${quoteValueIdentifier(column)} ${duckDbTypeForDataFieldType(inferredTypes[index])}`
      )
      .join(', ');
    await this.ctx.runSql(`CREATE TEMP TABLE ${quoteIdentifier(tableName)} (${columnSql})`);

    if (parsed.rows.length === 0) {
      return;
    }

    const columnList = parsed.columns.map(quoteValueIdentifier).join(', ');
    const placeholders = parsed.columns.map((_, index) => `$value${index}`).join(', ');
    const sql = `INSERT INTO ${quoteIdentifier(tableName)} (${columnList}) VALUES (${placeholders})`;
    for (const row of parsed.rows) {
      const values: Record<string, string | number | null> = {};
      for (let index = 0; index < parsed.columns.length; index += 1) {
        const value = row[index];
        values[`value${index}`] = normalizeWorkbookValueForDuckDb(value, inferredTypes[index]);
      }
      await this.ctx.runSql(sql, values);
    }
  }
  async createDatasetTableFromTempTables(tableName: string, tempTables: string[]): Promise<void> {
    if (tempTables.length === 0) {
      throw new Error('No Excel or CSV files were found for the input table');
    }

    const unionSql = buildUnionSqlFromTempTables(tempTables);
    const unionTable = tableNameFromId('dataset_import_union', uuidv4());
    try {
      await this.ctx.runSql(`CREATE TEMP TABLE ${quoteIdentifier(unionTable)} AS ${unionSql}`);
      await this.ctx.createTypedTableFromRelation(tableName, unionTable);
    } finally {
      await this.ctx.dropTableIfExists(unionTable).catch(() => undefined);
    }
  }
}
