import { readFileSync } from 'node:fs';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { analyzeCells, getBlankColumnIndex } from '../../src/main/local-agent/excel/analyzer';
import {
  decodeCsvBuffer,
  detectCsvDelimiter,
  parseCsvRecords,
} from '../../src/main/local-agent/excel/csv-text';
import {
  ColumnType,
  DateParserContext,
  ExcelFieldTypeParser,
  FieldType,
  fieldTypeFromFormat,
  formatExcelValue,
  getTreatedFieldNames,
  normalizeSpace,
  numberToText,
  parseExcelValueType,
  speType,
  type CellData,
} from '../../src/main/local-agent/excel/field-type';
import { LocalExcelSource } from '../../src/main/local-agent/excel/local-excel-source';
import { excelDateToText } from '../../src/main/local-agent/excel/table-reader';

const S = FieldType.STRING;
const cell = (data: string, type: FieldType = FieldType.INFER): CellData => ({ data, type });

describe('excel value type inference (ExcelUtils.parseExcelValueType)', () => {
  // value-types.json 由 hihidata-excel-3.0.4 的 ExcelUtils.parseExcelValueType 实际运行生成
  const golden = JSON.parse(
    readFileSync(path.join(__dirname, 'fixtures/java/value-types.json'), 'utf8')
  ) as [string, string][];
  it.each(golden)('%j → %s (same as Java)', (value, expected) => {
    expect(parseExcelValueType(value, new DateParserContext())).toBe(expected);
  });
});

describe('ExcelFieldTypeParser voting', () => {
  it('mixed types fall back to STRING, date mixes to DATE, INFER to STRING', () => {
    const rows = [
      [cell('1'), cell('2024-01-01'), cell('a'), cell('')],
      [cell('x'), cell('2024-01-02 10:00:00'), cell('b'), cell('')],
    ];
    const result = new ExcelFieldTypeParser(4, 2).addData(rows).getResult();
    expect(result[0]).toBe(S);
    expect([FieldType.DATE, FieldType.YEAR_MONTH_DAY]).toContain(result[1]);
    expect(result[2]).toBe(S);
    expect(result[3]).toBe(S);
  });
});

describe('field helpers', () => {
  it('speType mapping', () => {
    expect(speType(FieldType.STRING)).toBe(ColumnType.String);
    expect(speType(FieldType.NUMBER)).toBe(5);
    expect(speType(FieldType.DATE)).toBe(9);
    expect(speType(FieldType.INFER)).toBe(6);
  });
  it('field name treatment: blanks and duplicates', () => {
    expect(getTreatedFieldNames(['a', '', 'a', 'a', ''])).toEqual([
      'a',
      '空字段名',
      'a1',
      'a2',
      '空字段名1',
    ]);
  });
  it('format/normalizeSpace/excel errors', () => {
    // excel-lib 的 normalizeSpace 只替换空白、不合并连续空格
    expect(normalizeSpace('\ufeff a \u3000\u00a0b\t ')).toBe('a   b');
    expect(formatExcelValue('#DIV/0!')).toBe('');
    expect(formatExcelValue('x'.repeat(10001))).toBe('');
  });
  it('cell format → field type', () => {
    const isDate = (f: string) => /y|d/.test(f);
    expect(fieldTypeFromFormat('General', 0, isDate)).toBe(FieldType.INFER);
    expect(fieldTypeFromFormat('@', 49, isDate)).toBe(S);
    expect(fieldTypeFromFormat('yyyy-mm-dd', 14, isDate)).toBe(FieldType.DATE);
    expect(fieldTypeFromFormat('0.00', 2, isDate)).toBe(FieldType.NUMBER);
  });
  it('numberToText follows POI DataFormatter for General', () => {
    expect(numberToText(3)).toBe('3');
    expect(numberToText(2.5)).toBe('2.5');
    expect(numberToText(0.1 + 0.2)).toBe('0.3');
  });
  it('excel serial → date text', () => {
    expect(excelDateToText(45296)).toBe('2024-01-05');
    expect(excelDateToText(45296.5)).toBe('2024-01-05 12:00:00');
  });
});

describe('analyzeCells', () => {
  it('drops blank rows/columns, treats header names and infers types', () => {
    const rows: CellData[][] = [
      [cell('name'), cell(''), cell('qty'), cell('qty')],
      [cell('a'), cell(''), cell('1'), cell('2024-01-01')],
      [cell(''), cell(''), cell(''), cell('')],
      [cell('b'), cell(''), cell('2.5'), cell('2024-01-02')],
    ];
    expect([...getBlankColumnIndex(rows)]).toEqual([1]);
    const out = analyzeCells(rows);
    expect(out.head.map((h) => h.data)).toEqual(['name', 'qty', 'qty1']);
    expect(out.head.map((h) => h.type)).toEqual([S, FieldType.NUMBER, FieldType.DATE]);
    expect(out.rows).toEqual([
      ['a', '1', '2024-01-01'],
      ['b', '2.5', '2024-01-02'],
    ]);
  });
});

