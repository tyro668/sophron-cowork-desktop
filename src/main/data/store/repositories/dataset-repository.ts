/** data_datasets row access (input tables + output tables). */
import type {
  DataCreateOutputTableInput,
  DataDataset,
  DataOutputTable,
} from '../../../../shared/contracts';
import { DataStoreContext } from '../data-store-context';
import {
  DataDatasetRow,
  OUTPUT_TABLE_CONFIG_KIND,
  outputTableConfigJson,
  storedDatasetSourceKindSql,
  tableNameFromId,
  mapDatasetRow,
  mapOutputTableRow,
  outputTableConfigPredicateSql,
} from '../data-store-records';
import { v4 as uuidv4 } from 'uuid';

export class DatasetRepository {
  constructor(private readonly ctx: DataStoreContext) {}
  async createOutputTable(input: DataCreateOutputTableInput = {}): Promise<DataOutputTable> {
    await this.ctx.ensureMetadataReady();
    return this.createOutputTableMetadata(input.name?.trim() || 'Output table', this.ctx.now());
  }
  async createOutputTableMetadata(name: string, timestamp: number): Promise<DataOutputTable> {
    const id = uuidv4();
    const tableName = tableNameFromId('output', id);
    await this.ctx.metaRunSql(
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
  async getInputTableRecord(id: string): Promise<DataDataset | null> {
    await this.ctx.ensureMetadataReady();
    try {
      return await this.requireInputDataset(id);
    } catch {
      return null;
    }
  }
  async findInputTableRecordByName(name: string): Promise<DataDataset | null> {
    await this.ctx.ensureMetadataReady();
    const normalizedName = name.trim().toLowerCase();
    if (!normalizedName) return null;
    const rows = await this.ctx.metaQueryRows<DataDatasetRow>(
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
    await this.ctx.ensureMetadataReady();
    return this.getOutputTable(id);
  }
  async updateAutoOutputTableMetadata(
    id: string,
    name: string,
    updatedAt: number
  ): Promise<DataOutputTable> {
    const outputTable = await this.getOutputTable(id);
    if (!outputTable) {
      return this.createOutputTableMetadata(name, updatedAt);
    }
    if (outputTable.name !== name) {
      await this.ctx.metaRunSql(
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
  async findDatasetByReference(reference: string): Promise<DataDataset | null> {
    const rows = await this.ctx.metaQueryRows<DataDatasetRow>(
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
  async upsertDatasetForTaskOutput(
    taskName: string,
    sourcePath: string | null,
    tableName: string,
    rowCount: number,
    columnCount: number,
    outputDatasetId?: string
  ): Promise<DataDataset | null> {
    if (outputDatasetId) {
      const now = this.ctx.now();
      await this.ctx.metaRunSql(
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

    await this.ctx.metaRunSql(
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
  async getDataset(id: string): Promise<DataDataset | null> {
    const rows = await this.ctx.metaQueryRows<DataDatasetRow>(
      'SELECT * FROM data_datasets WHERE id = $id LIMIT 1',
      { id }
    );
    return rows[0] ? mapDatasetRow(rows[0]) : null;
  }
  async requireDataset(id: string): Promise<DataDataset> {
    const dataset = await this.getDataset(id);
    if (!dataset) {
      throw new Error(`Dataset not found: ${id}`);
    }
    return dataset;
  }
  async requireInputDataset(id: string): Promise<DataDataset> {
    const rows = await this.ctx.metaQueryRows<DataDatasetRow>(
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
  async getOutputTable(id: string): Promise<DataOutputTable | null> {
    const rows = await this.ctx.metaQueryRows<DataDatasetRow>(
      `
          SELECT
            d.*,
            ${this.ctx.outputTableRelatedTaskNamesSql('d')} AS related_task_names
          FROM data_datasets d
          WHERE d.id = $id
            AND ${outputTableConfigPredicateSql('d')}
          LIMIT 1
        `,
      { id }
    );
    return rows[0] ? mapOutputTableRow(rows[0]) : null;
  }
  async requireOutputTable(id: string): Promise<DataOutputTable> {
    const outputTable = await this.getOutputTable(id);
    if (!outputTable) {
      throw new Error(`Output table not found: ${id}`);
    }
    return outputTable;
  }
  async insertDataset(row: {
    id: string;
    name: string;
    sourcePath: string;
    sourceKind: string;
    configJson: string;
    fileCount: number;
    tableName: string;
    rowCount: number;
    columnCount: number;
    createdAt: number;
    updatedAt: number;
  }): Promise<void> {
    await this.ctx.metaRunSql(
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
        id: row.id,
        name: row.name,
        sourcePath: row.sourcePath,
        sourceKind: row.sourceKind,
        configJson: row.configJson,
        fileCount: row.fileCount,
        tableName: row.tableName,
        rowCount: row.rowCount,
        columnCount: row.columnCount,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }
    );
  }
  async renameDataset(id: string, name: string, updatedAt: number): Promise<void> {
    await this.ctx.metaRunSql(
      `
          UPDATE data_datasets
          SET name = $name,
              updated_at = $updatedAt
          WHERE id = $id
        `,
      { id, name, updatedAt }
    );
  }
  async updateDatasetAfterReimport(row: {
    id: string;
    name: string;
    sourcePath: string;
    sourceKind: string;
    configJson: string;
    fileCount: number;
    rowCount: number;
    columnCount: number;
    updatedAt: number;
  }): Promise<void> {
    await this.ctx.metaRunSql(
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
        id: row.id,
        name: row.name,
        sourcePath: row.sourcePath,
        sourceKind: row.sourceKind,
        configJson: row.configJson,
        fileCount: row.fileCount,
        rowCount: row.rowCount,
        columnCount: row.columnCount,
        updatedAt: row.updatedAt,
      }
    );
  }
  async updateOutputTableForSource(row: {
    id: string;
    name: string | null;
    sourcePath: string;
    configJson: string;
    rowCount: number;
    columnCount: number;
    updatedAt: number;
  }): Promise<void> {
    await this.ctx.metaRunSql(
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
        id: row.id,
        name: row.name,
        sourcePath: row.sourcePath,
        configJson: row.configJson,
        rowCount: row.rowCount,
        columnCount: row.columnCount,
        updatedAt: row.updatedAt,
      }
    );
  }
  async updateOutputTableMetadata(row: {
    id: string;
    name: string | null;
    sourcePath: string;
    configJson: string;
    updatedAt: number;
  }): Promise<void> {
    await this.ctx.metaRunSql(
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
        id: row.id,
        name: row.name,
        sourcePath: row.sourcePath,
        configJson: row.configJson,
        updatedAt: row.updatedAt,
      }
    );
  }
  async deleteDatasetRow(id: string): Promise<void> {
    await this.ctx.metaRunSql('DELETE FROM data_datasets WHERE id = $id', { id });
  }
  async deleteDatasetRowsByTableName(tableName: string): Promise<void> {
    await this.ctx.metaRunSql('DELETE FROM data_datasets WHERE table_name = $tableName', {
      tableName,
    });
  }
}
