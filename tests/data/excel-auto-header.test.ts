import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import * as XLSX from '../../src/main/utils/xlsx';
import { detectDriveFileHeader } from '../../src/main/data/drive-preview-header';
import { parseWorkbookRows, sheetToExpandedMatrix } from '../../src/main/data/store/input-source';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A regional report: title + note rows, a blank row, a two-row merged header, merged store cells. */
function writeRegionalReport(): string {
  const dir = mkdtempSync(join(tmpdir(), 'excel-auto-'));
  dirs.push(dir);
  const rows = [
    ['华东大区 2026年9月 门店销售月报', null, null, null, null, null],
    ['制表：华东区运营部', null, null, null, null, null],
    [null, null, null, null, null, null],
    ['门店', '品类', '本月实际', null, '上月实际', null],
    [null, null, '销售额', '销量', '销售额', '销量'],
    ['上海一店', '饮料', 100, 5, 90, 4],
    [null, '零食', 200, 6, 180, 5],
    ['杭州一店', '饮料', 300, 7, 270, 6],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!merges'] = [
    XLSX.utils.decode_range('A1:F1'),
    XLSX.utils.decode_range('A2:F2'),
    XLSX.utils.decode_range('A4:A5'),
    XLSX.utils.decode_range('B4:B5'),
    XLSX.utils.decode_range('C4:D4'),
    XLSX.utils.decode_range('E4:F4'),
    XLSX.utils.decode_range('A6:A7'),
  ];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, '9月汇总');
  const file = join(dir, 'report.xlsx');
  XLSX.writeFile(book, file);
  return file;
}

describe('Excel 智能识别 header', () => {
  it('fills merged cells on the right rows even after a blank row', () => {
    const book = XLSX.read(readFileSync(writeRegionalReport()), { type: 'buffer' });
    const matrix = sheetToExpandedMatrix(book.Sheets['9月汇总']);
    // The blank row is dropped; the merged store name reaches the 零食 row.
    expect(matrix).toHaveLength(7);
    expect(matrix[5]?.slice(0, 2)).toEqual(['上海一店', '零食']);
  });

  it('skips title rows and merges the two-row header in auto mode', () => {
    const parsed = parseWorkbookRows(writeRegionalReport(), {
      sourceKind: 'excel',
      sheetName: '9月汇总',
      headerMode: 'auto',
      headerRow: 1,
    } as never);
    expect(parsed.columns).toEqual([
      '门店',
      '品类',
      '本月实际_销售额',
      '本月实际_销量',
      '上月实际_销售额',
      '上月实际_销量',
    ]);
    expect(parsed.rows.map((row) => row.slice(0, 3))).toEqual([
      ['上海一店', '饮料', '100'],
      ['上海一店', '零食', '200'],
      ['杭州一店', '饮料', '300'],
    ]);
  });

  it('keeps a plain first-row header unchanged', () => {
    expect(
      detectDriveFileHeader(
        [
          ['门店编码', '门店名称', '区域'],
          ['S01', '北京一店', '华北'],
        ],
        3
      )
    ).toEqual({ columns: ['门店编码', '门店名称', '区域'], dataStart: 1 });
  });
});
