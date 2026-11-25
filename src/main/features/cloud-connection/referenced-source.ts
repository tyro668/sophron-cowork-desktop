/**
 * 云连接上报 / 取数源：从已物化的原始表 / 结果表读数据，不再直接解析 Excel。
 */
import type {
  CloudConnectionTablePreview,
  CloudConnectionTableRef,
} from '../../../shared/contracts';
import type { DataColumnTypeInfo } from '../../../shared/data-field-types';
import type { ExcelMetaPayload } from '../../local-agent/excel/analyzer';
import type { ExcelTableInfo, TableRows } from '../../local-agent/excel/local-excel-source';
import {
  MemoryExcelVersionStore,
  type ExcelVersionStore,
  type UnchangedFile,
} from '../../local-agent/excel/local-excel-source';
import { recordToCells, speTypesFromColumns } from './field-mapping';

export interface BoundTableSnapshot {
  materialized: boolean;
  name: string;
  tableName: string;
  sourceId?: string | null;
  sourcePath?: string;
  updatedAt: number;
  healthReason?: string;
  columns: string[];
  columnTypes: DataColumnTypeInfo[];
  rowCount: number;
}

export interface CloudTableStorePort {
  importRawTable: (
    input: import('../../../shared/contracts').DataImportRawTableInput
  ) => Promise<import('../../../shared/contracts').DataRawTable>;
  getRawTableRecord: (
    id: string
  ) => Promise<import('../../../shared/contracts').DataRawTable | null>;
  getResultTableRecord: (
    id: string
  ) => Promise<import('../../../shared/contracts').DataResultTable | null>;
  describeBoundTable: (kind: 'raw' | 'result', id: string) => Promise<BoundTableSnapshot>;
  previewBoundTable: (
    kind: 'raw' | 'result',
    id: string,
    limit?: number,
    offset?: number
  ) => Promise<{
    materialized: boolean;
    name: string;
    columns: string[];
    columnTypes: DataColumnTypeInfo[];
    rows: Array<Record<string, string | number | boolean | null>>;
    rowCount: number;
  }>;
  iterateBoundTableRows: (
    kind: 'raw' | 'result',
    id: string,
    writeRow: (row: (string | null)[]) => Promise<void>
  ) => Promise<{ columns: string[]; rowCount: number; materialized: boolean }>;
  refreshRawTableIfSourceChanged: (id: string) => Promise<void>;
}

export function createCloudTableStoreAdapter(
  requireStore: () => {
    importRawTable: CloudTableStorePort['importRawTable'];
    getRawTableRecord: CloudTableStorePort['getRawTableRecord'];
    getResultTableRecord: CloudTableStorePort['getResultTableRecord'];
    describeBoundTable: CloudTableStorePort['describeBoundTable'];
    previewBoundTable: CloudTableStorePort['previewBoundTable'];
    iterateBoundTableRows: CloudTableStorePort['iterateBoundTableRows'];
    refreshRawTableIfSourceChanged: CloudTableStorePort['refreshRawTableIfSourceChanged'];
  }
): CloudTableStorePort {
  const store = () => requireStore();
  return {
    importRawTable: (input) => store().importRawTable(input),
    getRawTableRecord: (id) => store().getRawTableRecord(id),
    getResultTableRecord: (id) => store().getResultTableRecord(id),
    describeBoundTable: (kind, id) => store().describeBoundTable(kind, id),
    previewBoundTable: (kind, id, limit, offset) =>
      store().previewBoundTable(kind, id, limit, offset),
    iterateBoundTableRows: (kind, id, writeRow) =>
      store().iterateBoundTableRows(kind, id, writeRow),
    refreshRawTableIfSourceChanged: (id) => store().refreshRawTableIfSourceChanged(id),
  };
}

export type StoredTableRef = Pick<CloudConnectionTableRef, 'reportName' | 'kind' | 'tableId'>;

