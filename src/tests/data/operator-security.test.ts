import { describe, expect, it } from 'vitest';
import { compileScalarExpression } from '../../main/data/operators/compute';
import { compileFilterConditionExpression } from '../../main/data/operators/filter';
import { exprFromParts } from '../../shared/calculate-field';
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

  it('accepts valid time-intelligence function combinations', () => {
    const result = CalculateFieldConfigSchema.safeParse({
      calculations: [
        {
          field: 'running_total',
          type: 'window',
          fn: 'ytd_sum',
          fnArg: 'amount',
          orderBy: [{ field: 'date', direction: 'asc' }],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects unsupported time-intelligence aggregations', () => {
    const result = CalculateFieldConfigSchema.safeParse({
      calculations: [{ field: 'x', type: 'window', fn: 'ytd_execute' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects structural content in numeric function arguments', () => {
    expect(() =>
      exprFromParts({
        id: '1',
        field: 'previous',
        expression: '',
        type: 'window',
        fn: 'lag',
        fnArg: 'amount',
        fnArg2: '1) + 1',
      })
    ).toThrow(/Invalid numeric calculation argument/);
  });

  it('applies function-specific numeric argument constraints', () => {
    const base = {
      id: '1',
      field: 'result',
      expression: '',
      type: 'window' as const,
      fnArg: 'amount',
    };
    expect(() => exprFromParts({ ...base, fn: 'ntile', fnArg: '1.5' })).toThrow(
      /outside the allowed range/
    );
    expect(() => exprFromParts({ ...base, fn: 'nth_value', fnArg2: '0' })).toThrow(
      /outside the allowed range/
    );
    expect(() => exprFromParts({ ...base, fn: 'quantile_cont', fnArg2: '1.1' })).toThrow(
      /outside the allowed range/
    );
    expect(exprFromParts({ ...base, fn: 'lag', fnArg2: '0' })).toContain('lag([amount], 0)');
    expect(exprFromParts({ ...base, fn: 'quantile_cont', fnArg2: '0.5' })).toContain(
      'quantile_cont([amount], 0.5)'
    );
  });

  it('quotes text function arguments as DSL string literals', () => {
    const expression = exprFromParts({
      id: '1',
      field: 'joined',
      expression: '',
      type: 'window',
      fn: 'string_agg',
      fnArg: 'name',
      fnArg2: "', injected",
    });
    expect(compileScalarExpression(expression)).toContain("string_agg(\"name\", ''', injected')");
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
