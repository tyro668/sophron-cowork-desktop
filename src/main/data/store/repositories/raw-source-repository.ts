/** data_raw_sources row access: a raw-table source (file / folder / cloud table) owns 1..N tables. */
import type {
  DataRawSource,
  DataRawSourceBuildMode,
  DataRawSourceConfig,
  DataRawSourceKind,
  DataRawSourceMemberStatus,
} from '../../../../shared/contracts';
import { DataStoreContext } from '../data-store-context';
import { DataRawSourceRow, mapRawSourceRow } from '../data-store-records';

const SOURCE_SELECT = `
  SELECT s.*,
    (SELECT group_concat(t.id, ',') FROM (
        SELECT id FROM data_raw_tables WHERE source_id = s.id ORDER BY created_at, name
     ) t) AS member_ids
  FROM data_raw_sources s`;

export class RawSourceRepository {
  constructor(private readonly ctx: DataStoreContext) {}

  async listSources(): Promise<DataRawSource[]> {
    const rows = await this.ctx.metaQueryRows<DataRawSourceRow>(
      `${SOURCE_SELECT} ORDER BY s.updated_at DESC, s.id`
    );
    return rows.map(mapRawSourceRow);
  }

  async getSource(id: string): Promise<DataRawSource | null> {
    const rows = await this.ctx.metaQueryRows<DataRawSourceRow>(
      `${SOURCE_SELECT} WHERE s.id = $id LIMIT 1`,
      { id }
    );
    return rows[0] ? mapRawSourceRow(rows[0]) : null;
  }

  async requireSource(id: string): Promise<DataRawSource> {
    const source = await this.getSource(id);
    if (!source) throw new Error(`E_RAW_SOURCE_NOT_FOUND: 数据源不存在或已删除（${id}）`);
    return source;
  }

  async insertSource(row: {
    id: string;
    name: string;
    sourcePath: string;
    sourceKind: DataRawSourceKind;
    buildMode: DataRawSourceBuildMode;
    config: DataRawSourceConfig;
    at: number;
  }): Promise<void> {
    await this.ctx.metaRunSql(
      `INSERT INTO data_raw_sources
         (id, name, source_path, source_kind, build_mode, config_json, created_at, updated_at)
       VALUES ($id, $name, $sourcePath, $sourceKind, $buildMode, $config, $at, $at)`,
      {
        id: row.id,
        name: row.name,
        sourcePath: row.sourcePath,
        sourceKind: row.sourceKind,
        buildMode: row.buildMode,
        config: JSON.stringify(row.config),
        at: row.at,
      }
    );
  }

  async updateSource(row: {
    id: string;
    name?: string;
    sourcePath?: string;
    sourceKind?: DataRawSourceKind;
    buildMode?: DataRawSourceBuildMode;
    config?: DataRawSourceConfig;
    at: number;
  }): Promise<void> {
    const current = await this.requireSource(row.id);
    await this.ctx.metaRunSql(
      `UPDATE data_raw_sources
          SET name = $name, source_path = $sourcePath, source_kind = $sourceKind,
              build_mode = $buildMode, config_json = $config, updated_at = $at
        WHERE id = $id`,
      {
        id: row.id,
        name: row.name ?? current.name,
        sourcePath: row.sourcePath ?? current.sourcePath,
        sourceKind: row.sourceKind ?? current.sourceKind,
        buildMode: row.buildMode ?? current.buildMode,
        config: JSON.stringify(row.config ?? current.config),
        at: row.at,
      }
    );
  }

  async deleteSourceRow(id: string): Promise<void> {
    await this.ctx.metaRunSql('DELETE FROM data_raw_sources WHERE id = $id', { id });
  }

  async attachMember(input: {
    rawTableId: string;
    sourceId: string;
    memberKey: string | null;
    status?: DataRawSourceMemberStatus;
  }): Promise<void> {
    await this.ctx.metaRunSql(
      `UPDATE data_raw_tables SET source_id = $sourceId, member_key = $memberKey,
              member_status = $status WHERE id = $id`,
      {
        id: input.rawTableId,
        sourceId: input.sourceId,
        memberKey: input.memberKey,
        status: input.status ?? 'ok',
      }
    );
  }

  /** Re-labels the (single-member) source of a table that became a cloud mirror. */
  async markCloudSource(rawTableId: string): Promise<void> {
    await this.ctx.metaRunSql(
      `UPDATE data_raw_sources SET source_kind = 'cloud', build_mode = 'cloud_table'
        WHERE id = (SELECT source_id FROM data_raw_tables WHERE id = $id)`,
      { id: rawTableId }
    );
  }

  async setMemberKey(rawTableId: string, memberKey: string): Promise<void> {
    await this.ctx.metaRunSql('UPDATE data_raw_tables SET member_key = $key WHERE id = $id', {
      id: rawTableId,
      key: memberKey,
    });
  }

  async setMemberStatus(rawTableId: string, status: DataRawSourceMemberStatus): Promise<void> {
    await this.ctx.metaRunSql('UPDATE data_raw_tables SET member_status = $status WHERE id = $id', {
      id: rawTableId,
      status,
    });
  }

  /** Drops source rows whose last member table is gone. */
  async deleteEmptySources(): Promise<void> {
    await this.ctx.metaRunSql(
      `DELETE FROM data_raw_sources
        WHERE NOT EXISTS (SELECT 1 FROM data_raw_tables t WHERE t.source_id = data_raw_sources.id)`
    );
  }
}
