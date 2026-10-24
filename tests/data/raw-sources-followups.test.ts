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
  fingerprintSimilarity,
  makeFingerprint,
} from '../../src/main/data/store/services/raw-source-service';
import { isCloudRawTableConfig } from '../../src/main/data/store/services/raw-table-service';

const tempRoots: string[] = [];
const stores: DataPipelineStore[] = [];
afterEach(() => {
  while (stores.length > 0) stores.pop()?.close();
  while (tempRoots.length > 0) fs.rmSync(tempRoots.pop()!, { recursive: true, force: true });
});

function makeStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-src2-'));
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
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  XLSX.writeFile(workbook, filePath);
  return filePath;
}

const TARGET = [
  ['门店', '目标'],
  ['S01', 100],
  ['S02', 200],
  ['S03', 300],
];
const SALES = [
  ['日期', '门店', '销售额'],
  ['2026-09-01', 'S01', 10],
  ['2026-09-02', 'S02', 20],
];

async function perSheetSource(store: DataPipelineStore, file: string) {
  return store.createRawSource({
    sourcePath: file,
    buildMode: 'excel_per_sheet',
    members: [{ key: '目标' }, { key: '销售' }],
    autoInclude: true,
  });
}

describe('rename detection on refresh (design 4.3)', () => {
  it('reports a renamed sheet instead of losing the table, and "rename" keeps the id', async () => {
    const { store, root } = makeStore();
    const file = writeWorkbook(path.join(root, '经营.xlsx'), { 目标: TARGET, 销售: SALES });
    const created = await perSheetSource(store, file);
    const target = created.tables.find((table) => table.memberKey === '目标')!;

    writeWorkbook(file, { '9月目标': TARGET, 销售: SALES, 说明: [['x'], ['y']] });
    const result = await store.refreshRawSource(created.source.id);
    expect(result.renames).toEqual([
      expect.objectContaining({ tableId: target.id, oldKey: '目标', newKey: '9月目标' }),
    ]);
    expect(result.renames[0].similarity).toBeGreaterThanOrEqual(0.8);
    // Not marked missing and the rename target is not auto-imported as a new table.
    expect(result.missing).toEqual([]);
    expect(result.addedItems.map((item) => item.key)).toEqual(['说明']);
    expect(result.unchangedNames).toEqual([expect.stringContaining('销售')]);

    const resolved = await store.resolveRawSourceRenames({
      sourceId: created.source.id,
      decisions: [{ tableId: target.id, newKey: '9月目标', action: 'rename' }],
    });
    expect(resolved.renamed).toEqual([target.id]);
    const after = (await store.getRawTableRecord(target.id))!;
    expect(after.memberKey).toBe('9月目标');
    expect(after.memberStatus).toBe('ok');
    expect(after.rowCount).toBe(3);
    // A second refresh no longer reports anything.
    const again = await store.refreshRawSource(created.source.id);
    expect(again.renames).toEqual([]);
    expect(again.missing).toEqual([]);
  });

  it('"treat as new" marks the old table missing and imports the new sheet', async () => {
    const { store, root } = makeStore();
    const file = writeWorkbook(path.join(root, '经营.xlsx'), { 目标: TARGET, 销售: SALES });
    const created = await perSheetSource(store, file);
    const target = created.tables.find((table) => table.memberKey === '目标')!;
    writeWorkbook(file, { 新目标: TARGET, 销售: SALES });
    const result = await store.refreshRawSource(created.source.id);
    expect(result.renames).toHaveLength(1);
    const resolved = await store.resolveRawSourceRenames({
      sourceId: created.source.id,
      decisions: [{ tableId: target.id, newKey: '新目标', action: 'new' }],
    });
    expect(resolved.missing).toEqual([target.id]);
    expect(resolved.added).toHaveLength(1);
    expect((await store.getRawTableRecord(target.id))!.memberStatus).toBe('missing');
  });

  it('does not pair unrelated sheets', async () => {
    const { store, root } = makeStore();
    const file = writeWorkbook(path.join(root, '经营.xlsx'), { 目标: TARGET, 销售: SALES });
    const created = await perSheetSource(store, file);
    writeWorkbook(file, {
      销售: SALES,
      其他: [
        ['a', 'b'],
        [1, 2],
      ],
    });
    const result = await store.refreshRawSource(created.source.id);
    expect(result.renames).toEqual([]);
    expect(result.missingItems.map((item) => item.key)).toEqual(['目标']);
  });

  it('detects a renamed file in a per-file folder source', async () => {
    const { store, root } = makeStore();
    const folder = path.join(root, '门店');
    writeWorkbook(path.join(folder, '北京.xlsx'), { 明细: SALES });
    writeWorkbook(path.join(folder, '上海.xlsx'), { 明细: TARGET });
    const created = await store.createRawSource({
      sourcePath: folder,
      buildMode: 'folder_per_file',
      autoInclude: true,
    });
    const beijing = created.tables.find((table) => table.memberKey === '北京.xlsx')!;
    fs.renameSync(path.join(folder, '北京.xlsx'), path.join(folder, '北京门店.xlsx'));
    const result = await store.refreshRawSource(created.source.id);
    expect(result.renames).toEqual([
      expect.objectContaining({ tableId: beijing.id, newKey: '北京门店.xlsx' }),
    ]);
    await store.resolveRawSourceRenames({
      sourceId: created.source.id,
      decisions: [{ tableId: beijing.id, newKey: '北京门店.xlsx', action: 'rename' }],
    });
    const after = (await store.getRawTableRecord(beijing.id))!;
    expect(after.memberKey).toBe('北京门店.xlsx');
    expect(after.sourcePath).toBe(path.join(folder, '北京门店.xlsx'));
  });

  it('scores fingerprints by columns, types and rows', () => {
    const a = makeFingerprint(
      [
        { name: 'a', type: 'INTEGER' },
        { name: 'b', type: 'VARCHAR' },
      ],
      [{ a: 1, b: 'x' }]
    );
    const same = makeFingerprint(
      [
        { name: 'a', type: 'BIGINT' },
        { name: 'b', type: 'VARCHAR' },
      ],
      [{ a: '1.0', b: 'x' }]
    );
    expect(fingerprintSimilarity(a, same)).toBeCloseTo(1);
    const other = makeFingerprint([{ name: 'z', type: 'VARCHAR' }], [{ z: 'q' }]);
    expect(fingerprintSimilarity(a, other)).toBeLessThan(0.2);
  });
});

