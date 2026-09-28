import { SqlQueryConfigSchema } from '../operator-schemas/sql-query';
import { sqlQueryCodec } from '../prep-dsl/operators/sql-query';
import { SortConfigSchema } from '../operator-schemas/sort';
import { FieldSelectConfigSchema } from '../operator-schemas/field-select';
import { FieldMappingConfigSchema } from '../operator-schemas/field-mapping';
import { DeduplicateConfigSchema } from '../operator-schemas/deduplicate';
import { TypeConvertConfigSchema } from '../operator-schemas/type-convert';
import { UnpivotConfigSchema } from '../operator-schemas/unpivot';
import { UnnestConfigSchema } from '../operator-schemas/unnest';
import { SetOpConfigSchema } from '../operator-schemas/set-op';
import { AggregateConfigSchema } from '../operator-schemas/aggregate';
import { CalculateFieldConfigSchema } from '../operator-schemas/calculate-field';
import { MissingValueConfigSchema } from '../operator-schemas/missing-value';
import { LimitConfigSchema } from '../operator-schemas/limit';
import { PivotConfigSchema } from '../operator-schemas/pivot';
import { JoinConfigSchema } from '../operator-schemas/join';
import { FilterConfigSchema } from '../operator-schemas/filter';
import { ExpectConfigSchema } from '../operator-schemas/expect';
import { InputSourceConfigSchema, OutputConfigSchema } from '../operator-schemas/input-output';
import { sortCodec } from '../prep-dsl/operators/sort';
import { fieldSelectCodec } from '../prep-dsl/operators/field-select';
import { fieldMappingCodec } from '../prep-dsl/operators/field-mapping';
import { deduplicateCodec } from '../prep-dsl/operators/deduplicate';
import { typeConvertCodec } from '../prep-dsl/operators/type-convert';
import { unpivotCodec } from '../prep-dsl/operators/unpivot';
import { unnestCodec } from '../prep-dsl/operators/unnest';
import { setOpCodec } from '../prep-dsl/operators/set-op';
import { aggregateCodec } from '../prep-dsl/operators/aggregate';
import { calculateFieldCodec } from '../prep-dsl/operators/calculate-field';
import { missingValueCodec } from '../prep-dsl/operators/missing-value';
import { limitCodec } from '../prep-dsl/operators/limit';
import { pivotCodec } from '../prep-dsl/operators/pivot';
import { joinCodec } from '../prep-dsl/operators/join';
import { filterCodec } from '../prep-dsl/operators/filter';
import { expectCodec } from '../prep-dsl/operators/expect';
import { outputCodec } from '../prep-dsl/operators/output';
import {
  BINARY_INPUT_PORTS,
  TRANSFORM_PORTS,
  defineOperator,
  type DataWorkflowOperatorType,
  type OperatorDefinition,
  type OperatorPorts,
} from './definition';

const SOURCE_PORTS: OperatorPorts = { inputs: [], outputs: ['output'] };
const SINK_PORTS: OperatorPorts = { inputs: ['input'], outputs: [] };
const EXPECT_PORTS: OperatorPorts = { inputs: ['input'], outputs: ['output', 'reject'] };

/**
 * The single operator registration point. `satisfies` over
 * `DataWorkflowOperatorType` makes a missing or misspelled entry a compile
 * error; cross-registry completeness (SCHEMA_MAP, DSL codecs, COMPILE_STRATEGIES,
 * renderer OPERATOR_UI) is asserted in operator-registry.test.ts.
 */
