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
import { compileFilterConditionExpression } from './filter';

export interface CompileStrategy {
  compile: (
    output: string,
    input: string,
    columns: string[],
    config: Record<string, unknown>
  ) => string;
  needsColumns: boolean;
}

export function buildFilterSql(
  output: string,
  input: string,
  _columns: string[],
  config: Record<string, unknown>
): string {
  const condition = String(config.condition ?? 'true');
  return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${input} WHERE ${compileFilterConditionExpression(condition)}`;
}

function wrapNoColumns(
  fn: (output: string, input: string, config: Record<string, unknown>) => string
): CompileStrategy['compile'] {
  return (output, input, _columns, config) => fn(output, input, config);
}

export const COMPILE_STRATEGIES: Partial<Record<string, CompileStrategy>> = {
  field_select: { compile: compileFieldSelectSql, needsColumns: true },
  field_mapping: { compile: compileFieldMappingSql, needsColumns: true },
  missing_value: { compile: compileMissingValueSql, needsColumns: true },
  type_convert: { compile: compileTypeConvertSql, needsColumns: true },
  deduplicate: { compile: compileDeduplicateSql, needsColumns: true },
  filter: { compile: buildFilterSql, needsColumns: false },
  sort: { compile: wrapNoColumns(compileSortSql), needsColumns: false },
  calculate_field: {
    compile: (output, input, columns, config) =>
      compileCalculateFieldSql(output, input, config, columns),
    needsColumns: true,
  },
  aggregate: { compile: wrapNoColumns(compileAggregateSql), needsColumns: false },
  limit: { compile: compileLimitSql, needsColumns: true },
  pivot: { compile: wrapNoColumns(compilePivotSql), needsColumns: false },
  unpivot: { compile: compileUnpivotSql, needsColumns: true },
  unnest: { compile: wrapNoColumns(compileUnnestSql), needsColumns: false },
};
