import { describe, expect, it } from 'vitest';
import { checkSetOpColumns } from '../../src/renderer/components/workflow-forms/FormSetOp';

describe('checkSetOpColumns', () => {
  it('stays quiet when right columns are unknown', () => {
    expect(checkSetOpColumns(['a'], null, 'by_name')).toEqual({ kind: 'ok' });
  });
  it('lists missing columns on each side when matching by name', () => {
    expect(checkSetOpColumns(['a', 'b', 'c'], ['a', 'd'], 'by_name')).toEqual({
      kind: 'missing',
      missingInRight: ['b', 'c'],
      missingInLeft: ['d'],
    });
  });
  it('errors on column-count mismatch when matching by position', () => {
    expect(checkSetOpColumns(['a', 'b'], ['x'], 'by_position')).toEqual({
      kind: 'positionMismatch',
      left: 2,
      right: 1,
    });
    expect(checkSetOpColumns(['a'], ['x'], 'by_position')).toEqual({ kind: 'ok' });
  });
});
