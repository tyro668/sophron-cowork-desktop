import { describe, expect, it } from 'vitest';
import { uniqueAlias } from '../src/main/data/operators/utils';

describe('uniqueAlias', () => {
  it('returns base when no conflict', () => {
    expect(uniqueAlias('__rn', ['id', 'name'])).toBe('__rn');
  });

  it('appends _0 when base conflicts', () => {
    expect(uniqueAlias('__rn', ['id', '__rn'])).toBe('__rn_0');
  });

  it('increments counter when multiple conflicts', () => {
    expect(uniqueAlias('__rn', ['id', '__rn', '__rn_0'])).toBe('__rn_1');
  });

  it('handles case-insensitive conflicts', () => {
    expect(uniqueAlias('__rn', ['id', '__RN'])).toBe('__rn_0');
  });

  it('handles mixed case conflicts with suffix', () => {
    expect(uniqueAlias('__rn', ['id', '__rn', '__RN_0'])).toBe('__rn_1');
  });

  it('works for __rk alias', () => {
    expect(uniqueAlias('__rk', ['id', '__rk'])).toBe('__rk_0');
  });

  it('works for __total alias', () => {
    expect(uniqueAlias('__total', ['id', '__TOTAL'])).toBe('__total_0');
  });

  it('works for __rn_inner alias', () => {
    expect(uniqueAlias('__rn_inner', ['id', '__rn_inner'])).toBe('__rn_inner_0');
  });
});