describe('E_SOURCE_MEMBER_MISSING (design 4.5)', () => {
  it('fails a run that reads a missing member unless "use last data" is on', async () => {
    const { store, root } = makeStore();
    const file = writeWorkbook(path.join(root, '经营.xlsx'), { 目标: TARGET, 销售: SALES });
    const created = await perSheetSource(store, file);
    const target = created.tables.find((table) => table.memberKey === '目标')!;
    writeWorkbook(file, { 销售: SALES });
    await store.refreshRawSource(created.source.id);
    expect((await store.getRawTableRecord(target.id))!.memberStatus).toBe('missing');

    const output = await store.createResultTable({ name: '目标输出' });
    const pipeline = await store.createPipeline({ name: '目标分析' });
    const workflow = (allow: boolean) => ({
      nodes: [
        {
          id: 'in',
          type: 'input' as const,
          label: 'in',
          x: 0,
          y: 0,
          config: {
            source: 'rawTable',
            rawTableId: target.id,
            ...(allow ? { allowMissingSourceMember: true } : {}),
          },
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
    });
    await expect(store.runPipeline(pipeline.id, { workflow: workflow(false) })).rejects.toThrow(
      /E_SOURCE_MEMBER_MISSING/
    );
    await store.runPipeline(pipeline.id, { workflow: workflow(true) });
    const result = (await store.getDashboard({ includeResultTables: true })).resultTables.find(
      (t) => t.id === output.id
    )!;
    expect(result.rowCount).toBe(3);
  });
});

describe('cloud sources', () => {
  it('classifies cloud mirrors as their own source kind', async () => {
    expect(isCloudRawTableConfig({ sourceKind: 'cloud' } as never)).toBe(true);
    expect(isCloudRawTableConfig({ sourceKind: 'csv', cloudMirror: {} } as never)).toBe(true);
    expect(isCloudRawTableConfig({ sourceKind: 'csv' } as never)).toBe(false);
    const { store, root } = makeStore();
    const csv = path.join(root, 'cache.csv');
    fs.writeFileSync(csv, 'a,b\n1,2\n');
    const table = await store.importRawTable({
      filePath: csv,
      sourceKind: 'csv',
      config: {
        sourceKind: 'csv',
        header: 'auto',
        dataRegion: 'auto',
        encoding: 'auto',
        delimiter: 'auto',
        cloudMirror: { spaceId: 's', tableName: '云表' },
      } as never,
    });
    const source = (await store.listRawSources()).find((s) => s.id === table.sourceId)!;
    expect(source.sourceKind).toBe('cloud');
    expect(source.buildMode).toBe('cloud_table');
    await expect(store.refreshRawSource(source.id)).rejects.toThrow(/E_CLOUD_SOURCE_REFRESH/);
  });
});

describe('pagination never splits a source', () => {
  it('pages by list unit: a source with N tables counts as one unit', async () => {
    const { store, root } = makeStore();
    const file = writeWorkbook(path.join(root, '多表.xlsx'), {
      a: SALES,
      b: SALES,
      c: SALES,
    });
    await store.createRawSource({
      sourcePath: file,
      buildMode: 'excel_per_sheet',
      members: [{ key: 'a' }, { key: 'b' }, { key: 'c' }],
    });
    for (const name of ['x', 'y']) {
      const csv = path.join(root, `${name}.csv`);
      fs.writeFileSync(csv, 'k\n1\n');
      await store.importRawTable({ filePath: csv, name });
    }
    const seen: string[][] = [];
    for (let page = 0; page < 3; page += 1) {
      const dash = await store.getDashboard({
        includeRawTables: true,
        rawTableGroupId: null,
        rawTableLimit: 2,
        rawTableOffset: page * 2,
      });
      seen.push(dash.rawTables.map((table) => table.name));
      expect(dash.rawTableGroupCounts.ungrouped).toBe(3);
    }
    const pageOfSheet = (name: string) => seen.findIndex((names) => names.includes(name));
    const sheetPages = ['多表 / a', '多表 / b', '多表 / c'].map(pageOfSheet);
    expect(new Set(sheetPages).size).toBe(1);
    expect(sheetPages[0]).toBeGreaterThanOrEqual(0);
    expect(seen.flat().sort()).toEqual(['x', 'y', '多表 / a', '多表 / b', '多表 / c'].sort());
  });
});
