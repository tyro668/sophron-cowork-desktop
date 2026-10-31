import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  createDataPipelineStore,
  type DataPipelineStore,
} from '../../src/main/data/data-pipeline-store';

const stores: DataPipelineStore[] = [];
const roots: string[] = [];

afterEach(() => {
  while (stores.length > 0) stores.pop()?.close();
  while (roots.length > 0) fs.rmSync(roots.pop() as string, { recursive: true, force: true });
});

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-refresh-health-'));
  roots.push(root);
  const store = createDataPipelineStore(path.join(root, 'workspace.duckdb'));
  stores.push(store);
  return { root, store, csv: path.join(root, 'data.csv') };
}

const rows = (count: number, value = (i: number) => `v${i}`) =>
  Array.from({ length: count }, (_, i) => `${i},${value(i)}`).join('\n');

describe('raw table refresh checks', () => {
  it('keeps the old rows and marks 数据异常 when a refresh loses columns or most rows', async () => {
    const { store, csv } = setup();
    fs.writeFileSync(csv, `id,value\n${rows(20)}\n`, 'utf8');
    const table = await store.importRawTable({ filePath: csv });
    expect(table.health ?? null).toBeNull();

    // Column gone.
    fs.writeFileSync(csv, `id\n${Array.from({ length: 20 }, (_, i) => i).join('\n')}\n`, 'utf8');
    await expect(store.updateRawTable({ id: table.id, filePath: csv })).rejects.toThrow(
      /E_RAW_TABLE_ABNORMAL: 刷新后缺少列：value/
    );
    let record = await store.getRawTableRecord(table.id);
    expect(record?.rowCount).toBe(20);
    expect(record?.health).toMatchObject({ status: 'abnormal', reason: '刷新后缺少列：value' });

    // Sharp row drop.
    fs.writeFileSync(csv, `id,value\n${rows(3)}\n`, 'utf8');
    await expect(store.updateRawTable({ id: table.id, filePath: csv })).rejects.toThrow(
      /行数从 20 降到 3/
    );

    // A column that had data is now entirely empty.
    fs.writeFileSync(csv, `id,value\n${rows(20, () => '')}\n`, 'utf8');
    await expect(store.updateRawTable({ id: table.id, filePath: csv })).rejects.toThrow(
      /「value」列全为空/
    );
    const preview = await store.previewRawTable({ id: table.id });
    expect(preview.rows.map((row) => String(row.value)).slice(0, 2)).toEqual(['v0', 'v1']);

    // A good refresh replaces the rows and clears the marker.
    fs.writeFileSync(csv, `id,value\n${rows(25)}\n`, 'utf8');
    const refreshed = await store.updateRawTable({ id: table.id, filePath: csv });
    expect(refreshed.rowCount).toBe(25);
    record = await store.getRawTableRecord(table.id);
    expect(record?.health ?? null).toBeNull();
  });

  it('does not apply refresh checks when the user points the table at another file', async () => {
    const { root, store, csv } = setup();
    fs.writeFileSync(csv, `id,value\n${rows(20)}\n`, 'utf8');
    const table = await store.importRawTable({ filePath: csv });
    const other = path.join(root, 'other.csv');
    fs.writeFileSync(other, 'name\nx\n', 'utf8');
    const updated = await store.updateRawTable({ id: table.id, filePath: other });
    expect(updated.rowCount).toBe(1);
    expect(updated.health ?? null).toBeNull();
  });
});