export async function resolveTableRef(
  store: CloudTableStorePort,
  ref: StoredTableRef
): Promise<CloudConnectionTableRef> {
  try {
    if (ref.kind === 'raw') {
      const raw = await store.getRawTableRecord(ref.tableId);
      if (!raw) {
        return { ...ref, status: 'missing', statusReason: '原始表已删除' };
      }
      if (raw.health) {
        return {
          ...ref,
          displayName: raw.name,
          status: 'abnormal',
          statusReason: raw.health.reason,
          rowCount: raw.rowCount,
          columnCount: raw.columnCount,
        };
      }
      return {
        ...ref,
        displayName: raw.name,
        status: 'ok',
        rowCount: raw.rowCount,
        columnCount: raw.columnCount,
      };
    }
    const result = await store.getResultTableRecord(ref.tableId);
    if (!result) {
      return { ...ref, status: 'missing', statusReason: '结果表已删除' };
    }
    try {
      const described = await store.describeBoundTable('result', ref.tableId);
      if (!described.materialized) {
        return {
          ...ref,
          displayName: result.name,
          status: 'unmaterialized',
          statusReason: '结果表尚未物化',
          rowCount: result.rowCount,
          columnCount: result.columnCount,
        };
      }
    } catch {
      return {
        ...ref,
        displayName: result.name,
        status: 'unmaterialized',
        statusReason: '结果表尚未物化',
        rowCount: result.rowCount,
        columnCount: result.columnCount,
      };
    }
    return {
      ...ref,
      displayName: result.name,
      status: 'ok',
      rowCount: result.rowCount,
      columnCount: result.columnCount,
    };
  } catch (error) {
    return {
      ...ref,
      status: 'missing',
      statusReason: error instanceof Error ? error.message : String(error),
    };
  }
}

function infoOf(ref: StoredTableRef, index: number): ExcelTableInfo {
  return {
    id: ref.reportName,
    manual: true,
    type: 'excel',
    directoryPath: '',
    sortIndex: index,
  };
}

export class ReferencedTableSource {
  readonly versionStore: ExcelVersionStore;

  constructor(
    public sourceName: string,
    private refs: StoredTableRef[],
    private readonly store: CloudTableStorePort | undefined,
    versionStore?: ExcelVersionStore
  ) {
    this.versionStore = versionStore ?? new MemoryExcelVersionStore();
  }

  setRefs(refs: StoredTableRef[]): void {
    this.refs = refs;
  }

  private requireStore(): CloudTableStorePort {
    if (!this.store) throw new Error('数据仓库尚未就绪');
    return this.store;
  }

  private refOf(tableId: string): { ref: StoredTableRef; index: number } {
    const index = this.refs.findIndex((item) => item.reportName === tableId);
    if (index < 0) throw new Error(`can not found table ${tableId}`);
    return { ref: this.refs[index], index };
  }

  async listTables(errors?: Map<string, string>): Promise<ExcelTableInfo[]> {
    if (!this.store) return [];
    const out: ExcelTableInfo[] = [];
    for (const [index, ref] of this.refs.entries()) {
      const resolved = await resolveTableRef(this.store, ref);
      if (resolved.status === 'ok') {
        out.push(infoOf(ref, index));
      } else if (errors && resolved.statusReason) {
        errors.set(ref.reportName, resolved.statusReason);
      }
    }
    return out;
  }

  async getTable(tableId: string): Promise<ExcelTableInfo | undefined> {
    const index = this.refs.findIndex((item) => item.reportName === tableId);
    if (index < 0) return undefined;
    if (!this.store) return infoOf(this.refs[index], index);
    const resolved = await resolveTableRef(this.store, this.refs[index]);
    if (resolved.status === 'missing') return undefined;
    return infoOf(this.refs[index], index);
  }

  private async load(ref: StoredTableRef, refresh = true) {
    const store = this.requireStore();
    if (refresh && ref.kind === 'raw') {
      try {
        await store.refreshRawTableIfSourceChanged(ref.tableId);
      } catch {
        // 刷新失败时仍读上次物化结果（原始表会保留旧数据并标异常）。
      }
    }
    return store.describeBoundTable(ref.kind, ref.tableId);
  }

  private assertReadable(snapshot: BoundTableSnapshot, reportName: string): void {
    if (!snapshot.materialized) {
      throw new Error(`结果表尚未物化，无法上报：${reportName}`);
    }
  }

  async rowCount(table: ExcelTableInfo): Promise<number> {
    const { ref } = this.refOf(table.id);
    const snapshot = await this.load(ref);
    this.assertReadable(snapshot, ref.reportName);
    return snapshot.rowCount;
  }

  async queryMeta(table: ExcelTableInfo, messageId?: string): Promise<ExcelMetaPayload> {
    const { ref } = this.refOf(table.id);
    const snapshot = await this.load(ref);
    this.assertReadable(snapshot, ref.reportName);
    if (snapshot.columns.length === 0) {
      throw new Error(
        `文件 [${ref.reportName}] 的数据为空，可能的原因有: sheet数据为空或不存在; 表头行超过数据总行数`
      );
    }
    return {
      messageId,
      error: false,
      hasNext: false,
      tableColumns: snapshot.columns,
      tableColumnTypes: speTypesFromColumns(snapshot.columnTypes),
      skipSync: false,
    };
  }

