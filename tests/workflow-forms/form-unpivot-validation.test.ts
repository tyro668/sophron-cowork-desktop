import { describe, expect, it } from 'vitest';
import { validateUnpivotNames } from '../../src/renderer/components/workflow-forms/FormUnpivot';

describe('validateUnpivotNames', () => {
  it('accepts distinct names', () => {
    expect(validateUnpivotNames('指标', '值', ['省', '品类'])).toEqual({});
  });
  it('rejects equal name/value columns (defaults included)', () => {
    expect(validateUnpivotNames('x', 'X', []).valueError).toBe('unpivotErrSameName');
    expect(validateUnpivotNames('', 'name', []).valueError).toBe('unpivotErrSameName');
  });
  it('rejects names that clash with kept columns', () => {
    expect(validateUnpivotNames('省', '值', ['省']).nameError).toBe('unpivotErrKeptConflict');
    expect(validateUnpivotNames('指标', '品类', ['品类']).valueError).toBe(
      'unpivotErrKeptConflict'
    );
  });
});
