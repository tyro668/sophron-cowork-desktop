import { describe, expect, it } from 'vitest';
import { computeUsedFields } from '../../src/shared/collections/used-fields';

describe('computeUsedFields', () => {
  it('collects defined fields once and ignores empty values', () => {
    const items = [{ field: 'id' }, { field: '' }, { field: 'name' }, { field: 'id' }];

    expect([...computeUsedFields(items, ({ field }) => field || undefined)]).toEqual([
      'id',
      'name',
    ]);
  });

  it('does not mutate a readonly input list', () => {
    const items = Object.freeze([{ field: 'id' }, { field: 'name' }]);

    computeUsedFields(items, ({ field }) => field);

    expect(items).toEqual([{ field: 'id' }, { field: 'name' }]);
  });
});
