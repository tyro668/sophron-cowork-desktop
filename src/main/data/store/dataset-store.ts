import { basename } from 'path';
import { v4 as uuidv4 } from 'uuid';
import type {
  DataCreateOutputTableInput,
  DataDataset,
  DataImportDatasetInput,
  DataInputTableConfig,
  DataInputTablePreview,
  DataInputTableSourceKind,
  DataInputTableSourceSummary,
  DataOutputTable,
  DataPreviewDatasetInput,
  DataPreviewInputTableInput,
  DataSummarizeInputTableSourceInput,
  DataUpdateDatasetInput,
  DataUpdateOutputTableInput,
} from '../../../shared/contracts';
import { duckDbTypeForDataFieldType } from '../../../shared/data-field-types';
import { quoteIdentifier, quoteValueIdentifier, toNumber } from '../operators';
import {
  DataDatasetCsvExport,
  DataDatasetRow,
  mapDatasetRow,
  mapOutputTableRow,
  OUTPUT_TABLE_CONFIG_KIND,
  outputTableConfigJson,
  outputTableConfigPredicateSql,
  storedDatasetSourceKindSql,
  tableNameFromId,
} from './data-store-records';
import {
  buildUnionSqlFromTempTables,
  clampSummaryLimit,
  createStableJsonHash,
  csvCell,
  datasetNameFromPath,
  defaultExcelConfig,
  defaultFolderConfig,
  getImportSourceFiles,
  inferWorkbookColumnTypes,
  isExcelFile,
  normalizeCsvExportMaxRows,
  normalizeImportSourcePath,
  normalizeInputTableConfig,
  normalizeInputTableSourceKind,
  normalizePreviewLimit,
  normalizePreviewOffset,
  normalizePreviewRow,
  normalizeWorkbookValueForDuckDb,
  ParsedWorkbookRows,
  parseWorkbookRows,
  PreparedInputTableImport,
  readImportRelationForPath,
  summarizeInputTableFile,
} from './input-source';
import { NormalizerStore } from './normalizer-store';

export abstract class DatasetStore extends NormalizerStore {
  async importDataset(input: DataImportDatasetInput): Promise<DataDataset> {
    return this.runExclusive(() => this.importDatasetUnsafe(input), 'importDataset');
  }

