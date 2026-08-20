import { describe, expect, it } from 'vitest';
import {
  computeFieldMappingTarget,
  mergeSelectedFields,
  methodsForMissingValueType,
  normalizePivotAxes,
  normalizeFieldMappingEntry,
  parseNonNegativeInteger,
  parseTypeConversionScale,
  prepareTypeConversion,
  retainSelectedDateGranularity,
  setDateGranularity,
} from '../../src/shared/operator-config';

describe('simple operator configuration logic', () => {
  it('preserves selected-field order and appends newly selected fields', () => {
    expect(mergeSelectedFields(['b', 'a'], ['a', 'c', 'b'])).toEqual(['b', 'a', 'c']);
  });

  it('normalizes field mappings and computes their target fields', () => {
    const prefix = normalizeFieldMappingEntry({
      source: 'name',
      targetMode: 'prefix',
      targetValue: 'customer_',
    });
    expect(computeFieldMappingTarget(prefix)).toBe('customer_name');
    expect(() => normalizeFieldMappingEntry({ source: 'name' })).toThrow(
      'Unsupported field mapping target mode'
    );
  });

  it('clears type-specific conversion options when the target type changes', () => {
    expect(prepareTypeConversion('text')).toEqual({
      type: 'text',
      format: undefined,
      scale: undefined,
    });
    expect(prepareTypeConversion('decimal')).toEqual({ type: 'decimal' });
    expect(parseTypeConversionScale('6')).toBe(6);
    expect(parseTypeConversionScale('6.5')).toBeUndefined();
    expect(parseTypeConversionScale('19')).toBeUndefined();
    expect(parseTypeConversionScale('')).toBeUndefined();
  });

  it('normalizes limit inputs to non-negative integers', () => {
    expect(parseNonNegativeInteger('12.9')).toBe(12);
    expect(parseNonNegativeInteger('-2')).toBe(0);
    expect(parseNonNegativeInteger('')).toBeUndefined();
    expect(parseNonNegativeInteger('not-a-number')).toBeUndefined();
  });

  it('selects missing-value methods according to field type', () => {
    const commonMethods = [
      'skip',
      'nullify_values',
      'literal_fill',
      'drop',
      'forward_fill',
      'backward_fill',
    ];
    const nonNumericMethods = [...commonMethods, 'mode_fill'];
    expect(methodsForMissingValueType('integer')).toEqual([
      ...commonMethods,
      'mean_fill',
      'median_fill',
      'mode_fill',
    ]);
    expect(methodsForMissingValueType('date')).toEqual(nonNumericMethods);
    expect(methodsForMissingValueType('datetime')).toEqual(nonNumericMethods);
    expect(methodsForMissingValueType('text')).toEqual(nonNumericMethods);
    expect(methodsForMissingValueType('boolean')).toEqual(nonNumericMethods);
    expect(methodsForMissingValueType(undefined)).toEqual([
      ...commonMethods,
      'mean_fill',
      'median_fill',
      'mode_fill',
    ]);
  });

  it('keeps aggregate date granularity aligned with selected group fields', () => {
    expect(
      retainSelectedDateGranularity({ createdAt: 'month', closedAt: 'day' }, ['createdAt'])
    ).toEqual({ createdAt: 'month' });
    expect(retainSelectedDateGranularity({ createdAt: 'month' }, [])).toBeUndefined();
    expect(setDateGranularity(undefined, 'createdAt', 'month')).toEqual({ createdAt: 'month' });
    expect(setDateGranularity({ createdAt: 'month' }, 'createdAt', '')).toBeUndefined();
  });

  it('normalizes pivot axes and filters invalid literal values', () => {
    const axes = normalizePivotAxes([
      { field: 'year', values: [2024, {}, null] },
      { field: 1, values: 'invalid' },
    ]);
    expect(axes).toEqual([
      { field: 'year', values: [2024, null] },
      { field: '', values: [] },
    ]);
  });

  it('keeps one editable pivot axis when every stored axis is invalid', () => {
    expect(normalizePivotAxes([null, 'year', 2024])).toEqual([{ field: '', values: [] }]);
  });
});
