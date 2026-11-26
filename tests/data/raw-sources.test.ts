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
    ).rejects.toThrow(/E_BUILD_MODE_INVALID/);
  });
});

describe('changing a saved source path', () => {
  it('retargets a folder_per_file source, keeps table ids and rematerializes', async () => {
    const { store, root } = makeStore();
    const folderA = path.join(root, '日报A');
    const folderB = path.join(root, '日报B');
    writeWorkbook(path.join(folderA, '1月.xlsx'), { 数据: [['k'], [1]] });
    writeWorkbook(path.join(folderA, '2月.xlsx'), { 数据: [['k'], [2]] });
    writeWorkbook(path.join(folderB, '1月.xlsx'), { 数据: [['k'], [10], [11]] });
    writeWorkbook(path.join(folderB, '2月.xlsx'), { 数据: [['k'], [20]] });

    const created = await store.createRawSource({
      sourcePath: folderA,
      buildMode: 'folder_per_file',
    });
    const ids = created.tables.map((table) => table.id);
    const changed = await store.changeRawSourcePath({
      sourceId: created.source.id,
      sourcePath: folderB,
    });
    expect(changed.source.sourcePath).toBe(folderB);
    expect(changed.source.id).toBe(created.source.id);
    expect(changed.refreshed).toHaveLength(2);
    const tables = await Promise.all(ids.map((id) => store.getRawTableRecord(id)));
    expect(tables.map((table) => table?.id)).toEqual(ids);
    expect(tables.map((table) => [table?.memberKey, table?.rowCount])).toEqual([
      ['1月.xlsx', 2],
      ['2月.xlsx', 1],
    ]);
    expect(tables.every((table) => table?.sourcePath.startsWith(folderB + path.sep))).toBe(true);
  });

  it('flags missing members and auto-includes new files in the new folder', async () => {
    const { store, root } = makeStore();
    const folderA = path.join(root, '旧');
    const folderB = path.join(root, '新');
    fs.mkdirSync(folderA, { recursive: true });
    fs.mkdirSync(folderB, { recursive: true });
    fs.writeFileSync(path.join(folderA, 'a.csv'), 'k\n1\n');
    fs.writeFileSync(path.join(folderA, 'b.csv'), 'k\n2\n');
    fs.writeFileSync(path.join(folderB, 'a.csv'), 'k\n10\n');
    fs.writeFileSync(path.join(folderB, 'c.csv'), 'k\n30\n');

    const created = await store.createRawSource({
      sourcePath: folderA,
      buildMode: 'folder_per_file',
    });
    const aId = created.tables.find((table) => table.memberKey === 'a.csv')!.id;
    const bId = created.tables.find((table) => table.memberKey === 'b.csv')!.id;
    const changed = await store.changeRawSourcePath({
      sourceId: created.source.id,
      sourcePath: folderB,
    });
    expect(changed.missing).toContain(bId);
    expect(changed.added).toHaveLength(1);
    expect(changed.refreshed).toContain(aId);
    const a = await store.getRawTableRecord(aId);
    const b = await store.getRawTableRecord(bId);
    expect(a?.rowCount).toBe(1);
    expect(a?.sourcePath).toBe(path.join(folderB, 'a.csv'));
    expect(b?.memberStatus).toBe('missing');
    expect(b?.id).toBe(bId);
  });

  it('keeps the merge table id when the new folder adds a column', async () => {
    const { store, root } = makeStore();
    const folderA = path.join(root, '合并A');
    const folderB = path.join(root, '合并B');
    fs.mkdirSync(folderA, { recursive: true });
    fs.mkdirSync(folderB, { recursive: true });
    fs.writeFileSync(path.join(folderA, '1.csv'), '日期,门店\n2026-09-01,S01\n');
    fs.writeFileSync(path.join(folderB, '1.csv'), '日期,门店,备注\n2026-09-01,S01,ok\n');

    const created = await store.createRawSource({
      sourcePath: folderA,
      buildMode: 'folder_merge',
      tableName: '合并日报',
    });
    expect(created.tables).toHaveLength(1);
    const tableId = created.tables[0].id;
    const changed = await store.changeRawSourcePath({
      sourceId: created.source.id,
      sourcePath: folderB,
    });
    expect(changed.source.memberIds).toEqual([tableId]);
    const preview = await store.previewRawTable({ id: tableId, limit: 10 });
    expect(preview.columns).toEqual(expect.arrayContaining(['日期', '门店', '备注']));
    expect(preview.rows[0]?.备注).toBe('ok');
  });

  it('rejects a file path, a missing path and an empty folder without changing the source', async () => {
    const { store, root } = makeStore();
    const folder = path.join(root, '日报');
    const empty = path.join(root, '空文件夹');
    const missing = path.join(root, '不存在');
    const file = path.join(root, 'not-a-folder.csv');
    fs.mkdirSync(folder, { recursive: true });
    fs.mkdirSync(empty, { recursive: true });
    fs.writeFileSync(path.join(folder, 'a.csv'), 'k\n1\n');
    fs.writeFileSync(file, 'k\n1\n');

    const created = await store.createRawSource({
      sourcePath: folder,
      buildMode: 'folder_per_file',
    });
    await expect(
      store.changeRawSourcePath({ sourceId: created.source.id, sourcePath: file })
    ).rejects.toThrow(/E_SOURCE_KIND_MISMATCH/);
    await expect(
      store.changeRawSourcePath({ sourceId: created.source.id, sourcePath: missing })
    ).rejects.toThrow(/E_SOURCE_UNREADABLE/);
    await expect(
      store.changeRawSourcePath({ sourceId: created.source.id, sourcePath: empty })
    ).rejects.toThrow(/E_SOURCE_EMPTY/);
    const source = await store.getRawSource(created.source.id);
    expect(source?.sourcePath).toBe(folder);
  });

  it('rejects a folder whose files do not match the current sheet selector', async () => {
    const { store, root } = makeStore();
    const folderA = path.join(root, '有数据');
    const folderB = path.join(root, '无对应Sheet');
    writeWorkbook(path.join(folderA, 'a.xlsx'), { 封面: [['x']], 数据: [['k'], [1]] });
    writeWorkbook(path.join(folderB, 'a.xlsx'), { 封面: [['x']] });
    const created = await store.createRawSource({
      sourcePath: folderA,
      buildMode: 'folder_per_file',
      sheetSelector: { by: 'name', name: '数据' },
    });
    await expect(
      store.changeRawSourcePath({ sourceId: created.source.id, sourcePath: folderB })
    ).rejects.toThrow(/E_SOURCE_NO_READY_FILES/);
    const source = await store.getRawSource(created.source.id);
    expect(source?.sourcePath).toBe(folderA);
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

  it('agent command creates per-sheet tables via sheetNames and refreshes the whole source', async () => {
    const { store, root } = makeStore();
    const file = writeWorkbook(path.join(root, '经营.xlsx'), { 销售流水: SALES, 门店: STORES });
    const commands = new RawTablesCommandService(store, {} as never);
    const created = await commands.createRawTable({
      filePath: file,
      sourceKind: 'excel',
      sheetNames: ['销售流水', '门店'],
    });
    expect(created.rawTables?.map((table) => table.name).sort()).toEqual([
      '经营 / 销售流水',
      '经营 / 门店',
    ]);
    expect(created.source?.buildMode).toBe('excel_per_sheet');
    writeWorkbook(file, { 销售流水: [...SALES, ['2026-09-03', 'S03', 300]], 门店: STORES });
    const refreshed = await commands.refreshRawSource({ id: created.rawTable.id });
    expect(refreshed.refreshed).toHaveLength(2);
    const sales = (await store.getRawTableRecord(
      created.rawTables!.find((table) => table.memberKey === '销售流水')!.id
    ))!;
    expect(sales.rowCount).toBe(3);
    const twoMonths = writeWorkbook(path.join(root, '月度.xlsx'), { '1月': SALES, '2月': SALES });
    const merged = await commands.createRawTable({
      filePath: twoMonths,
      sourceKind: 'excel',
      name: '合并销售',
      sheetNames: ['1月', '2月'],
      mergeSheets: true,
    });
    expect(merged.source?.buildMode).toBe('excel_merge_sheets');
    expect(merged.rawTables).toHaveLength(1);
    expect(merged.rawTable.rowCount).toBe(4);
    await expect(commands.refreshRawSource({ id: 'nope' })).rejects.toThrow(/not found/i);
  });
});
