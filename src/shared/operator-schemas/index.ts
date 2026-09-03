import type { ZodType } from 'zod';
import type { PrepDiagnostic } from '../prep-dsl/ast';

// Re-export schemas for external consumers (must use export-from for CJS compatibility)
export {
  SortKeySchema,
  type SortKey,
  ConditionSchema,
  ConflictSchema,
  MetricEntrySchema,
  createMetricId,
  PIVOT_AGGREGATE_FUNCTIONS,
  type AggregateFunction,
  type KeepItem,
  type MetricEntry,
  KeepItemSchema,
  nonEmptyTrimmed,
} from './common';
export { SortConfigSchema } from './sort';
export { FieldSelectConfigSchema } from './field-select';
export { FieldMappingConfigSchema, FieldMappingEntrySchema } from './field-mapping';
export type { FieldMappingEntry } from './field-mapping';
export { DeduplicateConfigSchema } from './deduplicate';
export {
  TypeConvertConfigSchema,
  TypeConversionEntrySchema,
  DATE_FORMAT_VALUES,
  DATE_FORMAT_PRESETS,
  SCALE_MIN,
  SCALE_MAX,
} from './type-convert';
export type { DateFormat, TypeConversionEntry } from './type-convert';
export { UnpivotConfigSchema } from './unpivot';
export { UnnestConfigSchema } from './unnest';
export { SetOpConfigSchema } from './set-op';
export { DEFAULT_OPERATION, DEFAULT_MODE, DEFAULT_MATCH } from './set-op';
export { AggregateConfigSchema, MAX_METRIC_COUNT } from './aggregate';
export { CalculateFieldConfigSchema, MAX_CALCULATION_COUNT } from './calculate-field';
export {
  MissingValueConfigSchema,
  MissingValueMethodSchema,
  MissingValueRuleSchema,
} from './missing-value';
export type { MissingValueMethod, MissingValueRule } from './missing-value';
export { LimitConfigSchema } from './limit';
export {
  PivotConfigSchema,
  PivotLiteralSchema,
  PivotAxisEntrySchema,
  PivotMetricSchema,
  MAX_ON_COUNT,
  MAX_USING_COUNT,
  MAX_PIVOT_VALUES_PER_FIELD,
} from './pivot';
export type { PivotLiteral, PivotAxisEntry, PivotMetric } from './pivot';
export { JoinConfigSchema, JoinConditionSchema, MAX_JOIN_CONDITION_COUNT } from './join';
export type { DurationParts, JoinCondition } from './join';
export { FilterConfigSchema } from './filter';

// Import schemas for local use (separate from exports for CJS bundler compatibility)
import * as SortModule from './sort';
import * as FieldSelectModule from './field-select';
import * as FieldMappingModule from './field-mapping';
import * as DeduplicateModule from './deduplicate';
import * as TypeConvertModule from './type-convert';
import * as UnpivotModule from './unpivot';
import * as UnnestModule from './unnest';
import * as SetOpModule from './set-op';
import * as AggregateModule from './aggregate';
import * as CalculateFieldModule from './calculate-field';
import * as MissingValueModule from './missing-value';
import * as LimitModule from './limit';
import * as PivotModule from './pivot';
import * as JoinModule from './join';
import * as FilterModule from './filter';

export function parseOperatorConfig<T>(schema: ZodType<T>, config: Record<string, unknown>): T {
  return schema.parse(withoutOperatorMetadata(config));
}

export const SCHEMA_MAP: Record<string, ZodType> = {
  sort: SortModule.SortConfigSchema,
  field_select: FieldSelectModule.FieldSelectConfigSchema,
  field_mapping: FieldMappingModule.FieldMappingConfigSchema,
  deduplicate: DeduplicateModule.DeduplicateConfigSchema,
  type_convert: TypeConvertModule.TypeConvertConfigSchema,
  unpivot: UnpivotModule.UnpivotConfigSchema,
  unnest: UnnestModule.UnnestConfigSchema,
  set_op: SetOpModule.SetOpConfigSchema,
  aggregate: AggregateModule.AggregateConfigSchema,
  calculate_field: CalculateFieldModule.CalculateFieldConfigSchema,
  missing_value: MissingValueModule.MissingValueConfigSchema,
  limit: LimitModule.LimitConfigSchema,
  pivot: PivotModule.PivotConfigSchema,
  join: JoinModule.JoinConfigSchema,
  filter: FilterModule.FilterConfigSchema,
};

export function getOperatorConfigValidation(
  type: string,
  config: Record<string, unknown>
): ReturnType<ZodType['safeParse']> {
  const schema = SCHEMA_MAP[type];
  return schema
    ? schema.safeParse(withoutOperatorMetadata(config))
    : { success: true, data: config };
}

function withoutOperatorMetadata(config: Record<string, unknown>): Record<string, unknown> {
  const { generatedOrigin: _generatedOrigin, ...operatorConfig } = config;
  return operatorConfig;
}

export function validateOperatorConfig(
  type: string,
  config: Record<string, unknown>
): PrepDiagnostic[] {
  const result = getOperatorConfigValidation(type, config);
  if (result.success) return [];
  return result.error.issues.flatMap((issue) => {
    const parentPath = issue.path.join('.');
    const paths =
      issue.code === 'unrecognized_keys'
        ? issue.keys.map((key) => (parentPath ? `${parentPath}.${key}` : key))
        : [parentPath];
    return paths.map((path) => ({
      code: 'invalidConfig',
      severity: 'error' as const,
      message: `[${type}] ${path}: ${issue.message}`,
      line: 0,
      column: 0,
      params: { path, message: issue.message },
    }));
  });
}