  protected async importDatasetUnsafe(input: DataImportDatasetInput): Promise<DataDataset> {
    await this.ensureReady();
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
      const now = this.now();
      const name = input.name?.trim() || datasetNameFromPath(sourcePath);
      await this.metaRunSql(
        `
            INSERT INTO data_datasets (
              id, name, source_path, source_kind, config_json, file_count,
              table_name, row_count, column_count, created_at, updated_at
            )
            VALUES (
              $id, $name, $sourcePath, $sourceKind, $configJson, $fileCount,
              $tableName, $rowCount, $columnCount, $createdAt, $updatedAt
            )
          `,
        {
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
        }
      );
      return this.requireDataset(id);
    } catch (error) {
      await this.dropTableIfExists(tableName);
      throw error;
    }
  }

  async summarizeInputTableSource(
    input: DataSummarizeInputTableSourceInput
  ): Promise<DataInputTableSourceSummary> {
    const sourcePath = normalizeImportSourcePath(input.sourcePath);
    const sourceKind = normalizeInputTableSourceKind(input.sourceKind, sourcePath);
    const config = normalizeInputTableConfig(input.config, sourceKind, sourcePath);
    const maxFiles = clampSummaryLimit(input.maxFiles, 1, 20, 8);
    const maxSheetsPerFile = clampSummaryLimit(input.maxSheetsPerFile, 1, 12, 6);
    const maxRowsPerSheet = clampSummaryLimit(input.maxRowsPerSheet, 1, 20, 8);
    const maxColumnsPerRow = clampSummaryLimit(input.maxColumnsPerRow, 1, 80, 16);
    const allFiles = getImportSourceFiles(sourcePath, sourceKind, config);
    const sampledFiles = allFiles.slice(0, maxFiles);
    const files = sampledFiles.map((filePath) =>
      summarizeInputTableFile(filePath, sourcePath, {
        maxSheetsPerFile,
        maxRowsPerSheet,
        maxColumnsPerRow,
      })
    );
    const notes: string[] = [];
    if (allFiles.length > sampledFiles.length) {
      notes.push(`Sampled ${sampledFiles.length} of ${allFiles.length} files.`);
    }
    for (const file of files) {
      if (file.warning) {
        notes.push(`${file.relativePath}: ${file.warning}`);
      }
    }
    const hashPayload = {
      sourcePath,
      sourceKind,
      fileCount: allFiles.length,
      files,
    };
    return {
      sourcePath,
      sourceKind,
      generatedAt: this.now(),
      hash: createStableJsonHash(hashPayload),
      fileCount: allFiles.length,
      sampledFileCount: files.length,
      truncated: allFiles.length > sampledFiles.length,
      notes,
      files,
    };
  }

  async updateDataset(input: DataUpdateDatasetInput): Promise<DataDataset> {
    return this.runExclusive(() => this.updateDatasetUnsafe(input), `updateDataset:${input.id}`);
  }

  protected async updateDatasetUnsafe(input: DataUpdateDatasetInput): Promise<DataDataset> {
    await this.ensureMetadataReady();
    const dataset = await this.requireDataset(input.id);
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
        await this.metaRunSql(
          `
              UPDATE data_datasets
              SET name = $name,
                  updated_at = $updatedAt
              WHERE id = $id
            `,
          {
            id: dataset.id,
            name,
            updatedAt: this.now(),
          }
        );
      }
      return this.requireDataset(dataset.id);
    }

    const replacementTable = tableNameFromId('dataset_update', uuidv4());
    try {
      await this.ensureReady();
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
      const now = this.now();
      await this.runSql('BEGIN TRANSACTION');
      try {
        await this.dropTableIfExists(dataset.tableName);
        await this.runSql(
          `ALTER TABLE ${quoteIdentifier(replacementTable)} RENAME TO ${quoteIdentifier(dataset.tableName)}`
        );
        await this.runSql('COMMIT');
        await this.metaRunSql(
          `
              UPDATE data_datasets
              SET name = $name,
                  source_path = $sourcePath,
                  source_kind = $sourceKind,
                  config_json = $configJson,
                  file_count = $fileCount,
                  row_count = $rowCount,
                  column_count = $columnCount,
                  updated_at = $updatedAt
              WHERE id = $id
            `,
          {
            id: dataset.id,
            name: name || dataset.name,
            sourcePath,
            sourceKind,
            configJson: JSON.stringify(prepared.config),
            fileCount: prepared.fileCount,
            rowCount: prepared.rowCount,
            columnCount: prepared.columnCount,
            updatedAt: now,
          }
        );
      } catch (error) {
        await this.runSql('ROLLBACK').catch(() => undefined);
        throw error;
      }
      return this.requireDataset(dataset.id);
    } catch (error) {
      await this.dropTableIfExists(replacementTable).catch(() => undefined);
      throw error;
    }
  }

  async createOutputTable(input: DataCreateOutputTableInput = {}): Promise<DataOutputTable> {
    await this.ensureMetadataReady();
    return this.createOutputTableMetadata(input.name?.trim() || 'Output table', this.now());
  }

  protected async createOutputTableMetadata(
    name: string,
    timestamp: number
  ): Promise<DataOutputTable> {
    const id = uuidv4();
    const tableName = tableNameFromId('output', id);
    await this.metaRunSql(
      `
          INSERT INTO data_datasets (
            id, name, source_path, source_kind, config_json, file_count,
            table_name, row_count, column_count, created_at, updated_at
          )
          VALUES (
            $id, $name, $sourcePath, 'output', $configJson, 0,
            $tableName, 0, 0, $createdAt, $updatedAt
          )
        `,
      {
        id,
        name,
        sourcePath: `duckdb://outputs/${tableName}`,
        configJson: outputTableConfigJson(),
        tableName,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
    );
    return this.requireOutputTable(id);
  }

  async updateOutputTable(input: DataUpdateOutputTableInput): Promise<DataOutputTable> {
    await this.ensureMetadataReady();
    const outputTable = await this.requireOutputTable(input.id);
    const name = input.name?.trim();
    const nextName = name && name !== outputTable.name ? name : null;
    const hasSourceDatasetChange =
      Object.prototype.hasOwnProperty.call(input, 'sourceDatasetId') &&
      (input.sourceDatasetId ?? null) !== outputTable.sourceDatasetId;

    if (!nextName && !hasSourceDatasetChange) {
      return outputTable;
    }

    if (hasSourceDatasetChange && input.sourceDatasetId) {
      const sourceDataset = await this.requireInputDataset(input.sourceDatasetId);
      await this.ensureReady();
      if (!(await this.physicalTableExists(sourceDataset.tableName))) {
        throw new Error(`Input table is not materialized: ${sourceDataset.id}`);
      }
      await this.dropTableIfExists(outputTable.tableName);
      await this.runSql(
        `CREATE TABLE ${quoteIdentifier(outputTable.tableName)} AS SELECT * FROM ${quoteIdentifier(
          sourceDataset.tableName
        )}`
      );
      const rowCount = await this.countRows(outputTable.tableName);
      const columnCount = (await this.getTableColumns(outputTable.tableName)).length;
      await this.metaRunSql(
        `
            UPDATE data_datasets
            SET name = coalesce($name, name),
                source_path = $sourcePath,
                source_kind = 'output',
                config_json = $configJson,
                file_count = 0,
                row_count = $rowCount,
                column_count = $columnCount,
                updated_at = $updatedAt
            WHERE id = $id
          `,
        {
          id: outputTable.id,
          name: nextName,
          sourcePath: `input-table://${sourceDataset.id}`,
          configJson: outputTableConfigJson(sourceDataset.id),
          rowCount,
          columnCount,
          updatedAt: this.now(),
        }
      );
      return this.requireOutputTable(input.id);
    }

    if (hasSourceDatasetChange) {
      await this.metaRunSql(
        `
            UPDATE data_datasets
            SET name = coalesce($name, name),
                source_path = $sourcePath,
                source_kind = 'output',
                config_json = $configJson,
                file_count = 0,
                updated_at = $updatedAt
            WHERE id = $id
          `,
        {
          id: outputTable.id,
          name: nextName,
          sourcePath: `duckdb://outputs/${outputTable.tableName}`,
          configJson: outputTableConfigJson(),
          updatedAt: this.now(),
        }
      );
      return this.requireOutputTable(input.id);
    }

    if (nextName) {
      await this.metaRunSql(
        `
            UPDATE data_datasets
            SET name = $name,
                updated_at = $updatedAt
            WHERE id = $id
          `,
        { id: outputTable.id, name: nextName, updatedAt: this.now() }
      );
    }
    return this.requireOutputTable(input.id);
  }

  async previewInputTable(input: DataPreviewInputTableInput): Promise<DataInputTablePreview> {
    await this.ensureReady();
    const sourcePath = normalizeImportSourcePath(input.filePath);
    const sourceKind = normalizeInputTableSourceKind(input.sourceKind, sourcePath);
    const config = normalizeInputTableConfig(input.config, sourceKind, sourcePath);
    const limit = normalizePreviewLimit(input.limit);
    const offset = normalizePreviewOffset(input.offset);
    if (config.dataProcessing?.strategy === 'customize') {
      return this.previewPublishedInputTableNormalizerVersion({
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
          if (folderConfig.skipEmptyFiles && (await this.countRows(tempTable)) === 0) {
            await this.dropTableIfExists(tempTable);
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
      await this.runSql(`CREATE TEMP TABLE ${quoteIdentifier(previewTable)} AS ${unionSql}`);
      const countRows = await this.queryRows<{ count: number | string }>(
        `SELECT count(*) AS count FROM ${quoteIdentifier(previewTable)}`
      );
      const totalRows = toNumber(countRows[0]?.count);
      const rows = await this.queryRows<Record<string, unknown>>(
        `SELECT * FROM ${quoteIdentifier(previewTable)} LIMIT ${limit} OFFSET ${offset}`
      );
      const columns = await this.getTableColumns(previewTable);
      return {
        columns,
        columnTypes: await this.inferTableColumnTypes(previewTable),
        rows: rows.map(normalizePreviewRow),
        fileCount: tempTables.length,
        limit,
        offset,
        totalRows,
      };
    } finally {
      if (previewTable) {
        await this.dropTableIfExists(previewTable).catch(() => undefined);
      }
      for (const tempTable of tempTables) {
        await this.dropTableIfExists(tempTable).catch(() => undefined);
      }
    }
  }

  async previewDataset(input: DataPreviewDatasetInput): Promise<DataInputTablePreview> {
    await this.ensureMetadataReady();
    const dataset = await this.requireDataset(input.id);
    await this.ensureReady();
    const limit = normalizePreviewLimit(input.limit);
    const offset = normalizePreviewOffset(input.offset);
    const tableName = quoteIdentifier(dataset.tableName);
    if (!(await this.physicalTableExists(dataset.tableName))) {
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
    const countRows = await this.queryRows<{ count: number | string }>(
      `SELECT count(*) AS count FROM ${tableName}`
    );
    const rows = await this.queryRows<Record<string, unknown>>(
      `SELECT * FROM ${tableName} LIMIT ${limit} OFFSET ${offset}`
    );
    return {
      columns: await this.getTableColumns(dataset.tableName),
      columnTypes: await this.getTableColumnTypes(dataset.tableName),
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
    await this.ensureMetadataReady();
    const dataset =
      input.tableKind === 'output'
        ? await this.requireOutputTable(input.id)
        : await this.requireInputDataset(input.id);
    await this.ensureReady();
    if (!(await this.physicalTableExists(dataset.tableName))) {
      throw new Error(`Data table is not materialized: ${input.id}`);
    }

    const rowCount = await this.countRows(dataset.tableName);
    const maxRows = normalizeCsvExportMaxRows(input.maxRows);
    if (rowCount > maxRows) {
      throw new Error(`Data table has ${rowCount} rows, above export limit ${maxRows}`);
    }

    const columns = await this.getTableColumns(dataset.tableName);
    const rows = await this.queryRows<Record<string, unknown>>(
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
    await this.ensureReady();
    const dataset = await this.getDataset(id);
    if (!dataset) {
      return false;
    }
    await this.dropTableIfExists(dataset.tableName);
    await this.metaRunSql('DELETE FROM data_datasets WHERE id = $id', { id });
    return true;
  }

  async getInputTableRecord(id: string): Promise<DataDataset | null> {
    await this.ensureMetadataReady();
    try {
      return await this.requireInputDataset(id);
    } catch {
      return null;
    }
  }

  async findInputTableRecordByName(name: string): Promise<DataDataset | null> {
    await this.ensureMetadataReady();
    const normalizedName = name.trim().toLowerCase();
    if (!normalizedName) return null;
    const rows = await this.metaQueryRows<DataDatasetRow>(
      `
          SELECT *
          FROM data_datasets
          WHERE lower(name) = $name
            AND ${storedDatasetSourceKindSql()} <> 'output'
          ORDER BY updated_at DESC, created_at DESC
          LIMIT 1
        `,
      { name: normalizedName }
    );
    return rows[0] ? mapDatasetRow(rows[0]) : null;
  }

  async getOutputTableRecord(id: string): Promise<DataOutputTable | null> {
    await this.ensureMetadataReady();
    await this.cleanupOutputTableMetadata();
    return this.getOutputTable(id);
  }

  protected async updateAutoOutputTableMetadata(
    id: string,
    name: string,
    updatedAt: number
  ): Promise<DataOutputTable> {
    const outputTable = await this.getOutputTable(id);
    if (!outputTable) {
      return this.createOutputTableMetadata(name, updatedAt);
    }
    if (outputTable.name !== name) {
      await this.metaRunSql(
        `
            UPDATE data_datasets
            SET name = $name,
                updated_at = $updatedAt
            WHERE id = $id
          `,
        { id, name, updatedAt }
      );
    }
    return this.requireOutputTable(id);
  }

  protected async findDatasetByReference(reference: string): Promise<DataDataset | null> {
    const rows = await this.metaQueryRows<DataDatasetRow>(
      `
          SELECT *
          FROM data_datasets
          WHERE id = $reference
             OR name = $reference
             OR table_name = $reference
          LIMIT 1
        `,
      { reference }
    );
    return rows[0] ? mapDatasetRow(rows[0]) : null;
  }

  protected async upsertDatasetForTaskOutput(
    taskName: string,
    sourcePath: string | null,
    tableName: string,
    rowCount: number,
    columnCount: number,
    outputDatasetId?: string
  ): Promise<DataDataset | null> {
    if (outputDatasetId) {
      const now = this.now();
      await this.metaRunSql(
        `
            UPDATE data_datasets
            SET source_path = $sourcePath,
                source_kind = 'output',
                config_json = $configJson,
                file_count = 0,
                table_name = $tableName,
                row_count = $rowCount,
                column_count = $columnCount,
                updated_at = $updatedAt
            WHERE id = $id
          `,
        {
          id: outputDatasetId,
          sourcePath: `duckdb://outputs/${tableName}`,
          configJson: outputTableConfigJson(),
          tableName,
          rowCount,
          columnCount,
          updatedAt: now,
        }
      );
      return this.requireDataset(outputDatasetId);
    }

    await this.metaRunSql(
      `
          DELETE FROM data_datasets
          WHERE table_name = $tableName
            AND ${storedDatasetSourceKindSql()} = 'output'
            AND coalesce(config_json, '') NOT LIKE '%"kind":"${OUTPUT_TABLE_CONFIG_KIND}"%'
        `,
      { tableName }
    );
    void taskName;
    void sourcePath;
    return null;
  }

  protected async getDataset(id: string): Promise<DataDataset | null> {
    const rows = await this.metaQueryRows<DataDatasetRow>(
      'SELECT * FROM data_datasets WHERE id = $id LIMIT 1',
      { id }
    );
    return rows[0] ? mapDatasetRow(rows[0]) : null;
  }

  protected async requireDataset(id: string): Promise<DataDataset> {
    const dataset = await this.getDataset(id);
    if (!dataset) {
      throw new Error(`Dataset not found: ${id}`);
    }
    return dataset;
  }

  protected async requireInputDataset(id: string): Promise<DataDataset> {
    const rows = await this.metaQueryRows<DataDatasetRow>(
      `
          SELECT *
          FROM data_datasets
          WHERE id = $id
            AND ${storedDatasetSourceKindSql()} <> 'output'
          LIMIT 1
        `,
      { id }
    );
    if (!rows[0]) {
      throw new Error(`Input table not found: ${id}`);
    }
    return mapDatasetRow(rows[0]);
  }

  protected async getOutputTable(id: string): Promise<DataOutputTable | null> {
    const rows = await this.metaQueryRows<DataDatasetRow>(
      `
          SELECT
            d.*,
            ${this.outputTableRelatedTaskNamesSql('d')} AS related_task_names
          FROM data_datasets d
          WHERE d.id = $id
            AND ${outputTableConfigPredicateSql('d')}
          LIMIT 1
        `,
      { id }
    );
    return rows[0] ? mapOutputTableRow(rows[0]) : null;
  }

  protected async requireOutputTable(id: string): Promise<DataOutputTable> {
    const outputTable = await this.getOutputTable(id);
    if (!outputTable) {
      throw new Error(`Output table not found: ${id}`);
    }
    return outputTable;
  }

  protected async createDatasetTableFromSource(
    tableName: string,
    sourcePath: string,
    sourceKind: DataInputTableSourceKind,
    inputConfig?: DataInputTableConfig
  ): Promise<PreparedInputTableImport> {
    const config = normalizeInputTableConfig(inputConfig, sourceKind, sourcePath);
    if (config.dataProcessing?.strategy === 'customize') {
      return this.createDatasetTableFromPublishedNormalizer(
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
          if (folderConfig.skipEmptyFiles && (await this.countRows(tempTable)) === 0) {
            await this.dropTableIfExists(tempTable);
            tempTables.pop();
            continue;
          }
          if (folderConfig.keepSourceFileName) {
            await this.appendSourceFileNameColumn(tempTable, filePath);
          }
        }
      }

      await this.createDatasetTableFromTempTables(tableName, tempTables);
      const rowCount = await this.countRows(tableName);
      const columnCount = (await this.getTableColumns(tableName)).length;
      return {
        rowCount,
        columnCount,
        fileCount: tempTables.length,
        config,
      };
    } finally {
      for (const tempTable of tempTables) {
        await this.dropTableIfExists(tempTable).catch(() => undefined);
      }
    }
  }

  protected async createImportTempTable(
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
    await this.runSql(
      `CREATE TEMP TABLE ${quoteIdentifier(tableName)} AS SELECT * FROM ${relation}`,
      {
        [parameterName]: filePath,
      }
    );
  }

  protected async appendSourceFileNameColumn(tableName: string, filePath: string): Promise<void> {
    const existingColumns = new Set(
      (await this.getTableColumns(tableName)).map((column) => column.toLowerCase())
    );
    let columnName = 'source_file_name';
    let suffix = 2;
    while (existingColumns.has(columnName.toLowerCase())) {
      columnName = `source_file_name_${suffix}`;
      suffix += 1;
    }
    await this.runSql(
      `ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteValueIdentifier(columnName)} VARCHAR`
    );
    await this.runSql(
      `UPDATE ${quoteIdentifier(tableName)} SET ${quoteValueIdentifier(columnName)} = $sourceFileName`,
      { sourceFileName: basename(filePath) }
    );
  }

  protected async createTempTableFromWorkbookRows(
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
    await this.runSql(`CREATE TEMP TABLE ${quoteIdentifier(tableName)} (${columnSql})`);

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
      await this.runSql(sql, values);
    }
  }

  protected async createDatasetTableFromTempTables(
    tableName: string,
    tempTables: string[]
  ): Promise<void> {
    if (tempTables.length === 0) {
      throw new Error('No Excel or CSV files were found for the input table');
    }

    const unionSql = buildUnionSqlFromTempTables(tempTables);
    const unionTable = tableNameFromId('dataset_import_union', uuidv4());
    try {
      await this.runSql(`CREATE TEMP TABLE ${quoteIdentifier(unionTable)} AS ${unionSql}`);
      await this.createTypedTableFromRelation(tableName, unionTable);
    } finally {
      await this.dropTableIfExists(unionTable).catch(() => undefined);
    }
  }
}
