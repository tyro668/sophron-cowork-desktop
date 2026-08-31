import { describe, expect, it } from 'vitest';
import { removeRowAt } from '../../src/renderer/components/workflow-forms/shared/rowListOperations';

describe('row operator remove policy', () => {
  it('removes only the selected row when every row is blank', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

    expect(removeRowAt(rows, 1)).toEqual([{ id: 'a' }, { id: 'c' }]);
    expect(rows).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  });

  it('returns an empty list only when the selected row was the final row', () => {
    expect(removeRowAt([{ id: 'only' }], 0)).toEqual([]);
  });
});
