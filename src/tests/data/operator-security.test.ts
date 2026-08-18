import { describe, expect, it } from 'vitest';
import { compileScalarExpression } from '../../main/data/operators/compute';
import { compileFilterConditionExpression } from '../../main/data/operators/filter';
import {
  normalizeCalculationDomainExpression,
  expandCalculationDomainExpression,
} from '../../shared/calculate-field/domain-dsl';
import {
  AggregateConfigSchema,
  CalculateFieldConfigSchema,
  PivotConfigSchema,
} from '../../shared/operator-schemas';

describe('data operator security boundaries', () => {
  it('does not rewrite DSL keywords inside string literals', () => {
    expect(compileScalarExpression('"if then else end"')).toBe("'if then else end'");
  });

  it('rejects statement and external-read keywords in scalar expressions', () => {
    expect(() => compileScalarExpression('select([value])')).toThrow(/Unsupported SQL keyword/);
    expect(() => compileScalarExpression('read_csv("secret.csv")')).toThrow(
      /Unsupported SQL keyword/
    );
    expect(() => compileScalarExpression('parquet_scan("secret.parquet")')).toThrow(
      /Unsupported SQL keyword/
    );
  });

  it('limits expression nesting', () => {
    expect(() => compileScalarExpression(`${'('.repeat(65)}1${')'.repeat(65)}`)).toThrow(
      /nesting depth/
    );
  });

  it('accepts a modern expression-only calculation config', () => {
    const result = CalculateFieldConfigSchema.safeParse({
      calculations: [{ field: 'running_total', expression: 'sum([amount]) over ()' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects legacy structured calculation fields as unsupported', () => {
    const legacyConfigs = [
      { calculations: [{ field: 'x', expression: '', type: 'window', fn: 'ytd_sum' }] },
      { calculations: [{ field: 'x', expression: '', fn: 'lag', fnArg: 'amount' }] },
      { calculations: [{ field: 'x', expression: '', scenario: 'group_metrics' }] },
      { calculations: [{ field: 'x', expression: '', frameStart: 'unbounded preceding' }] },
      { calculations: [{ field: 'x', expression: '', orderBy: [{ field: 'date' }] }] },
      { calculations: [{ field: 'x', expression: '', partitionBy: ['region'] }] },
    ];
    for (const config of legacyConfigs) {
      const result = CalculateFieldConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    }
  });

  it('rejects legacy top-level mode state', () => {
    const result = CalculateFieldConfigSchema.safeParse({
      calculations: [{ field: 'x', expression: 'sum([amount]) over ()' }],
      _activeMode: 'row',
    });
    expect(result.success).toBe(false);
  });

  it('defaults missing calculations to an empty list', () => {
    const result = CalculateFieldConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.data?.calculations).toEqual([]);
  });

  it('rejects DSL argument injection in domain functions', () => {
    expect(() =>
      normalizeCalculationDomainExpression('ntile(1.5) over(order by [amount])')
    ).toThrow(/must be an integer/);
    expect(() =>
      normalizeCalculationDomainExpression('nth_value([amount], 0) over(order by [date])')
    ).toThrow(/outside its range/);
    expect(() =>
      normalizeCalculationDomainExpression('lag([amount], 0) over(order by [date])')
    ).toThrow(/outside its range/);
  });

  it('accepts valid domain function arguments', () => {
    expect(normalizeCalculationDomainExpression('ntile(2) over(order by [amount])')).toBe(
      'ntile(2) over(order by [amount])'
    );
    expect(normalizeCalculationDomainExpression('lag([amount], 1) over(order by [date])')).toBe(
      'lag([amount], 1) over(order by [date])'
    );
    expect(
      expandCalculationDomainExpression(
        'group_quantile_cont([amount], 0.5) over(partition by [region])'
      )
    ).toContain('quantile_cont([amount], 0.5)');
  });

  it('rejects out-of-range quantile parameters when expanding to SQL', () => {
    expect(() =>
      expandCalculationDomainExpression(
        'group_quantile_cont([amount], 1.1) over(partition by [region])'
      )
    ).toThrow(/outside its range/);
  });

  it('rejects unknown aggregate and pivot functions', () => {
    expect(
      AggregateConfigSchema.safeParse({
        metrics: [{ function: 'execute', expression: '[x]', alias: 'x' }],
      }).success
    ).toBe(false);
    expect(
      PivotConfigSchema.safeParse({
        using: [{ function: 'execute', expression: '[x]' }],
      }).success
    ).toBe(false);
  });

  it('limits filter nesting before recursive compilation', () => {
    const condition = `${'('.repeat(65)}[x] = 1${')'.repeat(65)}`;
    expect(() => compileFilterConditionExpression(condition)).toThrow(/nesting depth/);
  });
});
