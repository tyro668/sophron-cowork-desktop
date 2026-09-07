import { describe, expect, it } from 'vitest';
import { getReorderTargetIndex, reorderItem } from '../../src/renderer/hooks/useDragReorder';

describe('reorderItem', () => {
  it('moves a row up without mutating the source list', () => {
    const source = ['a', 'b', 'c'];

    const reordered = reorderItem(source, 1, 'up');

    expect(reordered).toEqual(['b', 'a', 'c']);
    expect(source).toEqual(['a', 'b', 'c']);
  });

  it('moves a row down', () => {
    expect(reorderItem(['a', 'b', 'c'], 1, 'down')).toEqual(['a', 'c', 'b']);
  });

  it('supports consecutive moves by advancing focus to the moved row index', () => {
    const firstTarget = getReorderTargetIndex(3, 0, 'down');
    const afterFirstMove = reorderItem(['a', 'b', 'c'], 0, 'down');
    const secondTarget = getReorderTargetIndex(3, firstTarget!, 'down');
    const afterSecondMove = reorderItem(afterFirstMove!, firstTarget!, 'down');

    expect(firstTarget).toBe(1);
    expect(afterFirstMove).toEqual(['b', 'a', 'c']);
    expect(secondTarget).toBe(2);
    expect(afterSecondMove).toEqual(['b', 'c', 'a']);
  });

  it.each([
    { index: 0, direction: 'up' as const },
    { index: 2, direction: 'down' as const },
    { index: -1, direction: 'up' as const },
  ])('does not reorder beyond a list boundary: $index $direction', ({ index, direction }) => {
    expect(reorderItem(['a', 'b', 'c'], index, direction)).toBeNull();
  });
});
