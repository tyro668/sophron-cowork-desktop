import { describe, expect, it } from 'vitest';
import { detectDriveFileHeader } from '../../main/data/drive-preview-header';
import { driveFilePreviewToDataPreview } from '../../main/data/cloud-analysis-command-service';

const title = '华东大区 2026年9月 门店销售月报';
const note = '制表：华东区运营部    单位：元';
const eastRows: unknown[][] = [
  Array(7).fill(title),
  Array(7).fill(note),
  Array(7).fill(''),
  ['门店', '品类', '本月实际', '本月实际', '上月实际', '上月实际', '备注'],
  ['', '', '销售额', '销量', '销售额', '销量', ''],
  ['上海一店', '饮料', 35791.93, 5591, 32360.16, 5640, '国庆备货'],
  ['上海一店', '零食', '44,667.43', 3621, '47,851.92', 3164, ''],
];

describe('detectDriveFileHeader', () => {
  it('skips merged title rows and merges a two-row header', () => {
    const { columns, dataStart } = detectDriveFileHeader(eastRows, 7);
    expect(columns).toEqual([
      '门店',
      '品类',
      '本月实际_销售额',
      '本月实际_销量',
      '上月实际_销售额',
      '上月实际_销量',
      '备注',
    ]);
    expect(dataStart).toBe(5);
  });

  it('handles a single title cell, an empty header column and no sub-header', () => {
    const rows = [
      ['华南区九月销售（按品类展开）', '', '', ''],
      ['门店名称', '', '饮料-销售额', '饮料-销量'],
      ['广州 三店', '', 16238.26, 2623],
    ];
    const { columns, dataStart } = detectDriveFileHeader(rows, 4);
    expect(columns).toEqual(['门店名称', 'col_2', '饮料-销售额', '饮料-销量']);
    expect(dataStart).toBe(2);
  });

  it('keeps a plain csv header and de-duplicates repeated names', () => {
    const rows = [
      ['a', 'b', 'a'],
      [1, 2, 3],
    ];
    expect(detectDriveFileHeader(rows, 3)).toEqual({ columns: ['a', 'b', 'a_2'], dataStart: 1 });
  });

  it('does not treat a numeric second row as a sub-header', () => {
    const rows = [
      ['x', 'x', 'y'],
      [1, 2, 3],
      [4, 5, 6],
    ];
    expect(detectDriveFileHeader(rows, 3)).toEqual({ columns: ['x', 'x_2', 'y'], dataStart: 1 });
  });

  it('handles single-column and empty sheets', () => {
    expect(detectDriveFileHeader([['only'], ['v']], 1)).toEqual({
      columns: ['only'],
      dataStart: 1,
    });
    expect(detectDriveFileHeader([], 0)).toEqual({ columns: [], dataStart: 1 });
  });
});

describe('driveFilePreviewToDataPreview', () => {
  it('produces distinct values per column for merged-header excel', () => {
    const preview = driveFilePreviewToDataPreview({
      file: { sheets: [{ name: '9月汇总', rowCount: 7, columnCount: 7 }] },
      sheetName: '9月汇总',
      rows: eastRows,
    });
    expect(preview.totalRows).toBe(2);
    expect(preview.rows[0]).toEqual({
      门店: '上海一店',
      品类: '饮料',
      本月实际_销售额: 35791.93,
      本月实际_销量: 5591,
      上月实际_销售额: 32360.16,
      上月实际_销量: 5640,
      备注: '国庆备货',
    });
  });
});
