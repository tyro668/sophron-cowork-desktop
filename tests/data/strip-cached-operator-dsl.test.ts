import { describe, expect, it } from 'vitest';
import { stripCachedOperatorDsl } from '../../src/main/data/store/migrations';

describe('migration 15: strip cached operator dsl', () => {
  it('drops a stale cache and keeps the structured config', () => {
    expect(
      stripCachedOperatorDsl('derive', {
        calculations: [{ field: 'a', expression: '[b] + 1' }],
        dsl: 'derive [a] = [b] + 2',
      })
    ).toEqual({ config: { calculations: [{ field: 'a', expression: '[b] + 1' }] } });
  });

  it('converts a dsl-only node into structured config', () => {
    const result = stripCachedOperatorDsl('filter', { dsl: 'filter [amount] > 1' });
    expect(result?.legacyDsl).toBeUndefined();
    expect(result?.config).toMatchObject({ condition: '[amount] > 1' });
  });

  it('keeps unconvertible dsl-only text recoverable instead of dropping it', () => {
    expect(stripCachedOperatorDsl('input', { dsl: 'input pipeline as src', layout: {} })).toEqual({
      config: { layout: {} },
      legacyDsl: 'input pipeline as src',
    });
  });

  it('leaves configs without a cache untouched', () => {
    expect(stripCachedOperatorDsl('filter', { condition: '[a] > 1' })).toBeNull();
  });
});
