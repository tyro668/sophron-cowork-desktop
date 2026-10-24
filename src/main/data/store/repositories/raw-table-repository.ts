/** data_raw_tables row access (input tables + output tables). */
import type {
  DataCreateResultTableInput,
  DataRawTable,
  DataResultTable,
} from '../../../../shared/contracts';
import { DataStoreContext } from '../data-store-context';
import {
  DataRawTableRow,
  RESULT_TABLE_CONFIG_KIND,
  resultTableConfigJson,
  parseResultTableConfig,
  storedRawTableSourceKindSql,
  tableNameFromId,
  mapRawTableRow,
  mapResultTableRow,
  resultTableConfigPredicateSql,
} from '../data-store-records';
import { v4 as uuidv4 } from 'uuid';

export class RawTableRepository {
  constructor(private readonly ctx: DataStoreContext) {}
  async createResultTable(input: DataCreateResultTableInput = {}): Promise<DataResultTable> {
    await this.ctx.ensureMetadataReady();
    return this.createResultTableMetadata(input.name?.trim() || 'Output table', this.ctx.now());
  }
  async createResultTableMetadata(name: string, timestamp: number): Promise<DataResultTable> {
    const id = uuidv4();
    const tableName = tableNameFromId('output', id);
    await this.ctx.metaRunSql(
      `
          INSERT INTO data_raw_tables (
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
        configJson: resultTableConfigJson(),
        tableName,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
    );
    return this.requireResultTable(id);
  }
  async getRawTableRecord(id: string): Promise<DataRawTable | null> {
    await this.ctx.ensureMetadataReady();
    try {
      return await this.requireInputRawTable(id);
    } catch {
      return null;
    }
  }
  async findRawTableByAutomationSyncKey(syncKey: string): Promise<DataRawTable | null> {
    await this.ctx.ensureMetadataReady();
    const rows = await this.ctx.metaQueryRows<DataRawTableRow>(
      `SELECT * FROM data_raw_tables WHERE ${storedRawTableSourceKindSql()} IN ('cloud', 'csv') AND config_json LIKE $pattern ESCAPE '\\'`,
      { pattern: `%${JSON.stringify(syncKey).replace(/[%_\\]/g, '\\$&')}%` }
    );
    return (
      rows
        .map(mapRawTableRow)
        .find(
          (table) =>
            (table.inputConfig.sourceKind === 'cloud' || table.inputConfig.sourceKind === 'csv') &&
            table.inputConfig.cloudMirror?.automationSyncKey === syncKey
        ) ?? null
    );
  }
  async findRawTableRecordByName(name: string): Promise<DataRawTable | null> {
    await this.ctx.ensureMetadataReady();
    const normalizedName = name.trim().toLowerCase();
    if (!normalizedName) return null;
    const rows = await this.ctx.metaQueryRows<DataRawTableRow>(
      `
          SELECT *
          FROM data_raw_tables
          WHERE lower(name) = $name
            AND ${storedRawTableSourceKindSql()} <> 'output'
          ORDER BY updated_at DESC, created_at DESC
          LIMIT 1
        `,
      { name: normalizedName }
    );
    return rows[0] ? mapRawTableRow(rows[0]) : null;
  }
  async getResultTableRecord(id: string): Promise<DataResultTable | null> {
    await this.ctx.ensureMetadataReady();
    return this.getResultTable(id);
  }
  async updateAutoResultTableMetadata(
    id: string,
    name: string,
    updatedAt: number
  ): Promise<DataResultTable> {
    const resultTable = await this.getResultTable(id);
    if (!resultTable) {
      return this.createResultTableMetadata(name, updatedAt);
    }
    if (resultTable.name !== name) {
      await this.ctx.metaRunSql(
        `
            UPDATE data_raw_tables
            SET name = $name,
                updated_at = $updatedAt
            WHERE id = $id
          `,
        { id, name, updatedAt }
      );
    }
    return this.requireResultTable(id);
  }
  async findRawTableByReference(reference: string): Promise<DataRawTable | null> {
    const rows = await this.ctx.metaQueryRows<DataRawTableRow>(
      `
          SELECT *
          FROM data_raw_tables
          WHERE id = $reference
             OR name = $reference
             OR table_name = $reference
          LIMIT 1
        `,
      { reference }
    );
    return rows[0] ? mapRawTableRow(rows[0]) : null;
  }
  async upsertRawTableForPipelineOutput(
    pipelineName: string,
    sourcePath: string | null,
    tableName: string,
    rowCount: number,
    columnCount: number,
    outputResultTableId?: string
  ): Promise<DataRawTable | null> {
    if (outputResultTableId) {
      const now = this.ctx.now();
      const existing = await this.ctx.metaQueryRows<{ config_json: string | null }>(
        'SELECT config_json FROM data_raw_tables WHERE id = $id LIMIT 1',
        { id: outputResultTableId }
      );
      const existingConfig = parseResultTableConfig(existing[0]?.config_json ?? null);
      await this.ctx.metaRunSql(
        `
            UPDATE data_raw_tables
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
          id: outputResultTableId,
          sourcePath: `duckdb://outputs/${tableName}`,
          configJson: resultTableConfigJson(
            existingConfig.sourceRawTableId,
            existingConfig.cloudAction
          ),
          tableName,
          rowCount,
          columnCount,
          updatedAt: now,
        }
      );
      return this.requireRawTable(outputResultTableId);
    }

    await this.ctx.metaRunSql(
      `
          DELETE FROM data_raw_tables
          WHERE table_name = $tableName
            AND ${storedRawTableSourceKindSql()} = 'output'
            AND coalesce(config_json, '') NOT LIKE '%"kind":"${RESULT_TABLE_CONFIG_KIND}"%'
        `,
      { tableName }
    );
    void pipelineName;
    void sourcePath;
    return null;
  }
  async getRawTable(id: string): Promise<DataRawTable | null> {
    const rows = await this.ctx.metaQueryRows<DataRawTableRow>(
      'SELECT * FROM data_raw_tables WHERE id = $id LIMIT 1',
      { id }
    );
    return rows[0] ? mapRawTableRow(rows[0]) : null;
  }
  async requireRawTable(id: string): Promise<DataRawTable> {
    const rawTable = await this.getRawTable(id);
    if (!rawTable) {
      throw new Error(`RawTable not found: ${id}`);
    }
    return rawTable;
  }
  async requireInputRawTable(id: string): Promise<DataRawTable> {
    const rows = await this.ctx.metaQueryRows<DataRawTableRow>(
      `
          SELECT *
          FROM data_raw_tables
          WHERE id = $id
            AND ${storedRawTableSourceKindSql()} <> 'output'
          LIMIT 1
        `,
      { id }
    );
    if (!rows[0]) {
      throw new Error(`Input table not found: ${id}`);
    }
    return mapRawTableRow(rows[0]);
  }
  async getResultTable(id: string): Promise<DataResultTable | null> {
    const rows = await this.ctx.metaQueryRows<DataRawTableRow>(
      `
          SELECT
            d.*,
            ${this.ctx.resultTableRelatedPipelineNamesSql('d')} AS related_pipeline_names,
            ${this.ctx.resultTableRelatedPipelineIdsSql('d')} AS related_pipeline_ids
          FROM data_raw_tables d
          WHERE d.id = $id
            AND ${resultTableConfigPredicateSql('d')}
          LIMIT 1
        `,
      { id }
    );
    return rows[0] ? mapResultTableRow(rows[0]) : null;
  }

  async findResultTableByPhysicalName(tableName: string): Promise<DataResultTable | null> {
    await this.ctx.ensureMetadataReady();
    const rows = await this.ctx.metaQueryRows<{ id: string }>(
      `SELECT id FROM data_raw_tables WHERE table_name = $tableName
       AND ${resultTableConfigPredicateSql()} ORDER BY id LIMIT 1`,
      { tableName }
    );
    return rows[0] ? this.getResultTable(rows[0].id) : null;
  }
  async requireResultTable(id: string): Promise<DataResultTable> {
    const resultTable = await this.getResultTable(id);
    if (!resultTable) {
      throw new Error(`Output table not found: ${id}`);
    }
    return resultTable;
  }

  /**
   * Whether a user-managed (explicit) result-table rawTable row claims this
   * physical table. Such rows mark resources a pipeline may reference but never
   * owns — pipeline deletion must leave them alone.
   */
  async hasExplicitResultTableForTableName(tableName: string): Promise<boolean> {
    const rows = await this.ctx.metaQueryRows<{ id: string }>(
      `SELECT d.id FROM data_raw_tables d
       WHERE d.table_name = $tableName
         AND ${resultTableConfigPredicateSql('d')}
       LIMIT 1`,
      { tableName }
    );
    return rows.length > 0;
  }
  async insertRawTable(row: {
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
          INSERT INTO data_raw_tables (
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
  /** Merge-sheets table: records sheets missing at the last refresh (no re-import). */
  async setMissingMergeSheets(id: string, sheets: string[]): Promise<void> {
    const rows = await this.ctx.metaQueryRows<{ config_json: string | null }>(
      'SELECT config_json FROM data_raw_tables WHERE id = $id LIMIT 1',
      { id }
    );
    if (!rows[0]) return;
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(rows[0].config_json || '{}') as Record<string, unknown>;
    } catch {
      return;
    }
    if (sheets.length) config.missingMergeSheets = sheets;
    else delete config.missingMergeSheets;
    await this.ctx.metaRunSql('UPDATE data_raw_tables SET config_json = $config WHERE id = $id', {
      config: JSON.stringify(config),
      id,
    });
  }

  async renameRawTable(id: string, name: string, updatedAt: number): Promise<void> {
    await this.ctx.metaRunSql(
      `
          UPDATE data_raw_tables
          SET name = $name,
              updated_at = $updatedAt
          WHERE id = $id
        `,
      { id, name, updatedAt }
    );
  }
  async updateRawTableAfterReimport(row: {
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
          UPDATE data_raw_tables
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
  async updateResultTableForSource(row: {
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
          UPDATE data_raw_tables
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
  async updateResultTableMetadata(row: {
    id: string;
    name: string | null;
    sourcePath: string;
    configJson: string;
    updatedAt: number;
  }): Promise<void> {
    await this.ctx.metaRunSql(
      `
          UPDATE data_raw_tables
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
  async deleteRawTableRow(id: string): Promise<void> {
    await this.ctx.metaRunSql('DELETE FROM data_raw_tables WHERE id = $id', { id });
  }
  async deleteRawTableRowsByTableName(tableName: string): Promise<void> {
    await this.ctx.metaRunSql('DELETE FROM data_raw_tables WHERE table_name = $tableName', {
      tableName,
    });
  }
}