describe('csv text', () => {
  it('decodes BOM / GBK and detects delimiters, parses quoted fields', () => {
    expect(decodeCsvBuffer(Buffer.from('\ufeffa,b', 'utf8')).text).toBe('a,b');
    const gbk = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]); // 中文 in GBK
    const decoded = decodeCsvBuffer(gbk);
    expect(decoded.charset).toBe('GBK');
    expect(decoded.text).toBe('中文');
    expect(detectCsvDelimiter('a;b;c\n1;2;3\n')).toBe(';');
    expect(detectCsvDelimiter('a\tb\n1\t2\n')).toBe('\t');
    expect([...parseCsvRecords('a,"b,""c"""\r\n1,"x\ny"\n', ',')]).toEqual([
      ['a', 'b,"c"'],
      ['1', 'x\ny'],
    ]);
  });
});

describe('LocalExcelSource over real files', () => {
  let dir: string;
  let xlsxPath: string;
  let csvPath: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'excel-src-'));
    xlsxPath = path.join(dir, 'sample.xlsx');
    csvPath = path.join(dir, 'orders.csv');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['城市', '销量', '日期', '', '备注'],
      ['北京', 10, new Date(Date.UTC(2024, 0, 5)), null, 'x'],
      [null, null, null, null, null],
      ['上海', 2.5, new Date(Date.UTC(2024, 0, 6)), null, ''],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, '销售');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['k'], ['v']]), 'Sheet2');
    XLSX.writeFile(wb, xlsxPath);
    await writeFile(csvPath, '\ufeffid;name\n1;"a;b"\n2;c\n');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('lists tables with Java ids and builds meta with system columns', async () => {
    const source = new LocalExcelSource({ sourceName: 's', files: [xlsxPath, csvPath] });
    const tables = await source.listTables();
    expect(tables.map((t) => t.id)).toEqual([
      'sample.xlsx_销售',
      'sample.xlsx_Sheet2',
      'orders.csv',
    ]);
    const sales = tables[0];
    const meta = await source.queryMeta(sales, 'm1');
    expect(meta).toMatchObject({ messageId: 'm1', error: false, hasNext: false, skipSync: false });
    expect(meta.tableColumns).toEqual([
      '城市',
      '销量',
      '日期',
      '备注',
      '文件夹名(系统字段)',
      '表名(系统字段)',
      'sheet名(系统字段)',
    ]);
    expect(meta.tableColumnTypes).toEqual([6, 5, 9, 6, 6, 6, 6]);
    expect(await source.rowCount(sales)).toBe(2);
    const top = await source.topRows(sales);
    expect(top.rows[0]).toEqual([
      '北京',
      '10',
      '2024-01-05',
      'x',
      path.basename(dir),
      'sample.xlsx',
      '销售',
    ]);
    expect(top.rows[1].slice(0, 4)).toEqual(['上海', '2.5', '2024-01-06', '']);

    const csv = tables[2];
    expect(await source.rowCount(csv)).toBe(2);
    const csvTop = await source.topRows(csv);
    expect(csvTop.rows[0]).toEqual(['1', 'a;b', path.basename(dir), 'orders.csv', 'orders']);
  });

  it('returns skipSync meta for unchanged files after a full sync', async () => {
    const source = new LocalExcelSource({ sourceName: 's', files: [csvPath] });
    const [table] = await source.listTables();
    expect((await source.queryStructure(table, { update: true }, 'a')).skipSync).toBe(false);
    const written: (string | null)[][] = [];
    const n = await source.writeFullData(table, 5, async (row) => {
      written.push(row);
    });
    expect(n).toBe(2);
    expect(written[1]).toEqual(['2', 'c', path.basename(dir), 'orders.csv', 'orders']);
    expect(await source.queryStructure(table, { update: true }, 'b')).toEqual({
      messageId: 'b',
      error: false,
      hasNext: false,
      skipSync: true,
    });
    expect(
      (await source.queryStructure(table, { update: true, forceOverwrite: true }, 'c')).skipSync
    ).toBe(false);
    const later = new Date(Date.now() + 5000);
    await utimes(csvPath, later, later);
    expect((await source.queryStructure(table, { update: true }, 'd')).skipSync).toBe(false);
  });
});
