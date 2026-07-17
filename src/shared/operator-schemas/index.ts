import type { ZodType } from 'zod';

export function parseOperatorConfig<T>(schema: ZodType<T>, config: Record<string, unknown>): T {
  return schema.parse(config);
}

export {
  SortKeySchema,
  ConditionSchema,
  ConflictSchema,
  MetricEntrySchema,
  KeepItemSchema,
} from './common';
export { SortConfigSchema } from './sort';
export { FieldSelectConfigSchema } from './field-select';
export { FieldMappingConfigSchema } from './field-mapping';
export { DeduplicateConfigSchema } from './deduplicate';
export { TypeConvertConfigSchema } from './type-convert';
export { UnpivotConfigSchema } from './unpivot';
export { UnnestConfigSchema } from './unnest';
export { SetOpConfigSchema } from './set-op';
export { AggregateConfigSchema } from './aggregate';
export { CalculateFieldConfigSchema } from './calculate-field';
export { MissingValueConfigSchema } from './missing-value';
export { LimitConfigSchema } from './limit';
export { PivotConfigSchema } from './pivot';
export { JoinConfigSchema } from './join';
