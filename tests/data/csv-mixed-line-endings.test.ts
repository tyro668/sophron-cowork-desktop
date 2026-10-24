import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  createDataPipelineStore,
  type DataPipelineStore,
} from '../../src/main/data/data-pipeline-store';
import {
  countLineEndings,
  csvLineEndingTempDir,
  hasMixedLineEndings,
  withNormalizedLineEndings,
  writeNormalizedCopy,
} from '../../src/main/data/store/csv-line-endings';

const tempRoots: string[] = [];
const stores: DataPipelineStore[] = [];
afterEach(() => {
  while (stores.length > 0) stores.pop()?.close();
  while (tempRoots.length > 0) fs.rmSync(tempRoots.pop()!, { recursive: true, force: true });
});

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-eol-'));
  tempRoots.push(root);
  return root;
}
function makeStore() {
  const root = makeRoot();
  const store = createDataPipelineStore(path.join(root, 'workspace.duckdb'));
  stores.push(store);
  return { store, root };
}
const tempFiles = () =>
  fs.existsSync(csvLineEndingTempDir()) ? fs.readdirSync(csvLineEndingTempDir()) : [];

const ROWS = ['门店,销量', '东区,1', '西区,2', '南区,3', '北区,4'];
const MIXED = `${ROWS[0]}\r\n${ROWS[1]}\n${ROWS[2]}\r\n${ROWS[3]}\r${ROWS[4]}\n`;

async function importCsv(store: DataPipelineStore, file: string) {
  const created = await store.createRawSource({ sourcePath: file, buildMode: 'single' });
  const table = created.tables[0];
  const preview = await store.previewRawTable({ id: table.id, limit: 10 });
  return { table, preview };
}

