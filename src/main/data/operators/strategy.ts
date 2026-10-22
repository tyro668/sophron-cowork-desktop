import type { DataWorkflowOperatorType } from '../../../shared/operators';
import { compileFieldSelectSql } from './field-select';
import { compileFieldMappingSql } from './field-mapping';
import { compileMissingValueSql } from './missing-value';
import { compileTypeConvertSql } from './type-convert';
import { compileDeduplicateSql } from './deduplicate';
import { compileSortSql } from './sort';
import { compileCalculateFieldSql } from './calculate-field';
import { compileAggregateSql } from './aggregate';
import { compileLimitSql } from './limit';
import { compilePivotSql } from './pivot';
import { compileUnpivotSql } from './unpivot';
import { compileUnnestSql } from './unnest';
import { compileFilterConditionExpression, expressionHasWindow } from './filter';

export interface CompileStrategy {
  compile: (
    output: string,
    input: string,
    columns: string[],
    config: Record<string, unknown>,
    columnTypes?: Record<string, string>
  ) => string;
  needsColumns: boolean;
}

export function buildFilterSql(
  output: string,
  input: string,
  _columns: string[],
  config: Record<string, unknown>
): string {
  const condition = String(config.condition ?? '').trim();
  if (!condition) {
    throw new Error('Filter requires a condition');
  }
  // Window values (`[x] > avg([x]) over (by: [g])`) are evaluated after WHERE; QUALIFY filters
  // on them in the same pass.
  const clause = expressionHasWindow(condition) ? 'QUALIFY' : 'WHERE';
  return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${input} ${clause} ${compileFilterConditionExpression(condition)}`;
}

function wrapNoColumns(
  fn: (output: string, input: string, config: Record<string, unknown>) => string
): CompileStrategy['compile'] {
  return (output, input, _columns, config) => fn(output, input, config);
}

/**
 * SQL compile strategies for `compileKind: 'strategy'` operators — key set is
 * enforced against the operator registry by operator-registry.test.ts, and the
 * union key type rejects unknown keys at compile time.
 */
export const COMPILE_STRATEGIES: Partial<Record<DataWorkflowOperatorType, CompileStrategy>> = {
  select: { compile: compileFieldSelectSql, needsColumns: true },
  rename: { compile: compileFieldMappingSql, needsColumns: true },
  missing_value: { compile: compileMissingValueSql, needsColumns: true },
  cast: { compile: compileTypeConvertSql, needsColumns: true },
  deduplicate: { compile: compileDeduplicateSql, needsColumns: true },
  filter: { compile: buildFilterSql, needsColumns: false },
  sort: { compile: wrapNoColumns(compileSortSql), needsColumns: false },
  derive: {
    compile: (output, input, columns, config) =>
      compileCalculateFieldSql(output, input, config, columns),
    needsColumns: true,
  },
  aggregate: { compile: wrapNoColumns(compileAggregateSql), needsColumns: false },
  limit: { compile: compileLimitSql, needsColumns: true },
  pivot: { compile: wrapNoColumns(compilePivotSql), needsColumns: false },
  unpivot: { compile: compileUnpivotSql, needsColumns: true },
  unnest: { compile: compileUnnestSql, needsColumns: true },
};
