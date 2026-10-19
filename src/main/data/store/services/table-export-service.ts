/**
 * Table file exports — Csv / Excel data files.
 * The IPC layer owns the save dialog + file write; this service only builds
 * file payloads.
 */
import * as XLSX from '../../../utils/xlsx';
import type { DataExportTableInput } from '../../../../shared/contracts';
import { quoteIdentifier, toNumber } from '../../operators';
import { csvCell } from '../input-source';
import type { DataStoreContext } from '../data-store-context';
import type { RawTableRepository } from '../repositories/raw-table-repository';

const EXPORT_MAX_ROWS = 200_000;

export interface PreparedTableExport {
  fileName: string;
  content: string | Buffer;
}

interface TableRowsSnapshot {
  columns: string[];
  rows: Record<string, unknown>[];
  totalRows: number;
}

function sanitizeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
  return cleaned.length > 0 ? cleaned : 'table';
}

export class TableExportService {
  constructor(
    private readonly ctx: DataStoreContext,
    private readonly rawTables: RawTableRepository
  ) {}

  async buildTableExport(input: DataExportTableInput): Promise<PreparedTableExport> {
    await this.ctx.ensureMetadataReady();
    const rawTable =
      input.tableKind === 'result'
        ? await this.rawTables.requireResultTable(input.id)
        : await this.rawTables.requireInputRawTable(input.id);
    await this.ctx.ensureReady();
    if (!(await this.ctx.physicalTableExists(rawTable.tableName))) {
      throw new Error(`Data table is not materialized: ${input.id}`);
    }
    const baseName = sanitizeFileName(rawTable.name);

    if (input.format === 'csv') {
      const snapshot = await this.readRows(rawTable.tableName, EXPORT_MAX_ROWS);
      const csv =
        [
          snapshot.columns.map(csvCell).join(','),
          ...snapshot.rows.map((row) =>
            snapshot.columns.map((column) => csvCell(row[column])).join(',')
          ),
        ].join('\n') + '\n';
      return { fileName: `${baseName}.csv`, content: csv };
    }

    if (input.format === 'xlsx') {
      const snapshot = await this.readRows(rawTable.tableName, EXPORT_MAX_ROWS);
      const sheet = XLSX.utils.aoa_to_sheet([
        snapshot.columns,
        ...snapshot.rows.map((row) => snapshot.columns.map((column) => row[column] ?? null)),
      ]);
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, 'data');
      const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
      return { fileName: `${baseName}.xlsx`, content: buffer };
    }
    throw new Error(`Unsupported export format: ${String(input.format)}`);
  }

  private async readRows(tableName: string, maxRows: number): Promise<TableRowsSnapshot> {
    const totalRows = toNumber(
      (
        await this.ctx.queryRows<{ count: number | string }>(
          `SELECT count(*) AS count FROM ${quoteIdentifier(tableName)}`
        )
      )[0]?.count
    );
    if (totalRows > maxRows) {
      throw new Error(`Data table has ${totalRows} rows, above export limit ${maxRows}`);
    }
    const rows = await this.ctx.queryRows<Record<string, unknown>>(
      `SELECT * FROM ${quoteIdentifier(tableName)}`
    );
    return {
      columns: await this.ctx.getTableColumns(tableName),
      rows,
      totalRows,
    };
  }
}
