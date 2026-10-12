import { describe, expect, it } from 'vitest';
import {
  defaultCsvConfig,
  normalizeColumnTypeOverrides,
  normalizeRawTableConfig,
} from '../src/main/data/store/input-source';

describe('normalizeColumnTypeOverrides', () => {
  it('keeps valid entries, trims names, lowercases types, and dedupes by name', () => {
    expect(
      normalizeColumnTypeOverrides([
        { name: ' 订单日期 ', type: 'DATE' },
        { name: '金额', type: 'decimal' },
        { name: '订单日期', type: 'text' }, // duplicate — first wins
        { name: '', type: 'integer' },
        { name: 'bad', type: 'json' },
        'garbage',
      ])
    ).toEqual([
      { name: '订单日期', type: 'date' },
      { name: '金额', type: 'decimal' },
    ]);
  });

  it('returns undefined for empty or non-array input', () => {
    expect(normalizeColumnTypeOverrides(undefined)).toBeUndefined();
    expect(normalizeColumnTypeOverrides([])).toBeUndefined();
    expect(normalizeColumnTypeOverrides('nope')).toBeUndefined();
  });
});

describe('config normalization carries columnTypeOverrides', () => {
  const overrides = [{ name: '金额', type: 'decimal' as const }];

  it('csv config', () => {
    expect(
      defaultCsvConfig({
        sourceKind: 'csv',
        header: 'auto',
        dataRegion: 'auto',
        encoding: 'auto',
        delimiter: 'auto',
        columnTypeOverrides: overrides,
      }).columnTypeOverrides
    ).toEqual(overrides);
  });

  it('folder config', () => {
    const normalized = normalizeRawTableConfig(
      {
        sourceKind: 'folder',
        mergeMode: 'append_same_schema',
        schemaStrategy: 'align_by_name',
        fileRange: 'excel_csv',
        skipEmptyFiles: true,
        keepSourceFileName: true,
        columnTypeOverrides: overrides,
      },
      'folder',
      '/tmp/in'
    );
    expect(normalized.sourceKind === 'folder' && normalized.columnTypeOverrides).toEqual(overrides);
  });

  it('drops invalid entries', () => {
    expect(
      defaultCsvConfig({
        sourceKind: 'csv',
        header: 'auto',
        dataRegion: 'auto',
        encoding: 'auto',
        delimiter: 'auto',
        columnTypeOverrides: [{ name: '', type: 'date' }],
      }).columnTypeOverrides
    ).toBeUndefined();
  });
});
