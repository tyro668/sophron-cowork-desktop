import type { ZodType } from 'zod';
import type { PrepDiagnostic } from '../prep-dsl/ast';

// Re-export schemas for external consumers (must use export-from for CJS compatibility)
export {
  SortKeySchema,
  type SortKey,
  ConditionSchema,
  ConflictSchema,
  MetricEntrySchema,
  KeepItemSchema,
} from './common';
export { SortConfigSchema } from './sort';
export { FieldSelectConfigSchema } from './field-select';
export { FieldMappingConfigSchema } from './field-mapping';
export { DeduplicateConfigSchema } from './deduplicate';
export {
  TypeConvertConfigSchema,
  DATE_FORMAT_VALUES,
  DATE_FORMAT_PRESETS,
  SCALE_MIN,
  SCALE_MAX,
} from './type-convert';
export type { DateFormat } from './type-convert';
export { UnpivotConfigSchema } from './unpivot';
export { UnnestConfigSchema } from './unnest';
export { SetOpConfigSchema } from './set-op';
export { AggregateConfigSchema } from './aggregate';
export { CalculateFieldConfigSchema } from './calculate-field';
export { MissingValueConfigSchema } from './missing-value';
export { LimitConfigSchema } from './limit';
export { PivotConfigSchema } from './pivot';
export { JoinConfigSchema } from './join';

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

export function parseOperatorConfig<T>(schema: ZodType<T>, config: Record<string, unknown>): T {
  return schema.parse(config);
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
};

export function validateOperatorConfig(
  type: string,
  config: Record<string, unknown>
): PrepDiagnostic[] {
  const schema = SCHEMA_MAP[type];
  if (!schema) return [];
  const result = schema.safeParse(config);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    code: 'invalidConfig',
    severity: 'error' as const,
    message: `[${type}] ${issue.path.join('.')}: ${issue.message}`,
    line: 0,
    column: 0,
    params: { path: issue.path.join('.'), message: issue.message },
  }));
}