describe('line-ending scanner', () => {
  it('classifies mixed vs uniform files and ignores breaks inside quotes', () => {
    const root = makeRoot();
    const write = (name: string, text: string) => {
      const file = path.join(root, name);
      fs.writeFileSync(file, text);
      return file;
    };
    expect(hasMixedLineEndings(write('m.csv', MIXED))).toBe(true);
    expect(hasMixedLineEndings(write('crlf.csv', ROWS.join('\r\n') + '\r\n'))).toBe(false);
    expect(hasMixedLineEndings(write('lf.csv', ROWS.join('\n') + '\n'))).toBe(false);
    expect(hasMixedLineEndings(write('cr.csv', ROWS.join('\r') + '\r'))).toBe(false);
    // CRLF rows with an LF inside a quoted cell (Excel multi-line cell) are not "mixed".
    const quoted = write('q.csv', 'a,b\r\n"x\ny",1\r\n"p""\nq",2\r\n');
    expect(countLineEndings(quoted)).toEqual({ crlf: 3, lf: 0, cr: 0 });
    expect(hasMixedLineEndings(quoted)).toBe(false);
  });

  it('handles a \\r\\n pair split across a chunk boundary', () => {
    const root = makeRoot();
    const file = path.join(root, 'b.csv');
    const text = 'ab\r\ncd\nef\r\n';
    fs.writeFileSync(file, text);
    // chunk size 3 splits "ab\r" | "\ncd" — the pair must count once, not as CR + LF.
    expect(countLineEndings(file, 3)).toEqual({ crlf: 2, lf: 1, cr: 0 });
    for (const size of [1, 2, 3, 4, 5, 7]) {
      const copy = writeNormalizedCopy(file, size);
      expect(fs.readFileSync(copy, 'utf8')).toBe('ab\ncd\nef\n');
      fs.rmSync(copy);
    }
  });

  it('keeps quoted line breaks untouched while normalizing', () => {
    const root = makeRoot();
    const file = path.join(root, 'q.csv');
    fs.writeFileSync(file, 'a,b\r\n"x\r\ny",1\n"z\rw",2\r');
    const copy = writeNormalizedCopy(file, 4);
    expect(fs.readFileSync(copy, 'utf8')).toBe('a,b\n"x\r\ny",1\n"z\rw",2\n');
    fs.rmSync(copy);
  });

  it('removes the temp copy after the read, also when the read throws', async () => {
    const root = makeRoot();
    const file = path.join(root, 'm.csv');
    fs.writeFileSync(file, MIXED);
    const before = tempFiles().length;
    let seen = '';
    await withNormalizedLineEndings(file, async (p) => {
      seen = p;
      expect(fs.existsSync(p)).toBe(true);
    });
    expect(seen).not.toBe(file);
    expect(fs.existsSync(seen)).toBe(false);
    await expect(
      withNormalizedLineEndings(file, async (p) => {
        seen = p;
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(fs.existsSync(seen)).toBe(false);
    expect(tempFiles().length).toBe(before);
    // Uniform files are read in place.
    const lf = path.join(root, 'lf.csv');
    fs.writeFileSync(lf, ROWS.join('\n'));
    await withNormalizedLineEndings(lf, async (p) => expect(p).toBe(lf));
  });
});

describe('importing CSVs with mixed line endings', () => {
  it.each([
    ['mixed', MIXED],
    ['crlf', ROWS.join('\r\n') + '\r\n'],
    ['lf', ROWS.join('\n') + '\n'],
    ['cr', ROWS.join('\r') + '\r'],
  ])(
    '%s file imports 4 rows with correct values and leaves the source untouched',
    async (name, text) => {
      const { store, root } = makeStore();
      const file = path.join(root, `${name}.csv`);
      fs.writeFileSync(file, text);
      const before = tempFiles().length;
      const { table, preview } = await importCsv(store, file);
      expect(table.rowCount).toBe(4);
      expect(preview.columns).toEqual(['门店', '销量']);
      expect(preview.rows.map((row) => row['门店'])).toEqual(['东区', '西区', '南区', '北区']);
      expect(fs.readFileSync(file, 'utf8')).toBe(text);
      expect(table.sourcePath).toBe(file);
      expect(tempFiles().length).toBe(before);
      // Refresh goes through the same path.
      const refreshed = await store.refreshRawSource(table.sourceId!);
      expect(refreshed.failed).toEqual([]);
    }
  );

  it('folder merge with a mixed CSV keeps the original file name in _来源文件', async () => {
    const { store, root } = makeStore();
    const dir = path.join(root, '门店');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'a.csv'), MIXED);
    fs.writeFileSync(path.join(dir, 'b.csv'), 'k,v\n'.replace('k,v', '门店,销量') + '中区,5\n');
    const before = tempFiles().length;
    const created = await store.createRawSource({ sourcePath: dir, buildMode: 'folder_merge' });
    const table = created.tables[0];
    expect(table.rowCount).toBe(5);
    const preview = await store.previewRawTable({ id: table.id, limit: 10 });
    const files = new Set(preview.rows.map((row) => String(row['_来源文件'])));
    expect(files).toEqual(new Set(['a.csv', 'b.csv']));
    expect(tempFiles().length).toBe(before);
  });

  it('imports a ~100k-row mixed file', async () => {
    const { store, root } = makeStore();
    const file = path.join(root, 'big.csv');
    const lines = ['id,name,amount'];
    for (let i = 0; i < 100_000; i += 1) lines.push(`${i},"名称 ${i}",${i * 3}`);
    fs.writeFileSync(
      file,
      lines.map((line, i) => line + (i % 3 === 0 ? '\r\n' : i % 3 === 1 ? '\n' : '\r')).join('')
    );
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const t0 = performance.now();
    const copy = writeNormalizedCopy(file);
    const normalizeMs = performance.now() - t0;
    fs.rmSync(copy);
    const t1 = performance.now();
    const { table } = await importCsv(store, file);
    const importMs = performance.now() - t1;
    log.mockRestore();
    expect(table.rowCount).toBe(100_000);
    const size = (fs.statSync(file).size / 1024 / 1024).toFixed(1);
    fs.writeFileSync(
      path.join(os.tmpdir(), 'sophron-csv-eol-perf.txt'),
      `[perf] mixed CSV ${size}MB/100k rows: scan+normalize ${normalizeMs.toFixed(0)}ms, full import ${importMs.toFixed(0)}ms`
    );
    expect(normalizeMs).toBeLessThan(5000);
  }, 60_000);
});
