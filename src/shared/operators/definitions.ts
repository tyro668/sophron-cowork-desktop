import { SqlQueryConfigSchema } from '../operator-schemas/sql-query';
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
  input: defineOperator({
    type: 'input',
    category: 'input_output',
    schema: InputSourceConfigSchema,
    ports: SOURCE_PORTS,
    compileKind: 'input',
    // No DSL codec: sources are bound via `from <ref>`/resources, not steps.
  }),
  filter: defineOperator({
    type: 'filter',
    category: 'data_transform',
    schema: FilterConfigSchema,
    ports: TRANSFORM_PORTS,
    compileKind: 'strategy',
  }),
  select: defineOperator({
    type: 'select',
    category: 'data_transform',
    schema: FieldSelectConfigSchema,
    ports: TRANSFORM_PORTS,
    compileKind: 'strategy',
  }),
  deduplicate: defineOperator({
    type: 'deduplicate',
    category: 'cleaning',
    schema: DeduplicateConfigSchema,
    ports: TRANSFORM_PORTS,
    compileKind: 'strategy',
  }),
  missing_value: defineOperator({
    type: 'missing_value',
    category: 'cleaning',
    schema: MissingValueConfigSchema,
    ports: TRANSFORM_PORTS,
    compileKind: 'strategy',
  }),
  cast: defineOperator({
    type: 'cast',
    category: 'cleaning',
    schema: TypeConvertConfigSchema,
    ports: TRANSFORM_PORTS,
    compileKind: 'strategy',
  }),
  sort: defineOperator({
    type: 'sort',
    category: 'data_transform',
    schema: SortConfigSchema,
    ports: TRANSFORM_PORTS,
    compileKind: 'strategy',
  }),
  join: defineOperator({
    type: 'join',
    category: 'data_transform',
    schema: JoinConfigSchema,
    ports: BINARY_INPUT_PORTS,
    compileKind: 'join',
    creationDefaults: {
      conflict: { strategy: 'suffix', leftSuffix: '_left', rightSuffix: '_right' },
    },
  }),
  aggregate: defineOperator({
    type: 'aggregate',
    category: 'data_transform',
    schema: AggregateConfigSchema,
    ports: TRANSFORM_PORTS,
    compileKind: 'strategy',
  }),
  derive: defineOperator({
    type: 'derive',
    category: 'data_transform',
    schema: CalculateFieldConfigSchema,
    ports: TRANSFORM_PORTS,
    compileKind: 'strategy',
  }),
  rename: defineOperator({
    type: 'rename',
    category: 'cleaning',
    schema: FieldMappingConfigSchema,
    ports: TRANSFORM_PORTS,
    compileKind: 'strategy',
  }),
  limit: defineOperator({
    type: 'limit',
    category: 'data_transform',
    schema: LimitConfigSchema,
    ports: TRANSFORM_PORTS,
    compileKind: 'strategy',
    creationDefaults: { limit: 10 },
  }),
  pivot: defineOperator({
    type: 'pivot',
    category: 'advanced_compute',
    schema: PivotConfigSchema,
    ports: TRANSFORM_PORTS,
    compileKind: 'strategy',
  }),
  unpivot: defineOperator({
    type: 'unpivot',
    category: 'advanced_compute',
    schema: UnpivotConfigSchema,
    ports: TRANSFORM_PORTS,
    compileKind: 'strategy',
  }),
  set_op: defineOperator({
    type: 'set_op',
    category: 'data_transform',
    schema: SetOpConfigSchema,
    ports: BINARY_INPUT_PORTS,
    compileKind: 'set_op',
  }),
  unnest: defineOperator({
    type: 'unnest',
    category: 'advanced_compute',
    schema: UnnestConfigSchema,
    ports: TRANSFORM_PORTS,
    compileKind: 'strategy',
  }),
  expect: defineOperator({
    type: 'expect',
    category: 'advanced_compute',
    schema: ExpectConfigSchema,
    ports: EXPECT_PORTS,
    compileKind: 'expect',
  }),
  sql: defineOperator({
    type: 'sql',
    category: 'advanced_compute',
    schema: SqlQueryConfigSchema,
    ports: TRANSFORM_PORTS,
    compileKind: 'sql',
  }),
  output: defineOperator({
    type: 'output',
    category: 'input_output',
    schema: OutputConfigSchema,
    ports: SINK_PORTS,
    compileKind: 'output',
  }),
} satisfies Record<DataWorkflowOperatorType, OperatorDefinition>;

export type OperatorDefinitionMap = typeof OPERATOR_DEFINITIONS;

/** Per-type config types inferred from the registered schemas. */
export type WorkflowOperatorConfigMap = {
  [T in DataWorkflowOperatorType]: import('zod').infer<OperatorDefinitionMap[T]['schema']>;
};
