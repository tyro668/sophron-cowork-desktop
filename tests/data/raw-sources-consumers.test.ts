import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as XLSX from '../../src/main/utils/xlsx';
import {
  createDataPipelineStore,
  type DataPipelineStore,
} from '../../src/main/data/data-pipeline-store';
import { createRawTableReimporter } from '../../src/main/automation/raw-table-reimport';

const tempRoots: string[] = [];
const stores: DataPipelineStore[] = [];
afterEach(() => {
  while (stores.length > 0) stores.pop()?.close();
  while (tempRoots.length > 0) fs.rmSync(tempRoots.pop()!, { recursive: true, force: true });
});

function makeStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-consumers-'));
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

const CUSTOMERS = [
  ['客户ID', '客户名'],
  [1, '甲'],
  [2, '乙'],
];
const orders = (n: number) => [
  ['订单ID', '客户ID', '金额'],
  ...Array.from({ length: n }, (_, i) => [100 + i, (i % 2) + 1, (i + 1) * 10]),
];

async function joinPipeline(store: DataPipelineStore, ordersId: string, customersId: string) {
  const out = await store.createResultTable({ name: '订单客户' });
  const pipeline = await store.createPipeline({ name: 'join' });
  await store.savePipelineWorkflow(pipeline.id, {
    nodes: [
      {
        id: 'a',
        type: 'input',
        label: '订单',
        x: 0,
        y: 0,
        config: { source: 'rawTable', rawTableId: ordersId, alias: 'ord' },
      },
      {
        id: 'b',
        type: 'input',
        label: '客户',
        x: 0,
        y: 100,
        config: { source: 'rawTable', rawTableId: customersId, alias: 'cust' },
      },
      {
        id: 'j',
        type: 'join',
        label: 'j',
        x: 200,
        y: 0,
        config: {
          joinType: 'left',
          conditions: [{ left: '客户ID', right: '客户ID', operator: '=' }],
          conflict: { strategy: 'right_prefix', rightPrefix: 'c_' },
        },
      },
      {
        id: 'out',
        type: 'output',
        label: 'out',
        x: 400,
        y: 0,
        config: { outputResultTableId: out.id, mode: 'replace' },
      },
    ],
    edges: [
      { id: 'e1', sourceNodeId: 'a', targetNodeId: 'j', targetHandle: 'left' },
      { id: 'e2', sourceNodeId: 'b', targetNodeId: 'j', targetHandle: 'right' },
      { id: 'e3', sourceNodeId: 'j', targetNodeId: 'out' },
    ],
  } as never);
  return { pipelineId: pipeline.id, resultId: out.id };
}

describe('raw 1:N consumers', () => {
  it('a suspected rename blocks pipelines with E_SOURCE_MEMBER_MISSING until resolved', async () => {
    const { store, root } = makeStore();
    const file = writeWorkbook(path.join(root, '经营.xlsx'), { 客户: CUSTOMERS, 订单: orders(4) });
    const created = await store.createRawSource({
      sourcePath: file,
      buildMode: 'excel_per_sheet',
      members: [{ key: '客户' }, { key: '订单' }],
    });
    const customers = created.tables.find((t) => t.memberKey === '客户')!;
    const orderTable = created.tables.find((t) => t.memberKey === '订单')!;
    const { pipelineId, resultId } = await joinPipeline(store, orderTable.id, customers.id);
    expect((await store.runPipeline(pipelineId)).rowCount).toBe(4);

    writeWorkbook(file, { 顾客: CUSTOMERS, 订单: orders(6) });
    const refreshed = await store.refreshRawSource(created.source.id);
    expect(refreshed.renames.map((r) => r.newKey)).toEqual(['顾客']);
    expect(refreshed.refreshed).toEqual([orderTable.id]);
    expect((await store.getRawTableRecord(customers.id))!.memberStatus).toBe('missing');
    await expect(store.runPipeline(pipelineId)).rejects.toThrow(/E_SOURCE_MEMBER_MISSING/);
    expect((await store.getResultTableRecord(resultId))!.rowCount).toBe(4);

    await store.resolveRawSourceRenames({
      sourceId: created.source.id,
      decisions: [{ tableId: customers.id, newKey: '顾客', action: 'rename' }],
    });
    expect((await store.getRawTableRecord(customers.id))!.memberStatus).toBe('ok');
    expect((await store.runPipeline(pipelineId)).rowCount).toBe(6);
  });

  it('file-watch reimport of a source member refreshes the whole source once', async () => {
    const { store, root } = makeStore();
    const file = writeWorkbook(path.join(root, '经营.xlsx'), { 客户: CUSTOMERS, 订单: orders(4) });
    const created = await store.createRawSource({
      sourcePath: file,
      buildMode: 'excel_per_sheet',
      members: [{ key: '客户' }, { key: '订单' }],
    });
    writeWorkbook(file, { 客户: [...CUSTOMERS, [3, '丙']], 订单: orders(7) });
    const refresh = vi.spyOn(store, 'refreshRawSource');
    const reimport = createRawTableReimporter(store);
    await Promise.all(created.tables.map((t) => reimport(t.id)));
    expect(refresh).toHaveBeenCalledTimes(1);
    const counts = await Promise.all(
      created.tables.map(async (t) => (await store.getRawTableRecord(t.id))!.rowCount)
    );
    expect(counts.sort()).toEqual([3, 7]);
  });

  it('file-watch reimport of a standalone table still re-reads its file', async () => {
    const updateRawTable = vi.fn(async () => undefined);
    const refreshRawSource = vi.fn(async () => undefined);
    const reimport = createRawTableReimporter({
      getRawTableRecord: async () => ({ id: 't', sourcePath: '/x.csv', sourceId: null }) as never,
      updateRawTable,
      refreshRawSource,
    });
    await reimport('t');
    expect(updateRawTable).toHaveBeenCalledWith({ id: 't', filePath: '/x.csv' });
    expect(refreshRawSource).not.toHaveBeenCalled();
  });
});
