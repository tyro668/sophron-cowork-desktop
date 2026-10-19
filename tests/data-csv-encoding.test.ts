import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  createDataPipelineStore,
  type DataPipelineStore,
} from '../src/main/data/data-pipeline-store';
import {
  CsvEncodingError,
  isCsvDecodeError,
  isValidUtf8File,
  resolveCsvReadPath,
} from '../src/main/data/store/csv-encoding';
import { formatDataErrorMessage } from '../src/renderer/features/data/model/errors';

const tempRoots: string[] = [];
const stores: DataPipelineStore[] = [];

afterEach(() => {
  while (stores.length > 0) stores.pop()?.close();
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-csv-enc-'));
  tempRoots.push(root);
  return root;
}

// "订单号,省份,金额\nSO001,广东,12.5\nSO002,浙江,8\n" encoded as GBK.
const GBK_CSV = Buffer.from(
  'b6a9b5a5bac52ccaa1b7dd2cbdf0b6ee0a534f3030312cb9e3b6ab2c31322e350a534f3030322cd5e3bdad2c380a',
  'hex'
);

describe('CSV encoding handling', () => {
  it('keeps UTF-8 (with BOM) files untouched', () => {
    const file = path.join(tempDir(), 'utf8.csv');
    fs.writeFileSync(file, '\ufeff订单号,金额\nSO001,1\n', 'utf8');
    expect(isValidUtf8File(file)).toBe(true);
    expect(resolveCsvReadPath(file)).toBe(file);
  });

  it('transcodes GBK files to a cached UTF-8 copy in auto and gbk modes', () => {
    const file = path.join(tempDir(), 'gbk.csv');
    fs.writeFileSync(file, GBK_CSV);
    expect(isValidUtf8File(file)).toBe(false);
    const auto = resolveCsvReadPath(file);
    expect(auto).not.toBe(file);
    expect(fs.readFileSync(auto, 'utf8')).toContain('订单号,省份,金额');
    expect(resolveCsvReadPath(file, 'gbk')).toBe(auto);
  });

  it('rejects non UTF-8 content when UTF-8 is forced', () => {
    const file = path.join(tempDir(), 'gbk.csv');
    fs.writeFileSync(file, GBK_CSV);
    expect(() => resolveCsvReadPath(file, 'utf-8')).toThrow(CsvEncodingError);
  });

  it('maps decode failures to a localized message', () => {
    const raw =
      "Error invoking remote method 'data.importRawTable': Invalid Input Error: Invalid unicode (byte sequence mismatch) detected. This file is not utf-8 encoded.";
    expect(isCsvDecodeError(new Error(raw))).toBe(true);
    const t = ((key: string) => `t:${key}`) as never;
    expect(formatDataErrorMessage(new Error(raw), t)).toBe('t:data.rawTables.errors.csvEncoding');
    expect(formatDataErrorMessage(new Error('boom'), t)).toBe('boom');
  });

  it('imports and previews a GBK CSV as a raw table with Chinese headers', async () => {
    const root = tempDir();
    const file = path.join(root, '订单.csv');
    fs.writeFileSync(file, GBK_CSV);
    const store = createDataPipelineStore(path.join(root, 'workspace.duckdb'));
    stores.push(store);

    const preview = await store.previewRawTableSource({
      filePath: file,
      sourceKind: 'csv',
      config: {
        sourceKind: 'csv',
        header: 'auto',
        dataRegion: 'auto',
        encoding: 'auto',
        delimiter: 'auto',
      },
    });
    expect(preview.columns).toEqual(['订单号', '省份', '金额']);
    expect(preview.totalRows).toBe(2);

    const imported = await store.importRawTable({ filePath: file, sourceKind: 'csv' });
    expect(imported.rowCount).toBe(2);
    expect(imported.columnCount).toBe(3);
    const rows = await store.previewRawTable({ id: imported.id, limit: 10 });
    expect(rows.columns).toEqual(['订单号', '省份', '金额']);
    expect(rows.rows[0]).toMatchObject({ 订单号: 'SO001', 省份: '广东' });
  });
});
