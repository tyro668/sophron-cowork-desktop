import { describe, expect, it } from 'vitest';
import {
  createStableListItemId,
  needsListItemIdNormalization,
  normalizeListItemsWithIds,
} from '../../src/renderer/components/workflow-forms/shared/list-item-ids';

describe('list item ids', () => {
  it('preserves existing ids', () => {
    const rows = normalizeListItemsWithIds(
      [
        { id: 'row_a', source: 'a', target: 'b' },
        { id: 'row_b', source: 'c', target: 'd' },
      ],
      'row'
    );
    expect(rows.map((row) => row.id)).toEqual(['row_a', 'row_b']);
    expect(needsListItemIdNormalization(rows)).toBe(false);
  });

  it('fills missing ids and deduplicates repeats', () => {
    const rows = normalizeListItemsWithIds(
      [
        { source: 'a', target: 'b' },
        { id: 'dup', source: 'c', target: 'd' },
        { id: 'dup', source: 'e', target: 'f' },
      ],
      'row'
    );
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.id)).size).toBe(3);
    expect(
      needsListItemIdNormalization([
        { source: 'a', target: 'b' },
        { id: 'dup', source: 'c', target: 'd' },
        { id: 'dup', source: 'e', target: 'f' },
      ])
    ).toBe(true);
  });

  it('creates stable prefixed ids', () => {
    expect(createStableListItemId('map')).toMatch(/^map_/);
  });
});
