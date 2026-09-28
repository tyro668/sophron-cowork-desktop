import type { ZodIssue, ZodType } from 'zod';
import type { PrepDiagnostic } from '../prep-dsl/ast';
import type { OperatorDslCodec } from '../prep-dsl/operators/codec';

/**
 * Canonical workflow operator registry contract.
 *
 * `OPERATOR_TYPES` is the single source of truth for the operator union: every
 * registry (schemas, DSL codecs, SQL compile strategies, renderer UI entries,
 * capability manifest) derives from or is checked against this list, and
 * `OPERATOR_DEFINITIONS` (in `./definitions`) must contain exactly one entry
 * per type — enforced by `satisfies` at compile time and by
 * `src/tests/contracts/operator-registry.test.ts` at runtime.
 *
 * Adding an operator means: schema file in `operator-schemas/`, codec in
 * `prep-dsl/operators/`, SQL compile in `main/data/operators/` when the
 * compileKind is `strategy`, one entry here, and one UI entry in the renderer
 * `OPERATOR_UI` registry.
 */
export const OPERATOR_TYPES = [
  'input_source',
  'filter',
  'field_select',
  'type_convert',
  'sort',
  'join',
  'aggregate',
  'calculate_field',
  'field_mapping',
  'limit',
  'set_op',
  'sql_query',
  'deduplicate',
  'missing_value',
  'pivot',
  'unpivot',
  'unnest',
  'expect',
  'output',
] as const;

export type DataWorkflowOperatorType = (typeof OPERATOR_TYPES)[number];

/** Product categories, independent of how an operator is compiled/executed. */
export const OPERATOR_CATEGORIES = ['input_output', 'data_transform', 'advanced_compute'] as const;
export type OperatorCategory = (typeof OPERATOR_CATEGORIES)[number];

export type OperatorInputHandle = 'input' | 'left' | 'right';
export type OperatorOutputHandle = 'output' | 'reject';

/** Declared edge endpoints of an operator — drives graph validation and canvas wiring. */
export interface OperatorPorts {
  /** Accepted incoming-edge handles. Empty = source-only operator (input_source). */
  readonly inputs: readonly OperatorInputHandle[];
  /** Provided outgoing-edge handles. Empty = sink-only operator (output). */
  readonly outputs: readonly OperatorOutputHandle[];
}

export const TRANSFORM_PORTS: OperatorPorts = { inputs: ['input'], outputs: ['output'] };
export const BINARY_INPUT_PORTS: OperatorPorts = {
  inputs: ['left', 'right'],
  outputs: ['output'],
};

/**
 * How the runtime compiles/executes a node of this type:
 * - `strategy` — single-input SQL via `COMPILE_STRATEGIES[type]`
 * - `join` / `set_op` — dedicated two-input compilers in WorkflowCompiler
 * - `input_source` / `output` / `expect` — source materialization, sink
 *   commit, and quality gate respectively; not transform strategies.
 * - `sql_query` — a native query bound against the upstream relation.
 */
export type OperatorCompileKind =
  | 'strategy'
  | 'join'
  | 'set_op'
  | 'input_source'
  | 'output'
  | 'expect'
  | 'sql_query';

/**
 * Process-agnostic operator definition. Everything the platform needs to know
 * about an operator type that is not renderer-specific.
 */
export interface OperatorDefinition<TConfig = Record<string, unknown>> {
  readonly type: DataWorkflowOperatorType;
  /** Product grouping; advanced compute includes custom SQL and complex algorithms. */
  readonly category: OperatorCategory;
  /** Authoritative zod schema for the node config. */
  readonly schema: ZodType<TConfig>;
  readonly ports: OperatorPorts;
  readonly compileKind: OperatorCompileKind;
  /** Prep DSL parse/format codec; absent for operators not expressible as a step. */
  readonly dsl?: OperatorDslCodec;
  /** Fresh config for a newly created node — schema defaults where expressible. */
  createDefaultConfig(): TConfig;
  /** Schema validation producing PrepDiagnostic list (same codes as the plan pipeline). */
  validateConfig(config: Record<string, unknown>): PrepDiagnostic[];
}

/** Strips GUI/DSL metadata keys that are not part of the operator contract. */
export function withoutOperatorMetadata(config: Record<string, unknown>): Record<string, unknown> {
  const operatorConfig = { ...config };
  delete operatorConfig.generatedOrigin;
  delete operatorConfig.stepName;
  delete operatorConfig.dsl;
  return operatorConfig;
}

export function issuesToDiagnostics(type: string, issues: ZodIssue[]): PrepDiagnostic[] {
  return issues.flatMap((issue) => {
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

export function configSchemaDiagnostics(
  type: string,
  schema: ZodType,
  config: Record<string, unknown>
): PrepDiagnostic[] {
  const result = schema.safeParse(withoutOperatorMetadata(config));
  return result.success ? [] : issuesToDiagnostics(type, result.error.issues);
}

export function defineOperator<TConfig>(init: {
  readonly type: DataWorkflowOperatorType;
  readonly category: OperatorCategory;
  readonly schema: ZodType<TConfig>;
  readonly ports: OperatorPorts;
  readonly compileKind: OperatorCompileKind;
  readonly dsl?: OperatorDslCodec;
}): OperatorDefinition<TConfig> {
  return {
    ...init,
    createDefaultConfig(): TConfig {
      const parsed = init.schema.safeParse({});
      return parsed.success ? parsed.data : ({} as TConfig);
    },
    validateConfig(config: Record<string, unknown>): PrepDiagnostic[] {
      return configSchemaDiagnostics(init.type, init.schema, config);
    },
  };
}
