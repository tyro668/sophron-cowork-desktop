import { describe, expect, it } from 'vitest';
import { compileFieldPattern, matchFields } from '../../src/shared/field-pattern';

const fields = ['销售额', '销售数量', 'Q1', 'Q2', 'Q10', '门店', '日期'];
const types = {
  销售额: 'decimal',
  销售数量: 'integer',
  Q1: 'integer',
  Q2: 'integer',
  Q10: 'integer',
  门店: 'text',
  日期: 'date',
};

describe('field pattern selection', () => {
  it('supports glob, regex and substring', () => {
    expect(matchFields(fields, types, { type: '', pattern: '销售*' })).toEqual([
      '销售额',
      '销售数量',
    ]);
    expect(matchFields(fields, types, { type: '', pattern: '/^q\\d$/' })).toEqual(['Q1', 'Q2']);
    expect(matchFields(fields, types, { type: '', pattern: '店' })).toEqual(['门店']);
    expect(compileFieldPattern('/[/')).toBeNull();
  });

  it('filters by type group', () => {
    expect(matchFields(fields, types, { type: 'number', pattern: '' })).toEqual([
      '销售额',
      '销售数量',
      'Q1',
      'Q2',
      'Q10',
    ]);
    expect(matchFields(fields, types, { type: 'temporal', pattern: '' })).toEqual(['日期']);
    expect(matchFields(fields, types, { type: 'number', pattern: 'Q?' })).toEqual(['Q1', 'Q2']);
  });
});
