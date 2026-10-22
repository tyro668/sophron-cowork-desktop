import { describe, expect, it } from 'vitest';
import {
  autoMetricAlias,
  plainFieldOf,
} from '../../src/renderer/components/workflow-forms/shared/MetricExpressionCell';
import { OPERATOR_DEFINITIONS } from '../../src/shared/operators/definitions';

describe('dropdown-first metric input', () => {
  it('recognises plain field references', () => {
    expect(plainFieldOf('[销售额]')).toBe('销售额');
    expect(plainFieldOf('[a] * [b]')).toBeNull();
    expect(plainFieldOf('*')).toBeNull();
  });

  it('derives an output name from function + field', () => {
    expect(autoMetricAlias('sum', '[销售额]', '行数')).toBe('销售额_sum');
    expect(autoMetricAlias('count', '*', '行数')).toBe('行数');
    expect(autoMetricAlias('sum', '[a] * [b]', '行数')).toBe('');
  });
});

describe('creation defaults', () => {
  it('starts limit at 10 rows and joins with suffix conflict naming', () => {
    expect(OPERATOR_DEFINITIONS.limit.createDefaultConfig()).toMatchObject({ limit: 10 });
    expect(OPERATOR_DEFINITIONS.join.createDefaultConfig()).toMatchObject({
      conflict: { strategy: 'suffix' },
    });
  });
});
