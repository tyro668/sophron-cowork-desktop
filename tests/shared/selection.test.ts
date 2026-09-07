import { describe, expect, it } from 'vitest';
import { toggleSelectAll } from '../../src/shared/collections/selection';

const FIELDS = ['[a].[f1]', '[a].[f2]', '[a].[f3]', '[a].[f4]', '[a].[f5]'];

describe('toggleSelectAll', () => {
  it('selects all fields when none are selected', () => {
    expect([...toggleSelectAll(new Set(), FIELDS)]).toEqual(FIELDS);
  });

  it('selects all fields when only some are selected', () => {
    const partial = new Set(FIELDS.slice(0, 2));
    expect([...toggleSelectAll(partial, FIELDS)]).toEqual(FIELDS);
  });

  it('clears the selection when all fields are already selected', () => {
    const all = new Set(FIELDS);
    expect([...toggleSelectAll(all, FIELDS)]).toEqual([]);
  });

  it('selects all available fields when the selection only has the same size', () => {
    const unrelated = new Set(['other-1', 'other-2', 'other-3', 'other-4', 'other-5']);
    expect([...toggleSelectAll(unrelated, FIELDS)]).toEqual(FIELDS);
  });

  it('keeps an empty selection when there are no fields', () => {
    expect([...toggleSelectAll(new Set(), [])]).toEqual([]);
    expect([...toggleSelectAll(new Set(['[a].[f1]']), [])]).toEqual([]);
  });
});
