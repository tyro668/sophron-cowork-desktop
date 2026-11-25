/**
 * 云连接「分组 / 手动表」读取层与 Java 本地宝的一致性：
 * - 配置模型（ExcelTableBean 默认值 / 校验 / 路径拼接）；
 * - ExcelUtils.getFiles（单文件、当前目录 / 递归、排序策略、隐藏与临时文件）；
 * - LocalFileNameVisitor（自动表排除手动表的目录与文件）；
 * - IndexMerge / NameMerge（fixture 由 Java 类生成，见 merge-oracle.txt）；
 * - 合并表读取：表头行、Sheet 选择策略、所有列作为文本、加密文件、上报 JSON。
 */
import { readFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { FieldType, type CellData } from '../../src/main/local-agent/excel/field-type';
import {
  DEFAULT_EXCEL_TABLE,
  formatAbsolutePath,
  normalizeExcelTable,
  validateExcelTable,
  validateGroupName,
  type ExcelTableConfig,
} from '../../src/main/local-agent/excel/local-config';
import {
  LocalExcelSource,
  toSourceTableJson,
} from '../../src/main/local-agent/excel/local-excel-source';
import {
  emptyPathMessage,
  getNoEmptyTableFiles,
  getTableFiles,
  scanAutoTableFiles,
} from '../../src/main/local-agent/excel/local-files';
import { IndexMerge, NameMerge, type MergeAppender } from '../../src/main/local-agent/excel/merge';

const FIXTURES = path.join(__dirname, 'fixtures/java/settings');

function table(patch: Partial<ExcelTableConfig>): ExcelTableConfig {
  return normalizeExcelTable({ tableName: 't', relativeFilePath: '/', ...patch });
}

function writeXlsx(file: string, sheets: Record<string, unknown[][]>): void {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  XLSX.writeFile(wb, file);
}

describe('config model (ExcelTableBean / FolderForm)', () => {
  it('uses Java defaults and getter semantics', () => {
    expect(DEFAULT_EXCEL_TABLE).toMatchObject({
      strategy: 5,
      fieldStrategy: 0,
      readStrategy: 0,
      appendStrategy: 0,
      headerRowNumber: 1,
      sheetStrategy: 0,
      sheetNumber: 1,
      sheetName: 'Sheet1',
    });
    const t = normalizeExcelTable({
      tableName: ' a ',
      relativeFilePath: 'x\\y.xlsx',
      headerRowNumber: 0,
      sheetNumber: -2,
    });
    expect(t).toMatchObject({
      tableName: 'a',
      relativeFilePath: '/x/y.xlsx',
      headerRowNumber: 1,
      sheetNumber: 1,
    });
    expect(formatAbsolutePath(t, '/base/')).toBe('/base/x/y.xlsx');
    expect(formatAbsolutePath(table({ relativeFilePath: '/' }), '/base')).toBe('/base');
  });

  it('validates group names and tables like agent-ui', () => {
    expect(validateGroupName('', [])).toBe('required');
    expect(validateGroupName('a&b', [])).toBe('ampersand');
    expect(validateGroupName('a', ['a'])).toBe('duplicate');
    expect(validateGroupName('b', ['a'])).toBeNull();
    expect(validateExcelTable(table({ tableName: '' }), [])).toBe('nameRequired');
    expect(validateExcelTable(table({}), ['t'])).toBe('nameDuplicate');
    expect(validateExcelTable(table({ strategy: 0, relativeFilePath: '/' }), [])).toBe(
      'pathRequired'
    );
    expect(validateExcelTable(table({ strategy: 5, relativeFilePath: '/' }), [])).toBeNull();
  });
});

describe('IndexMerge / NameMerge (Java oracle)', () => {
  const scenarios = readFileSync(path.join(FIXTURES, 'merge-scenarios.txt'), 'utf8');
  const expected = readFileSync(path.join(FIXTURES, 'merge-oracle.txt'), 'utf8');

  function run(): string {
    const out: string[] = [];
    let app: MergeAppender | null = null;
    let result: CellData[] | null = null;
    let cur: CellData[] = [];
    let file = '';
    let name: string | null = null;
    let rows: string[] = [];
    const flush = () => {
      out.push(`SCENARIO ${name}`);
      out.push(`HEAD ${result!.map((c) => `${c.data}:${c.type}`).join('|')}`);
      for (const r of rows) out.push(`ROW ${r}`);
    };
    for (const line of scenarios.split('\n')) {
      if (!line) continue;
      const [kind, rest = ''] = [
        line.slice(0, line.indexOf(' ')),
        line.slice(line.indexOf(' ') + 1),
      ];
      if (kind === 'SCENARIO') {
        if (name) flush();
        const [n, strategy] = rest.split(' ');
        name = n;
        app = strategy === 'NAME' ? new NameMerge() : new IndexMerge();
        result = null;
        rows = [];
      } else if (kind === 'FILE') file = rest;
      else if (kind === 'HEAD') {
        cur = rest.split('|').map((c) => {
          const [data, type] = c.split(':');
          return { data, type: type as FieldType };
        });
        result = app!.appendHeaderNames(result, cur);
        result = app!.appendHeaderTypes(result, cur);
      } else if (kind === 'ROW') {
        const values = rest.split('|').map((v) => (v === '~' ? null : v));
        const row = app!.appendRow(result, cur, values, ['dir', file, 'S']);
        rows.push(row.map((v) => (v === null ? '~' : v)).join('|'));
      }
    }
    if (name) flush();
    return `${out.join('\n')}\n`;
  }

  it('produces the same merged header and rows as Java', () => {
    expect(run()).toBe(expected);
  });
});

describe('file selection and reading', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'cc-settings-'));
    // 合并目录 m：按名称排序 b10 < b2（编码顺序），自然顺序 b2 < b10
    await mkdir(path.join(dir, 'm', 'sub'), { recursive: true });
    await writeFile(path.join(dir, 'm', 'b10.csv'), 'k,v\n10,x\n');
    await writeFile(path.join(dir, 'm', 'b2.csv'), 'k,v,extra\n2,y,e\n');
    await writeFile(path.join(dir, 'm', 'sub', 'b1.csv'), 'k,v\n1,z\n');
    await writeFile(path.join(dir, 'm', '~$lock.csv'), 'x\n');
    await writeFile(path.join(dir, 'm', '.hidden.csv'), 'x\n');
    await writeFile(path.join(dir, 'm', 'readme.txt'), 'x\n');
    await utimes(path.join(dir, 'm', 'b10.csv'), 1000, 1000);
    await utimes(path.join(dir, 'm', 'b2.csv'), 2000, 2000);
    // 名称合并目录
    await mkdir(path.join(dir, 'n'));
    await writeFile(path.join(dir, 'n', 'a.csv'), 'k,v\n1,a\n');
    await writeFile(path.join(dir, 'n', 'b.csv'), 'v,new,k\nb,7,2\n');
    // 带说明行的工作簿：表头在第 3 行；两个 sheet
    writeXlsx(path.join(dir, 'book.xlsx'), {
      First: [['说明'], [], ['name', 'qty'], ['a', 1], ['b', 2]],
      Second: [
        ['x', 'y'],
        ['1', '2'],
      ],
    });
    await writeFile(path.join(dir, 'top.csv'), 'c\n1\n');
    await copyFile(path.join(FIXTURES, 'enc-agile.xlsx'), path.join(dir, 'm', 'enc.xlsx'));
    await utimes(path.join(dir, 'm', 'enc.xlsx'), 3000, 3000);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const names = (files: Array<{ fileName: string }>) =>
    files.map((f) => path.relative(dir, f.fileName).split(path.sep).join('/'));

  it('selects and sorts files like ExcelUtils.getFiles', async () => {
    const base = table({ relativeFilePath: '/m' });
    expect(names(await getTableFiles(dir, base))).toEqual(['m/b10.csv', 'm/b2.csv', 'm/enc.xlsx']);
    expect(names(await getTableFiles(dir, { ...base, strategy: 4 }))).toEqual([
      'm/b2.csv',
      'm/b10.csv',
      'm/enc.xlsx',
    ]);
    expect(names(await getTableFiles(dir, { ...base, strategy: 2 }))).toEqual([
      'm/b10.csv',
      'm/b2.csv',
      'm/enc.xlsx',
    ]);
    expect(names(await getTableFiles(dir, { ...base, readStrategy: 1 }))).toEqual([
      'm/b10.csv',
      'm/b2.csv',
      'm/enc.xlsx',
      'm/sub/b1.csv',
    ]);
    expect(
      names(await getTableFiles(dir, table({ strategy: 0, relativeFilePath: '/top.csv' })))
    ).toEqual(['top.csv']);
    await expect(getNoEmptyTableFiles(dir, table({ relativeFilePath: '/nope' }))).rejects.toThrow(
      emptyPathMessage(path.join(dir, '/nope'))
    );
  });

  it('excludes manual table paths from auto tables (LocalFileNameVisitor)', async () => {
    const rel = async (strategy: number, tables: ExcelTableConfig[]) =>
      (await scanAutoTableFiles(dir, strategy, tables)).map((f) => f.relativePath).sort();
    expect(await rel(1, [])).toEqual(['book.xlsx', 'top.csv']);
    expect(await rel(2, [table({ relativeFilePath: '/m' })])).toEqual([
      'book.xlsx',
      'n/a.csv',
      'n/b.csv',
      'top.csv',
    ]);
    expect(await rel(1, [table({ strategy: 0, relativeFilePath: '/top.csv' })])).toEqual([
      'book.xlsx',
    ]);
    expect(await rel(2, [table({ relativeFilePath: '/' })])).toEqual([]);
    expect(await rel(0, [])).toEqual([]);
  });

  it('reads a merged table: IndexMerge, sort order, system fields, wrong-password files skipped', async () => {
    const source = new LocalExcelSource({
      sourceName: 'g',
      directoryPath: dir,
      strategy: 1,
      tables: [table({ tableName: '合并', relativeFilePath: '/m', strategy: 3 })],
    });
    const tables = await source.listTables();
    expect(tables.map((t) => [t.id, t.manual])).toEqual([
      ['合并', true],
      ['book.xlsx_First', false],
      ['book.xlsx_Second', false],
      ['top.csv', false],
    ]);
    expect(toSourceTableJson(tables[0])).toEqual({ id: '合并', manual: true, type: 'excel' });
    expect(toSourceTableJson(tables[1])).toMatchObject({
      id: 'book.xlsx_First',
      fileName: 'book.xlsx',
      sheetName: 'First',
    });
    const merged = await source.readTable(tables[0]);
    expect(merged.head.map((c) => c.data)).toEqual(['k', 'v', 'extra']);
    // 编码顺序 b10 < b2；系统字段 = 分组目录名/相对目录、文件名、sheet 名（CSV 为文件名去扩展名）；
    // enc.xlsx 无密码 → Java 对按序号读取的 item 忽略异常（合并表只追加能打开的文件）
    expect(merged.rows).toEqual([
      ['10', 'x', `${path.basename(dir)}/m`, 'b10.csv', 'b10'],
      ['2', 'y', 'e', `${path.basename(dir)}/m`, 'b2.csv', 'b2'],
    ]);
    expect(await source.rowCount(tables[0])).toBe(2);
  });

  it('reads encrypted files with the table password', async () => {
    const source = new LocalExcelSource({
      sourceName: 'g',
      directoryPath: dir,
      strategy: 0,
      tables: [
        table({
          tableName: 'enc',
          strategy: 0,
          relativeFilePath: '/m/enc.xlsx',
          password: 'pw123',
        }),
        table({ tableName: 'bad', strategy: 0, relativeFilePath: '/m/enc.xlsx', password: 'no' }),
      ],
    });
    const [enc] = await source.listTables();
    const rows = await source.readTable(enc);
    expect(rows.head.map((c) => [c.data, c.type])).toEqual([
      ['name', FieldType.STRING],
      ['qty', FieldType.NUMBER],
    ]);
    expect(rows.rows.map((r) => r.slice(0, 2))).toEqual([
      ['a', '1'],
      ['b', '2'],
      ['c', '3'],
    ]);
    const bad = (await source.listTables())[1];
    await expect(source.readTable(bad)).rejects.toThrow();
  });

  it('applies NameMerge, header row, sheet strategies and all-text columns', async () => {
    const source = new LocalExcelSource({
      sourceName: 'g',
      directoryPath: dir,
      strategy: 0,
      tables: [
        table({ tableName: 'byName', relativeFilePath: '/n', appendStrategy: 1 }),
        table({
          tableName: 'header3',
          strategy: 0,
          relativeFilePath: '/book.xlsx',
          headerRowNumber: 3,
        }),
        table({
          tableName: 'sheetName',
          strategy: 0,
          relativeFilePath: '/book.xlsx',
          sheetStrategy: 1,
          sheetName: 'Second',
          fieldStrategy: 1,
        }),
        table({
          tableName: 'missingSheet',
          strategy: 0,
          relativeFilePath: '/book.xlsx',
          sheetStrategy: 1,
          sheetName: 'Nope',
        }),
        table({
          tableName: 'allSheets',
          strategy: 0,
          relativeFilePath: '/book.xlsx',
          sheetStrategy: 2,
        }),
      ],
    });
    const get = async (id: string) => (await source.getTable(id))!;

    const byName = await source.readTable(await get('byName'));
    expect(byName.head.map((c) => c.data)).toEqual(['k', 'v', 'new']);
    expect(byName.rows).toEqual([
      ['1', 'a', `${path.basename(dir)}/n`, 'a.csv', 'a'],
      ['2', 'b', '7', `${path.basename(dir)}/n`, 'b.csv', 'b'],
    ]);

    const header3 = await source.readTable(await get('header3'));
    expect(header3.head.map((c) => [c.data, c.type])).toEqual([
      ['name', FieldType.STRING],
      ['qty', FieldType.NUMBER],
    ]);
    expect(header3.rows.map((r) => r.slice(0, 2))).toEqual([
      ['a', '1'],
      ['b', '2'],
    ]);

    const second = await source.readTable(await get('sheetName'));
    expect(second.head.map((c) => [c.data, c.type])).toEqual([
      ['x', FieldType.STRING],
      ['y', FieldType.STRING],
    ]);
    expect(second.rows[0].slice(-1)).toEqual(['Second']);

    // 按名字选择且 sheet 不存在：Java 抛出（sheetName 不为空的 item 不忽略异常）
    await expect(source.readTable(await get('missingSheet'))).rejects.toThrow();

    const all = await source.readTable(await get('allSheets'));
    expect(all.rows.length).toBeGreaterThan(2);
    expect(new Set(all.rows.map((r) => r[r.length - 1]))).toEqual(new Set(['First', 'Second']));
  });
});
