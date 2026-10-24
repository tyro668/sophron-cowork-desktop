import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as XLSX from '../../src/main/utils/xlsx';
import {
  createDataPipelineStore,
  type DataPipelineStore,
} from '../../src/main/data/data-pipeline-store';
import { migrateSourceFileRelativePaths } from '../../src/main/data/store/migrations';
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

describe('QA round 2', () => {
  it('folder merge records _来源文件 relative to the folder', async () => {
    const { store, root } = makeStore();
    const dir = path.join(root, 'daily');
    fs.mkdirSync(path.join(dir, '华东'), { recursive: true });
    fs.mkdirSync(path.join(dir, '华南'), { recursive: true });
    writeWorkbook(path.join(dir, '华东', '日报.xlsx'), { 日报: rows('e', 2) });
    writeWorkbook(path.join(dir, '华南', '日报.xlsx'), { 日报: rows('s', 3) });
    writeWorkbook(path.join(dir, '总部.xlsx'), { 日报: rows('h', 1) });
    const created = await store.createRawSource({ sourcePath: dir, buildMode: 'folder_merge' });
    const preview = await store.previewRawTable({ id: created.tables[0].id, limit: 10 });
    const counts: Record<string, number> = {};
    for (const row of preview.rows) {
      const key = String(row['_来源文件']);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    expect(counts).toEqual({ '华东/日报.xlsx': 2, '华南/日报.xlsx': 3, '总部.xlsx': 1 });
  });

  it('merged-sheet table records missing sheets and clears them once they are back', async () => {
    const { store, root } = makeStore();
    const file = writeWorkbook(path.join(root, '月报.xlsx'), {
      一月: rows('A', 1),
      二月: rows('B', 1),
    });
    const created = await store.createRawSource({
      sourcePath: file,
      buildMode: 'excel_merge_sheets',
      sheets: ['一月', '二月'],
    });
    const id = created.tables[0].id;
    const missing = async () =>
      ((await store.getRawTableRecord(id))!.inputConfig as { missingMergeSheets?: string[] })
        .missingMergeSheets;
    writeWorkbook(file, { 一月: rows('A', 1) });
    await store.refreshRawSource(created.source.id);
    expect(await missing()).toEqual(['二月']);
    writeWorkbook(file, { 一月: rows('A', 1), 二月: rows('B', 2) });
    await store.refreshRawSource(created.source.id);
    expect(await missing()).toBeUndefined();
    expect((await store.getRawTableRecord(id))!.rowCount).toBe(3);
  });

  it('a confirmed sheet rename renames the table, keeps the id and name-bound inputs', async () => {
    const { store, root } = makeStore();
    const file = writeWorkbook(path.join(root, '经营.xlsx'), {
      目标: rows('T', 3),
      销售: [
        ['日期', '额'],
        ['d', 1],
      ],
    });
    const created = await store.createRawSource({
      sourcePath: file,
      buildMode: 'excel_per_sheet',
      members: [{ key: '目标' }, { key: '销售' }],
    });
    const target = created.tables.find((t) => t.memberKey === '目标')!;
    expect(target.name).toBe('经营 / 目标');
    const output = await store.createResultTable({ name: '输出' });
    const pipeline = await store.createPipeline({ name: '分析' });
    const workflow = {
      nodes: [
        {
          id: 'in',
          type: 'input' as const,
          label: '目标输入',
          x: 0,
          y: 0,
          config: { source: 'rawTable', rawTableId: '经营 / 目标' },
        },
        {
          id: 'out',
          type: 'output' as const,
          label: 'out',
          x: 0,
          y: 0,
          config: { outputResultTableId: output.id },
        },
      ],
      edges: [{ id: 'e', sourceNodeId: 'in', targetNodeId: 'out' }],
    };
    await store.savePipelineWorkflow(pipeline.id, workflow);
    writeWorkbook(file, {
      '9月目标': rows('T', 3),
      销售: [
        ['日期', '额'],
        ['d', 1],
      ],
    });
    const refreshed = await store.refreshRawSource(created.source.id);
    expect(refreshed.renames).toHaveLength(1);
    await store.resolveRawSourceRenames({
      sourceId: created.source.id,
      decisions: [{ tableId: target.id, newKey: '9月目标', action: 'rename' }],
    });
    const after = (await store.getRawTableRecord(target.id))!;
    expect(after.name).toBe('经营 / 9月目标');
    const saved = await store.getPipelineWorkflow(pipeline.id);
    expect(saved.nodes.find((n) => n.label === '目标输入')!.config.rawTableId).toBe(target.id);
    await store.runPipeline(pipeline.id);
  });

  it('a deleted input table gives a readable error naming the node', async () => {
    const { store, root } = makeStore();
    const file = writeWorkbook(path.join(root, 'a.xlsx'), { S: rows('a', 1) });
    const created = await store.createRawSource({ sourcePath: file, buildMode: 'excel_single' });
    const output = await store.createResultTable({ name: '输出2' });
    const pipeline = await store.createPipeline({ name: '分析2' });
    const workflow = {
      nodes: [
        {
          id: 'in',
          type: 'input' as const,
          label: '门店输入',
          x: 0,
          y: 0,
          config: { source: 'rawTable', rawTableId: created.tables[0].id },
        },
        {
          id: 'out',
          type: 'output' as const,
          label: 'out',
          x: 0,
          y: 0,
          config: { outputResultTableId: output.id },
        },
      ],
      edges: [{ id: 'e', sourceNodeId: 'in', targetNodeId: 'out' }],
    };
    await store.deleteRawTable(created.tables[0].id);
    await expect(store.runPipeline(pipeline.id, { workflow })).rejects.toThrow(
      /E_INPUT_TABLE_DELETED: 输入节点“门店输入”引用的原始表已删除，请重新选择/
    );
  });
});

describe('v31 migration', () => {
  it('rewrites bare _来源文件 names to folder-relative paths', async () => {
    const { store, root } = makeStore();
    const dir = path.join(root, 'daily');
    fs.mkdirSync(path.join(dir, '华东'), { recursive: true });
    writeWorkbook(path.join(dir, '华东', '杭州.xlsx'), { 日报: rows('e', 2) });
    writeWorkbook(path.join(dir, '总部.xlsx'), { 日报: rows('h', 1) });
    const created = await store.createRawSource({ sourcePath: dir, buildMode: 'folder_merge' });
    const table = (await store.getRawTableRecord(created.tables[0].id))!;
    const ctx = (store as unknown as { ctx: Parameters<typeof migrateSourceFileRelativePaths>[0] })
      .ctx;
    await ctx.runSql(
      `UPDATE "${table.tableName}" SET "_来源文件" = '杭州.xlsx' WHERE "_来源文件" = '华东/杭州.xlsx'`
    );
    await migrateSourceFileRelativePaths(ctx);
    const preview = await store.previewRawTable({ id: table.id, limit: 10 });
    expect(preview.rows.map((r) => r['_来源文件']).sort()).toEqual([
      '华东/杭州.xlsx',
      '华东/杭州.xlsx',
      '总部.xlsx',
    ]);
  });
});