  async queryStructure(
    table: ExcelTableInfo,
    fetchBean: { update?: boolean; forceOverwrite?: boolean },
    messageId?: string
  ): Promise<ExcelMetaPayload> {
    if (fetchBean.update && !fetchBean.forceOverwrite && (await this.isUnchanged(table))) {
      return { messageId, error: false, hasNext: false, skipSync: true };
    }
    return this.queryMeta(table, messageId);
  }

  async isUnchanged(table: ExcelTableInfo): Promise<boolean> {
    const { ref } = this.refOf(table.id);
    const old = this.versionStore.get(table.id);
    if (!old || old.length === 0) return false;
    try {
      const snapshot = await this.load(ref, false);
      return old[0]?.modifyTime === snapshot.updatedAt && old[0]?.fileName === snapshot.tableName;
    } catch {
      return false;
    }
  }

  private remember(tableId: string, snapshot: BoundTableSnapshot): void {
    const files: UnchangedFile[] = [
      { fileName: snapshot.tableName, modifyTime: snapshot.updatedAt },
    ];
    this.versionStore.put(tableId, files);
  }

  async topRows(
    table: ExcelTableInfo,
    messageId?: string,
    limit = 100
  ): Promise<{ meta: ExcelMetaPayload; rows: (string | null)[][] }> {
    const { ref } = this.refOf(table.id);
    const store = this.requireStore();
    if (ref.kind === 'raw') {
      try {
        await store.refreshRawTableIfSourceChanged(ref.tableId);
      } catch {
        /* keep last snapshot */
      }
    }
    const preview = await store.previewBoundTable(ref.kind, ref.tableId, limit, 0);
    if (!preview.materialized) throw new Error(`结果表尚未物化，无法上报：${ref.reportName}`);
    if (preview.columns.length === 0) {
      throw new Error(
        `文件 [${ref.reportName}] 的数据为空，可能的原因有: sheet数据为空或不存在; 表头行超过数据总行数`
      );
    }
    const meta: ExcelMetaPayload = {
      messageId,
      error: false,
      hasNext: false,
      tableColumns: preview.columns,
      tableColumnTypes: speTypesFromColumns(preview.columnTypes),
      skipSync: false,
    };
    return { meta, rows: preview.rows.map((row) => recordToCells(row, preview.columns)) };
  }

  async readTable(table: ExcelTableInfo): Promise<TableRows> {
    const { meta, rows } = await this.topRows(table, undefined, Number.MAX_SAFE_INTEGER);
    const head = (meta.tableColumns ?? []).map((name) => ({
      data: name,
      type: 'STRING' as const,
    }));
    return { head: head as TableRows['head'], rows };
  }

  async writeFullData(
    table: ExcelTableInfo,
    header: number | string[],
    writeRow: (row: (string | null)[]) => Promise<void>
  ): Promise<number> {
    const { ref } = this.refOf(table.id);
    const store = this.requireStore();
    if (ref.kind === 'raw') {
      try {
        await store.refreshRawTableIfSourceChanged(ref.tableId);
      } catch {
        /* keep last snapshot */
      }
    }
    const headerSize = typeof header === 'number' ? header : header.length;
    const result = await store.iterateBoundTableRows(ref.kind, ref.tableId, async (row) => {
      const next = row.slice(0, headerSize);
      while (next.length < headerSize) next.push(null);
      await writeRow(next);
    });
    if (!result.materialized) throw new Error(`结果表尚未物化，无法上报：${ref.reportName}`);
    const snapshot = await store.describeBoundTable(ref.kind, ref.tableId);
    this.remember(table.id, snapshot);
    return result.rowCount;
  }

  async previewTable(
    table: ExcelTableInfo,
    sampleSize = 50
  ): Promise<Omit<CloudConnectionTablePreview, 'tableName'>> {
    const top = await this.topRows(table, undefined, sampleSize);
    const { ref } = this.refOf(table.id);
    const snapshot = await this.load(ref, false);
    return {
      columns: top.meta.tableColumns ?? [],
      columnTypes: top.meta.tableColumnTypes ?? [],
      rowCount: snapshot.rowCount,
      rows: top.rows,
    };
  }
}
