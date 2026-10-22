import { describe, expect, it } from 'vitest';
import { planJoinProjectionColumns } from '../../src/shared/prep-dsl/join-projection';

const suffix = { strategy: 'suffix', leftSuffix: '_left', rightSuffix: '_right' };

describe('join projection conflicts', () => {
  it('does not rename left keys when the right duplicates are not kept', () => {
    const cols = planJoinProjectionColumns(
      [
        { side: 'left', wildcard: true },
        { source: '[target].[目标销售额]', alias: '[目标销售额]' },
      ],
      ['区域', '门店', '销售额'],
      ['区域', '门店', '目标销售额'],
      suffix,
      'target'
    );
    expect(cols.map((c) => c.outputName)).toEqual(['区域', '门店', '销售额', '目标销售额']);
  });

  it('still suffixes columns emitted by both sides', () => {
    const cols = planJoinProjectionColumns([], ['区域', '销售额'], ['区域', '目标'], suffix);
    expect(cols.map((c) => c.outputName)).toEqual(['区域_left', '销售额', '区域_right', '目标']);
  });

  it('prefixes a kept right column that collides with a kept left column', () => {
    const cols = planJoinProjectionColumns(
      [{ side: 'left', wildcard: true }, { source: '[t].[区域]' }],
      ['区域'],
      ['区域'],
      undefined,
      't'
    );
    expect(cols.map((c) => c.outputName)).toEqual(['区域', 'right_区域']);
  });
});
