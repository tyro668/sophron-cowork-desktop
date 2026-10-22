import { describe, expect, it } from 'vitest';
import {
  hasNonEmptyString,
  isCompleteAggregateMetric,
  isCompleteCalculation,
  isCompleteFieldMapping,
  isCompleteJoinCondition,
  isCompleteMissingValueRule,
  isCompletePivotAxis,
  isCompletePivotMetric,
  isCompleteSortKey,
  isCompleteTypeConversion,
} from '../../src/shared/operator-completeness';

describe('hasNonEmptyString', () => {
  it('returns true for non-whitespace strings', () => {
    expect(hasNonEmptyString('a')).toBe(true);
    expect(hasNonEmptyString('  a  ')).toBe(true);
  });

  it('returns false for empty, whitespace, and non-strings', () => {
    expect(hasNonEmptyString('')).toBe(false);
    expect(hasNonEmptyString('   ')).toBe(false);
    expect(hasNonEmptyString(undefined)).toBe(false);
    expect(hasNonEmptyString(null)).toBe(false);
    expect(hasNonEmptyString(0)).toBe(false);
  });
});

describe('isCompleteSortKey', () => {
  it('accepts a key with a field', () => {
    expect(isCompleteSortKey({ field: 'a' })).toBe(true);
    expect(isCompleteSortKey({ field: 'a', direction: 'desc' })).toBe(true);
  });

  it('rejects missing or empty field', () => {
    expect(isCompleteSortKey({})).toBe(false);
    expect(isCompleteSortKey({ field: '' })).toBe(false);
    expect(isCompleteSortKey({ field: '  ' })).toBe(false);
    expect(isCompleteSortKey(null)).toBe(false);
    expect(isCompleteSortKey([])).toBe(false);
  });
});

describe('isCompleteJoinCondition', () => {
  it('accepts a condition with left and right', () => {
    expect(isCompleteJoinCondition({ left: '[a]', operator: '=', right: '[b]' })).toBe(true);
  });

  it('rejects missing left or right', () => {
    expect(isCompleteJoinCondition({ left: '[a]', operator: '=', right: '' })).toBe(false);
    expect(isCompleteJoinCondition({ left: '', operator: '=', right: '[b]' })).toBe(false);
    expect(isCompleteJoinCondition({ operator: '=' })).toBe(false);
  });
});

describe('isCompleteTypeConversion', () => {
  it('accepts a conversion with a column', () => {
    expect(isCompleteTypeConversion({ field: 'a', type: 'integer' })).toBe(true);
  });

  it('rejects missing or empty column', () => {
    expect(isCompleteTypeConversion({})).toBe(false);
    expect(isCompleteTypeConversion({ field: '' })).toBe(false);
    expect(isCompleteTypeConversion({ field: '  ' })).toBe(false);
  });
});

describe('isCompleteFieldMapping', () => {
  it('accepts rename/prefix/suffix mode via targetValue', () => {
    expect(isCompleteFieldMapping({ source: 'a', targetMode: 'rename', targetValue: 'b' })).toBe(
      true
    );
    expect(isCompleteFieldMapping({ source: 'a', targetMode: 'prefix', targetValue: 'p_' })).toBe(
      true
    );
    expect(isCompleteFieldMapping({ source: 'a', targetMode: 'suffix', targetValue: '_s' })).toBe(
      true
    );
  });

  it('rejects missing source or effective target', () => {
    expect(isCompleteFieldMapping({})).toBe(false);
    expect(isCompleteFieldMapping({ source: 'a', target: 'b' })).toBe(false);
    expect(isCompleteFieldMapping({ source: 'a', targetMode: 'rename', targetValue: '' })).toBe(
      false
    );
    expect(isCompleteFieldMapping({ source: '', targetMode: 'rename', targetValue: 'b' })).toBe(
      false
    );
  });
});

describe('isCompleteAggregateMetric', () => {
  it('accepts a metric with function, expression and alias', () => {
    expect(isCompleteAggregateMetric({ function: 'sum', expression: '[a]', alias: 't' })).toBe(
      true
    );
  });

  it('rejects missing function, expression or alias', () => {
    expect(isCompleteAggregateMetric({ function: 'sum', expression: '[a]', alias: '' })).toBe(
      false
    );
    expect(isCompleteAggregateMetric({ function: 'sum', expression: '', alias: 't' })).toBe(false);
    expect(isCompleteAggregateMetric({ function: '', expression: '[a]', alias: 't' })).toBe(false);
  });
});

describe('isCompletePivotAxis / isCompletePivotMetric', () => {
  it('accepts a pivot axis with a field', () => {
    expect(isCompletePivotAxis({ field: 'a', values: [] })).toBe(true);
    expect(isCompletePivotAxis({ field: 'a' })).toBe(true);
  });

  it('rejects a pivot axis without a field', () => {
    expect(isCompletePivotAxis({ field: '' })).toBe(false);
    expect(isCompletePivotAxis({})).toBe(false);
  });

  it('accepts a pivot metric with function and expression', () => {
    expect(isCompletePivotMetric({ function: 'sum', expression: '[a]' })).toBe(true);
  });

  it('rejects a pivot metric missing function or expression', () => {
    expect(isCompletePivotMetric({ function: 'sum', expression: '' })).toBe(false);
    expect(isCompletePivotMetric({ function: '', expression: '[a]' })).toBe(false);
  });
});

describe('isCompleteMissingValueRule', () => {
  it('accepts a literal_fill rule with a value', () => {
    expect(isCompleteMissingValueRule({ field: 'a', method: 'literal_fill', value: 'x' })).toBe(
      true
    );
  });

  it('rejects a literal_fill rule without a value', () => {
    expect(isCompleteMissingValueRule({ field: 'a', method: 'literal_fill', value: '' })).toBe(
      false
    );
  });

  it('accepts a nullify_values rule with values', () => {
    expect(
      isCompleteMissingValueRule({ field: 'a', method: 'nullify_values', values: ['x'] })
    ).toBe(true);
  });

  it('rejects a nullify_values rule without values', () => {
    expect(isCompleteMissingValueRule({ field: 'a', method: 'nullify_values', values: [] })).toBe(
      false
    );
  });

  it('rejects a rule without a column', () => {
    expect(isCompleteMissingValueRule({ method: 'literal_fill', value: 'x' })).toBe(false);
  });
});

describe('isCompleteCalculation', () => {
  it('accepts a calculation with field and expression', () => {
    expect(isCompleteCalculation({ field: 'm', expression: '[a] - [b]' })).toBe(true);
  });

  it('rejects a calculation missing field or expression', () => {
    expect(isCompleteCalculation({ field: '', expression: '[a]' })).toBe(false);
    expect(isCompleteCalculation({ field: 'm', expression: '' })).toBe(false);
  });
});
