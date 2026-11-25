import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildUnionSqlFromTempTablesWithStrategy,
  listImportableFiles,
} from '../../src/main/data/store/input-source';
import {
  createDataPipelineStore,
  type DataPipelineStore,
} from '../../src/main/data/data-pipeline-store';
import {
  importInputFromLegacyTable,
  planAutoTableImports,
  sortByFromStrategy,
} from '../../src/main/features/cloud-connection/legacy-table-import';
import {
  SheetSelectStrategy,
  TableAppendStrategy,
  TableFieldTypeStrategy,
  TableReadStrategy,
  TableSourceStrategy,
} from '../../src/main/local-agent/excel/local-config';

const tempRoots: string[] = [];
const stores: DataPipelineStore[] = [];
afterEach(() => {
  while (stores.length > 0) stores.pop()?.close();
  while (tempRoots.length > 0) fs.rmSync(tempRoots.pop()!, { recursive: true, force: true });
});

function tmpDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-import-opt-'));
  tempRoots.push(root);
  return root;
}

function writeCsv(filePath: string, rows: string[][]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map((row) => row.join(',')).join('\n'), 'utf8');
}

describe('listImportableFiles', () => {
  it('respects recursive and natural sort', () => {
    const root = tmpDir();
    writeCsv(path.join(root, 'file10.csv'), [['a'], ['1']]);
    writeCsv(path.join(root, 'file2.csv'), [['a'], ['2']]);
    writeCsv(path.join(root, 'sub', 'nested.csv'), [['a'], ['3']]);

    const shallow = listImportableFiles(root, 'excel_csv', { recursive: false, sortBy: 'name' });
    expect(shallow.map((p) => path.basename(p))).toEqual(['file10.csv', 'file2.csv']);

    const nested = listImportableFiles(root, 'excel_csv', { recursive: true, sortBy: 'natural' });
    expect(nested.map((p) => path.basename(p))).toEqual(['file2.csv', 'file10.csv', 'nested.csv']);
  });
});

describe('buildUnionSqlFromTempTablesWithStrategy', () => {
  it('aligns by column position when strategy is align_by_index', () => {
    const sql = buildUnionSqlFromTempTablesWithStrategy(['t1', 't2'], 'align_by_index', [
      ['日期', '金额'],
      ['day', 'amt'],
    ]);
    expect(sql).toContain('UNION ALL');
    expect(sql).not.toContain('BY NAME');
    expect(sql).toContain('"day" AS "日期"');
    expect(sql).toContain('"amt" AS "金额"');
  });
});

describe('importInputFromLegacyTable', () => {
  it('maps a folder merge table to raw import options including INDEX and system fields', () => {
    const root = tmpDir();
    writeCsv(path.join(root, 'a.csv'), [['x'], ['1']]);
    const input = importInputFromLegacyTable(root, {
      tableName: '合并表',
      strategy: TableSourceStrategy.APPEND_BY_NATURAL_ORDER_FILE_NAME,
      fieldStrategy: TableFieldTypeStrategy.NONE,
      readStrategy: TableReadStrategy.RECURSIVE_DIRECTORY,
      appendStrategy: TableAppendStrategy.INDEX,
      relativeFilePath: '',
      headerRowNumber: 2,
      sheetStrategy: SheetSelectStrategy.ALL,
      sheetNumber: 1,
      sheetName: '',
      password: 'secret',
    });
    expect(input.name).toBe('合并表');
    expect(input.config).toMatchObject({
      sourceKind: 'folder',
      schemaStrategy: 'align_by_index',
      recursive: true,
      sortBy: 'natural',
      fieldStrategy: 'all_text',
      systemFields: 'local_agent',
      headerRow: 2,
      sheetStrategy: 'all',
      password: 'secret',
    });
  });

  it('maps a single excel file by sheet name', () => {
    const root = tmpDir();
    const file = path.join(root, 'report.xlsx');
    fs.writeFileSync(file, 'placeholder');
    const input = importInputFromLegacyTable(root, {
      tableName: '销售',
      strategy: TableSourceStrategy.SINGLE_FILE,
      fieldStrategy: TableFieldTypeStrategy.AUTO,
      readStrategy: TableReadStrategy.ONLY_CURRENT_DIRECTORY,
      appendStrategy: TableAppendStrategy.NAME,
      relativeFilePath: 'report.xlsx',
      headerRowNumber: 1,
      sheetStrategy: SheetSelectStrategy.NAME,
      sheetNumber: 1,
      sheetName: 'Sheet1',
    });
    expect(input.sourceKind).toBe('excel');
    expect(input.name).toBe('销售');
    expect(input.config).toMatchObject({
      sourceKind: 'excel',
      sheetName: 'Sheet1',
      headerRow: 1,
    });
  });
});

describe('sortByFromStrategy / planAutoTableImports', () => {
  it('plans one import per auto csv using the group strategy', async () => {
    const root = tmpDir();
    writeCsv(path.join(root, 'list.csv'), [['a'], ['1']]);
    const file = path.join(root, 'list.csv');
    const plans = await planAutoTableImports({
      directoryPath: '',
      strategy: 0,
      manualTables: [],
      files: [file],
    });
    expect(plans).toEqual([
      expect.objectContaining({
        reportName: file,
        input: expect.objectContaining({ filePath: file, sourceKind: 'csv' }),
      }),
    ]);
    expect(sortByFromStrategy(TableSourceStrategy.APPEND_BY_MODIFY_TIME)).toBe('mtime');
  });
});

describe('folder_merge align_by_index', () => {
  it('stacks files by column position and keeps the first file names', async () => {
    const root = tmpDir();
    writeCsv(path.join(root, 'a.csv'), [
      ['日期', '金额'],
      ['2026-01-01', '10'],
    ]);
    writeCsv(path.join(root, 'b.csv'), [
      ['day', 'amt'],
      ['2026-01-02', '20'],
    ]);
    const store = createDataPipelineStore(path.join(root, 'workspace.duckdb'), {
      now: () => 1_780_000_000_000,
    });
    stores.push(store);
    const created = await store.createRawSource({
      sourcePath: root,
      buildMode: 'folder_merge',
      tableName: '合并',
      schemaStrategy: 'align_by_index',
      systemFields: 'none',
    });
    expect(created.tables).toHaveLength(1);
    const preview = await store.previewRawTable({ id: created.tables[0]!.id, limit: 10 });
    expect(preview.columns).toEqual(expect.arrayContaining(['日期', '金额']));
    expect(preview.rows).toHaveLength(2);
    const amounts = preview.rows.map((row) => String(row['金额'] ?? row['amt'] ?? ''));
    expect(amounts).toEqual(expect.arrayContaining(['10', '20']));
  });
});
