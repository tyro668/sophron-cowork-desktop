import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as XLSX from '../../src/main/utils/xlsx';
import {
  createDataPipelineStore,
  type DataPipelineStore,
} from '../../src/main/data/data-pipeline-store';
import {
  findFilledColumns,
  findTypeConflicts,
} from '../../src/main/data/store/services/raw-table-service';

const tempRoots: string[] = [];
const stores: DataPipelineStore[] = [];
afterEach(() => {
  while (stores.length > 0) stores.pop()?.close();
  while (tempRoots.length > 0) fs.rmSync(tempRoots.pop()!, { recursive: true, force: true });
});

function makeStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-src-'));
  tempRoots.push(root);
  const store = createDataPipelineStore(path.join(root, 'workspace.duckdb'), {
    now: () => 1_780_000_000_000,
  });
  stores.push(store);
  return { store, root };
}

function writeWorkbook(filePath: string, sheets: Record<string, unknown[][]>): string {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  XLSX.writeFile(workbook, filePath);
  return filePath;
}

const SALES = [
  ['日期', '门店', '销售额'],
  ['2026-09-01', 'S01', 100],
  ['2026-09-02', 'S02', 200],
];
const STORES = [
  ['门店', '区域'],
  ['S01', '华北'],
];

describe('raw-table sources (1:N)', () => {
  it('scans an Excel file and builds one table per chosen sheet under one source', async () => {
    const { store, root } = makeStore();
    const file = writeWorkbook(path.join(root, '9月经营数据.xlsx'), {
      销售流水: SALES,
      门店: STORES,
      说明: [['这是说明']],
    });
    const scan = await store.scanRawSource({ sourcePath: file });
    expect(scan.kind).toBe('excel');
    expect(scan.sheets.map((s) => [s.name, s.rowCount])).toEqual([
      ['销售流水', 2],
      ['门店', 1],
      ['说明', 0],
    ]);
    const created = await store.createRawSource({
      sourcePath: file,
      buildMode: 'excel_per_sheet',
      members: [{ key: '销售流水' }, { key: '门店', name: '门店主数据' }],
    });
    expect(created.tables.map((t) => [t.name, t.rowCount])).toEqual([
      ['9月经营数据 / 销售流水', 2],
      ['门店主数据', 1],
    ]);
    expect(created.source.buildMode).toBe('excel_per_sheet');
    expect(created.source.memberIds).toHaveLength(2);
    expect(created.tables.every((t) => t.sourceId === created.source.id)).toBe(true);
    const sources = await store.listRawSources();
    expect(sources).toHaveLength(1);
  });

  it('merges selected sheets into one table with a _sheet column', async () => {
    const { store, root } = makeStore();
    const file = writeWorkbook(path.join(root, 'q.xlsx'), {
      '1月': [
        ['a', 'b'],
        [1, 2],
      ],
      '2月': [
        ['a', 'b'],
        [3, 4],
        [5, 6],
      ],
    });
    const created = await store.createRawSource({
      sourcePath: file,
      buildMode: 'excel_merge_sheets',
      sheets: ['1月', '2月'],
    });
    expect(created.tables).toHaveLength(1);
    expect(created.tables[0].rowCount).toBe(3);
    const preview = await store.previewRawTable({ id: created.tables[0].id, limit: 10 });
    expect(preview.columns).toContain('_sheet');
    expect(preview.rows.map((r) => r._sheet)).toEqual(['1月', '2月', '2月']);
  });

  it('a plain import gets its own single-table source; deleting the table removes it', async () => {
    const { store, root } = makeStore();
    const csv = path.join(root, 'a.csv');
    fs.writeFileSync(csv, 'id,v\n1,a\n');
    const table = await store.importRawTable({ filePath: csv });
    const [source] = await store.listRawSources();
    expect(source.buildMode).toBe('single');
    expect(source.memberIds).toEqual([table.id]);
    await store.deleteRawTable(table.id);
    expect(await store.listRawSources()).toHaveLength(0);
  });

  it('folder merge: sheet by name, _来源文件, null fill, excludes missing sheet and type conflicts', async () => {
    const { store, root } = makeStore();
    const folder = path.join(root, '考勤导出');
    writeWorkbook(path.join(folder, '考勤_研发.xlsx'), {
      封面: [['x']],
      明细: [
        ['工号', '工时'],
        ['E1', 176],
        ['E2', 168],
      ],
    });
    writeWorkbook(path.join(folder, '考勤_行政.xlsx'), {
      明细: [
        ['工号', '工时', '备注'],
        ['E5', 160, '调休'],
      ],
    });
    writeWorkbook(path.join(folder, '考勤_市场.xlsx'), { 汇总: [['工号'], ['E9']] });
    fs.writeFileSync(path.join(folder, '考勤_财务.csv'), '工号,工时\nE6,170\n');
    fs.mkdirSync(path.join(folder, '08'));
    fs.writeFileSync(path.join(folder, '08', '考勤_旧.csv'), '工号,工时\nE7,未知\nE8,缺\n');
    fs.writeFileSync(path.join(folder, '~$考勤_临时.xlsx'), 'lock');

    const scan = await store.scanRawSource({
      sourcePath: folder,
      sheetSelector: { by: 'name', name: '明细' },
    });
    const status = Object.fromEntries(scan.files.map((f) => [f.relativePath, f.status]));
    expect(status).toMatchObject({
      '考勤_研发.xlsx': 'ready',
      '考勤_行政.xlsx': 'ready',
      '考勤_市场.xlsx': 'missing_sheet',
      '考勤_财务.csv': 'ready',
      [path.join('08', '考勤_旧.csv')]: 'type_conflict',
      '~$考勤_临时.xlsx': 'skipped',
    });
    expect(scan.merge?.rowCount).toBe(4);
    expect(scan.merge?.filledColumns.map((c) => c.name)).toEqual(['备注']);

    const created = await store.createRawSource({
      sourcePath: folder,
      buildMode: 'folder_merge',
      sheetSelector: { by: 'name', name: '明细' },
    });
    const table = created.tables[0];
    expect(table.name).toBe('考勤导出（合并）');
    expect(table.rowCount).toBe(4);
    const preview = await store.previewRawTable({ id: table.id, limit: 10 });
    expect(preview.columns).toEqual(expect.arrayContaining(['工号', '工时', '备注', '_来源文件']));
    expect(preview.rows.filter((r) => r.备注 === null)).toHaveLength(3);
    const report = table.inputConfig.sourceKind === 'folder' ? table.inputConfig.mergeReport : null;
    expect(report?.missingSheetFiles).toEqual(['考勤_市场.xlsx']);
    expect(report?.typeConflictFiles.map((f) => f.file)).toEqual([path.join('08', '考勤_旧.csv')]);
  });

  it('folder per file: sheet by index, per-file override, then refresh adds new files', async () => {
    const { store, root } = makeStore();
    const folder = path.join(root, '日报');
    writeWorkbook(path.join(folder, 'a.xlsx'), { 封面: [['x']], 数据: [['k'], [1]] });
    writeWorkbook(path.join(folder, 'b.xlsx'), { 只有一个: [['k'], [2], [3]] });
    fs.writeFileSync(path.join(folder, 'c.csv'), 'k\n4\n');

    const scan = await store.scanRawSource({
      sourcePath: folder,
      sheetSelector: { by: 'index', index: 2 },
    });
    expect(scan.files.find((f) => f.relativePath === 'b.xlsx')?.status).toBe('missing_sheet');

    const created = await store.createRawSource({
      sourcePath: folder,
      buildMode: 'folder_per_file',
      sheetSelector: { by: 'index', index: 2 },
      fileSheetOverrides: { 'b.xlsx': '只有一个' },
    });
    expect(created.tables.map((t) => [t.memberKey, t.rowCount])).toEqual([
      ['a.xlsx', 1],
      ['b.xlsx', 2],
      ['c.csv', 1],
    ]);

    fs.writeFileSync(path.join(folder, 'd.csv'), 'k\n5\n6\n');
    fs.rmSync(path.join(folder, 'c.csv'));
    const refreshed = await store.refreshRawSource(created.source.id);
    expect(refreshed.added).toHaveLength(1);
    expect(refreshed.missing).toHaveLength(1);
    expect(refreshed.refreshed).toHaveLength(2);
    const tables = await Promise.all(
      refreshed.source.memberIds.map((id) => store.getRawTableRecord(id))
    );
    expect(
      tables
        .map((t) => [t?.memberKey, t?.memberStatus])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    ).toEqual([
      ['a.xlsx', 'ok'],
      ['b.xlsx', 'ok'],
      ['c.csv', 'missing'],
      ['d.csv', 'ok'],
    ]);
  });

  it('changing the build mode needs confirmation, reports impact and recreates the tables', async () => {
    const { store, root } = makeStore();
    const file = writeWorkbook(path.join(root, 'm.xlsx'), { A: SALES, B: STORES });
    const created = await store.createRawSource({ sourcePath: file, buildMode: 'excel_per_sheet' });
    const impact = await store.getRawSourceRebuildImpact(created.source.id);
    expect(impact.tables.map((t) => [t.name, t.rowCount])).toEqual([
      ['m / A', 2],
      ['m / B', 1],
    ]);
    await expect(
      store.rebuildRawSource({
        sourceId: created.source.id,
        sourcePath: file,
        buildMode: 'excel_single',
        members: [{ key: 'A' }],
        confirmDeleteExistingTables: false,
      })
    ).rejects.toThrow(/E_REBUILD_NOT_CONFIRMED/);
    const rebuilt = await store.rebuildRawSource({
      sourceId: created.source.id,
      sourcePath: file,
      buildMode: 'excel_single',
      members: [{ key: 'A' }],
      confirmDeleteExistingTables: true,
    });
    expect(rebuilt.source.id).toBe(created.source.id);
    expect(rebuilt.source.buildMode).toBe('excel_single');
    expect(rebuilt.tables).toHaveLength(1);
    for (const old of created.tables) expect(await store.getRawTableRecord(old.id)).toBeNull();
  });

  it('rejects a build mode that does not fit the source', async () => {
    const { store, root } = makeStore();
    const csv = path.join(root, 'a.csv');
    fs.writeFileSync(csv, 'id\n1\n');
    await expect(
      store.createRawSource({ sourcePath: csv, buildMode: 'folder_merge' })
    ).rejects.toThrow(/does not apply/);
  });
});

describe('merge compatibility helpers', () => {
  it('flags the minority type and lists filled columns', () => {
    const conflicts = findTypeConflicts([
      { file: 'a', types: [{ name: 'x', type: 'integer' }] },
      { file: 'b', types: [{ name: 'x', type: 'decimal' }] },
      { file: 'c', types: [{ name: 'x', type: 'text' }] },
    ]);
    expect([...conflicts]).toEqual([['c', ['x']]]);
    expect(
      findFilledColumns([
        { file: 'a', columns: ['x', 'y'] },
        { file: 'b', columns: ['x'] },
      ])
    ).toEqual([{ name: 'y', missingInFiles: ['b'] }]);
  });
});
