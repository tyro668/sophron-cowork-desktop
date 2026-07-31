import { describe, expect, it } from 'vitest';
import { compileLimitSql } from '../../src/main/data/operators/limit';

describe('compileLimitSql', () => {
  it('rejects percentages above 100 instead of silently clamping them', () => {
    expect(() =>
      compileLimitSql('output', 'input', ['value'], {
        mode: 'fixed',
        unit: 'percent',
        limit: 101,
      })
    ).toThrow('Percentage cannot exceed 100');
  });

  it('uses reservoir semantics for fixed-row sampling even with legacy method config', () => {
    const sql = compileLimitSql('output', 'input', ['value'], {
      mode: 'random',
      unit: 'rows',
      limit: 10,
      method: 'bernoulli',
      seed: 42,
    });

    expect(sql).toContain('reservoir(10 ROWS)');
    expect(sql).not.toContain('BERNOULLI');
  });

  it('defaults percentage sampling to system and supports bernoulli explicitly', () => {
    const systemSql = compileLimitSql('output', 'input', ['value'], {
      mode: 'random',
      unit: 'percent',
      limit: 10,
    });
    const bernoulliSql = compileLimitSql('output', 'input', ['value'], {
      mode: 'random',
      unit: 'percent',
      limit: 10,
      method: 'bernoulli',
    });

    expect(systemSql).toContain('TABLESAMPLE SYSTEM(10%)');
    expect(bernoulliSql).toContain('TABLESAMPLE BERNOULLI(10%)');
  });
});
