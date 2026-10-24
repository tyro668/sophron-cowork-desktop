import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as XLSX from '../../src/main/utils/xlsx';
import {
  createDataPipelineStore,
  type DataPipelineStore,
} from '../../src/main/data/data-pipeline-store';
import { RawTablesCommandService } from '../../src/main/data/raw-tables-command-service';

const tempRoots: string[] = [];
const stores: DataPipelineStore[] = [];
afterEach(() => {
  while (stores.length > 0) stores.pop()?.close();
  while (tempRoots.length > 0) fs.rmSync(tempRoots.pop()!, { recursive: true, force: true });
});

function makeStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-qa-'));
  tempRoots.push(root);
  const store = createDataPipelineStore(path.join(root, 'workspace.duckdb'));
  stores.push(store);
  return { store, root };
}

function writeWorkbook(filePath: string, sheets: Record<string, unknown[][]>): string {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }
  XLSX.writeFile(workbook, filePath);
  return filePath;
}

const rows = (prefix: string, n: number) => [
  ['门店', '销售额'],
  ...Array.from({ length: n }, (_, i) => [`${prefix}${i}`, i]),
];

describe('merge-sheets refresh', () => {
  it('keeps the last import when a merged sheet disappeared instead of dropping its rows', async () => {
    const { store, root } = makeStore();
    const file = writeWorkbook(path.join(root, '月报.xlsx'), {
      一月: rows('A', 3),
      二月: rows('B', 4),
      三月: rows('C', 5),
    });
    const created = await store.createRawSource({
      sourcePath: file,
      buildMode: 'excel_merge_sheets',
      sheets: ['一月', '二月', '三月'],
    });
    const table = created.tables[0];
    expect(table.rowCount).toBe(12);

    writeWorkbook(file, { 一月: rows('A', 3), '2月': rows('B', 4), 三月: rows('C', 5) });
    const result = await store.refreshRawSource(created.source.id);
    expect(result.failed).toEqual([
      expect.objectContaining({
        id: table.id,
        error: expect.stringMatching(/E_MERGE_SHEET_MISSING.*二月/),
      }),
    ]);
    expect(result.unchangedNames).toEqual([]);
    const after = (await store.getRawTableRecord(table.id))!;
    expect(after.rowCount).toBe(12);
    expect((after.inputConfig as { mergeSheets?: string[] }).mergeSheets).toEqual([
      '一月',
      '二月',
      '三月',
    ]);

    writeWorkbook(file, { 一月: rows('A', 3), 二月: rows('B', 6), 三月: rows('C', 5) });
    const ok = await store.refreshRawSource(created.source.id);
    expect(ok.failed).toEqual([]);
    expect((await store.getRawTableRecord(table.id))!.rowCount).toBe(14);
  });
});

describe('data_create_raw_table (chat tools)', () => {
  it('sheetNames creates tables only for the listed sheets', async () => {
    const { store, root } = makeStore();
    const file = writeWorkbook(path.join(root, '经营.xlsx'), {
      一月: rows('A', 2),
      二月: rows('B', 3),
      说明: rows('X', 1),
    });
    const commands = new RawTablesCommandService(store, {} as never);
    const created = await commands.createRawTable({
      filePath: file,
      sourceKind: 'excel',
      sheetNames: ['一月', '二月'],
    });
    expect(created.rawTables?.map((table) => table.name).sort()).toEqual([
      '经营 / 一月',
      '经营 / 二月',
    ]);
    const merged = await commands.createRawTable({
      filePath: file,
      sourceKind: 'excel',
      sheetNames: ['一月', '二月'],
      mergeSheets: true,
      name: '合并',
    });
    expect(merged.rawTable.rowCount).toBe(5);
  });

  it('folderMode + sheetSelector, then data_refresh_raw_source picks up a new file', async () => {
    const { store, root } = makeStore();
    const dir = path.join(root, 'daily');
    fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
    writeWorkbook(path.join(dir, 'a.xlsx'), { 备注: [['x'], [1]], 日报: rows('a', 2) });
    writeWorkbook(path.join(dir, 'sub', 'b.xlsx'), { 备注: [['x'], [1]], 日报: rows('b', 3) });
    writeWorkbook(path.join(dir, '~$a.xlsx'), { 日报: rows('t', 9) });
    const commands = new RawTablesCommandService(store, {} as never);
    const perFile = await commands.createRawTable({
      folderPath: dir,
      sourceKind: 'folder',
      folderMode: 'per_file',
      sheetSelector: { by: 'index', index: 2 },
    });
    expect(perFile.rawTables?.map((t) => t.rowCount).sort()).toEqual([2, 3]);
    const merged = await commands.createRawTable({
      folderPath: dir,
      sourceKind: 'folder',
      sheetSelector: { by: 'name', name: '日报' },
      name: '日报合并',
    });
    expect(merged.rawTable.rowCount).toBe(5);
    writeWorkbook(path.join(dir, 'c.xlsx'), { 备注: [['x'], [1]], 日报: rows('c', 4) });
    const refreshed = await commands.refreshRawSource({ id: perFile.rawTable.id });
    expect(refreshed.added).toHaveLength(1);
    await commands.refreshRawSource({ id: merged.rawTable.id });
    expect((await store.getRawTableRecord(merged.rawTable.id))!.rowCount).toBe(9);
  });
});
