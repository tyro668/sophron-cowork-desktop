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
export {
  ASOF_DIRECTIONS,
  JOIN_EXPECTATIONS,
  REGULAR_JOIN_TYPES,
  JoinConfigSchema,
  JoinConditionSchema,
  MAX_JOIN_CONDITION_COUNT,
} from './join';
export type { DurationParts, JoinCondition } from './join';
export { FilterConfigSchema } from './filter';
export { ExpectConfigSchema, EXPECT_KINDS, EXPECT_ROW_OPERATORS } from './expect';
export { InputSourceConfigSchema, OutputConfigSchema } from './input-output';

// The registry is the single source of truth: SCHEMA_MAP is derived from
// OPERATOR_DEFINITIONS, and config validation lives next to it.
export {
  SCHEMA_MAP,
  getOperatorConfigValidation,
  parseOperatorConfig,
  validateOperatorConfig,
} from '../operators';
