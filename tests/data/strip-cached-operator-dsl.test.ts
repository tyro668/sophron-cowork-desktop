import { describe, expect, it } from 'vitest';
import { stripCachedOperatorDsl } from '../../src/main/data/store/migrations';

describe('migration 15: strip cached operator dsl', () => {
  it('drops a stale cache and keeps the structured config', () => {
    expect(
      stripCachedOperatorDsl('derive', {
        calculations: [{ field: 'a', expression: '[b] + 1' }],
        dsl: 'derive [a] = [b] + 2',
      })
    ).toEqual({ calculations: [{ field: 'a', expression: '[b] + 1' }] });
  });

  it('drops the dsl cache even when no structured config exists', () => {
    expect(stripCachedOperatorDsl('input', { dsl: 'input pipeline as src', alias: 'src' })).toEqual(
      {
        alias: 'src',
      }
    );
  });

  it('leaves configs without a cache untouched', () => {
    expect(stripCachedOperatorDsl('filter', { condition: '[a] > 1' })).toBeNull();
  });
});
