import { describe, expect, it } from 'vitest';
import { formatNumericColumnTotals } from '../src/main/data/data-tool-preview-format';
import type { DataColumnTypeInfo } from '../src/shared/data-field-types';

const columnTypes = [
  { name: '大区', type: 'text', storageType: 'VARCHAR' },
  { name: '销售额', type: 'decimal', storageType: 'DECIMAL(18,2)' },
  { name: '订单数', type: 'integer', storageType: 'BIGINT' },
] as DataColumnTypeInfo[];

describe('formatNumericColumnTotals', () => {
  it('sums numeric columns exactly when every row was returned', () => {
    const text = formatNumericColumnTotals({
      columnTypes,
      rows: [
        { 大区: '华东', 销售额: 1702345.67, 订单数: 70 },
        { 大区: '华南', 销售额: '1500000.1', 订单数: 60 },
        { 大区: '华北', 销售额: 1900354.23, 订单数: null },
        { 大区: '西南', 销售额: 0.1, 订单数: 50 },
      ],
      totalRows: 4,
      offset: 0,
      limit: 20,
    });
    expect(text).toContain('"销售额":"5102700.10"');
    expect(text).toContain('"订单数":"180"');
    expect(text).not.toContain('大区"');
  });

  it('skips partial previews, single rows and non-literal numbers', () => {
    const rows = [
      { 大区: '华东', 销售额: 1, 订单数: 1 },
      { 大区: '华南', 销售额: 2, 订单数: 1e21 },
    ];
    expect(
      formatNumericColumnTotals({ columnTypes, rows, totalRows: 5, offset: 0, limit: 2 })
    ).toBe('');
    expect(
      formatNumericColumnTotals({
        columnTypes,
        rows: rows.slice(0, 1),
        totalRows: 1,
        offset: 0,
        limit: 20,
      })
    ).toBe('');
    const text = formatNumericColumnTotals({
      columnTypes,
      rows,
      totalRows: 2,
      offset: 0,
      limit: 20,
    });
    expect(text).toContain('"销售额":"3"');
    expect(text).not.toContain('订单数');
  });

  it('handles negative values', () => {
    const text = formatNumericColumnTotals({
      columnTypes,
      rows: [
        { 大区: 'a', 销售额: -0.25, 订单数: 1 },
        { 大区: 'b', 销售额: 0.05, 订单数: -3 },
      ],
      totalRows: 2,
      offset: 0,
      limit: 20,
    });
    expect(text).toContain('"销售额":"-0.20"');
    expect(text).toContain('"订单数":"-2"');
  });
});