export const OPERATOR_DEFINITIONS = {
  input_source: defineOperator({
    type: 'input_source',
    category: 'input_output',
    schema: InputSourceConfigSchema,
    ports: SOURCE_PORTS,
    compileKind: 'input_source',
    // No DSL codec: sources are bound via `from <ref>`/resources, not steps.
  }),
  filter: defineOperator({
    type: 'filter',
    category: 'data_transform',
    schema: FilterConfigSchema,
    ports: TRANSFORM_PORTS,
    compileKind: 'strategy',
    dsl: filterCodec,
  }),
  field_select: defineOperator({
    type: 'field_select',
    category: 'data_transform',
    schema: FieldSelectConfigSchema,
    ports: TRANSFORM_PORTS,
    compileKind: 'strategy',
    dsl: fieldSelectCodec,
  }),
  deduplicate: defineOperator({
    type: 'deduplicate',
    category: 'advanced_compute',
    schema: DeduplicateConfigSchema,
    ports: TRANSFORM_PORTS,
    compileKind: 'strategy',
    dsl: deduplicateCodec,
  }),
  missing_value: defineOperator({
    type: 'missing_value',
    category: 'advanced_compute',
    schema: MissingValueConfigSchema,
    ports: TRANSFORM_PORTS,
    compileKind: 'strategy',
    dsl: missingValueCodec,
  }),
  type_convert: defineOperator({
    type: 'type_convert',
    category: 'data_transform',
    schema: TypeConvertConfigSchema,
    ports: TRANSFORM_PORTS,
    compileKind: 'strategy',
    dsl: typeConvertCodec,
  }),
  sort: defineOperator({
    type: 'sort',
    category: 'data_transform',
    schema: SortConfigSchema,
    ports: TRANSFORM_PORTS,
    compileKind: 'strategy',
    dsl: sortCodec,
  }),
  join: defineOperator({
    type: 'join',
    category: 'data_transform',
    schema: JoinConfigSchema,
    ports: BINARY_INPUT_PORTS,
    compileKind: 'join',
    dsl: joinCodec,
  }),
  aggregate: defineOperator({
    type: 'aggregate',
    category: 'data_transform',
    schema: AggregateConfigSchema,
    ports: TRANSFORM_PORTS,
    compileKind: 'strategy',
    dsl: aggregateCodec,
  }),
  calculate_field: defineOperator({
    type: 'calculate_field',
    category: 'data_transform',
    schema: CalculateFieldConfigSchema,
    ports: TRANSFORM_PORTS,
    compileKind: 'strategy',
    dsl: calculateFieldCodec,
  }),
  field_mapping: defineOperator({
    type: 'field_mapping',
    category: 'data_transform',
    schema: FieldMappingConfigSchema,
    ports: TRANSFORM_PORTS,
    compileKind: 'strategy',
    dsl: fieldMappingCodec,
  }),
  limit: defineOperator({
    type: 'limit',
    category: 'data_transform',
    schema: LimitConfigSchema,
    ports: TRANSFORM_PORTS,
    compileKind: 'strategy',
    dsl: limitCodec,
  }),
  pivot: defineOperator({
    type: 'pivot',
    category: 'advanced_compute',
    schema: PivotConfigSchema,
    ports: TRANSFORM_PORTS,
    compileKind: 'strategy',
    dsl: pivotCodec,
  }),
  unpivot: defineOperator({
    type: 'unpivot',
    category: 'advanced_compute',
    schema: UnpivotConfigSchema,
    ports: TRANSFORM_PORTS,
    compileKind: 'strategy',
    dsl: unpivotCodec,
  }),
  set_op: defineOperator({
    type: 'set_op',
    category: 'data_transform',
    schema: SetOpConfigSchema,
    ports: BINARY_INPUT_PORTS,
    compileKind: 'set_op',
    dsl: setOpCodec,
  }),
  unnest: defineOperator({
    type: 'unnest',
    category: 'advanced_compute',
    schema: UnnestConfigSchema,
    ports: TRANSFORM_PORTS,
    compileKind: 'strategy',
    dsl: unnestCodec,
  }),
  expect: defineOperator({
    type: 'expect',
    category: 'advanced_compute',
    schema: ExpectConfigSchema,
    ports: EXPECT_PORTS,
    compileKind: 'expect',
    dsl: expectCodec,
  }),
  sql_query: defineOperator({
    type: 'sql_query',
    category: 'advanced_compute',
    schema: SqlQueryConfigSchema,
    ports: TRANSFORM_PORTS,
    compileKind: 'sql_query',
    dsl: sqlQueryCodec,
  }),
  output: defineOperator({
    type: 'output',
    category: 'input_output',
    schema: OutputConfigSchema,
    ports: SINK_PORTS,
    compileKind: 'output',
    dsl: outputCodec,
  }),
} satisfies Record<DataWorkflowOperatorType, OperatorDefinition>;

export type OperatorDefinitionMap = typeof OPERATOR_DEFINITIONS;

/** Per-type config types inferred from the registered schemas. */
export type WorkflowOperatorConfigMap = {
  [T in DataWorkflowOperatorType]: import('zod').infer<OperatorDefinitionMap[T]['schema']>;
};
