export const WORKFLOW_BINARY_EXPRESSION_METHODS = {
  eq: '=',
  neq: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  contains: 'contains',
  notContains: 'not_contains',
  and: 'and',
  or: 'or',
  add: '+',
  sub: '-',
  mul: '*',
  div: '/',
} as const;

export const WORKFLOW_UNARY_EXPRESSION_METHODS = {
  isNull: 'is_null',
  isNotNull: 'is_not_null',
  not: 'not',
} as const;

export const WORKFLOW_DATE_DIFF_UNITS = [
  'microsecond',
  'millisecond',
  'second',
  'minute',
  'hour',
  'day',
  'week',
  'month',
  'quarter',
  'year',
] as const;

export const WORKFLOW_EXPRESSION_CAST_TYPES = [
  'integer',
  'float',
  'decimal',
  'text',
  'boolean',
  'date',
  'datetime',
  'timestamp',
] as const;

export const WORKFLOW_DECIMAL_SCALE_MIN = 0;
export const WORKFLOW_DECIMAL_SCALE_MAX = 12;
export const WORKFLOW_DEFAULT_DECIMAL_SCALE = 2;

export function isWorkflowDecimalScale(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= WORKFLOW_DECIMAL_SCALE_MIN &&
    value <= WORKFLOW_DECIMAL_SCALE_MAX
  );
}

export type WorkflowExpressionFunctionResultType =
  | 'text'
  | 'integer'
  | 'decimal'
  | 'same_as_first'
  | 'conditional';

export type WorkflowExpressionArgumentType =
  | 'any'
  | 'text'
  | 'numeric'
  | 'integer'
  | 'temporal'
  | 'boolean';

interface WorkflowExpressionFunctionDefinitionBase {
  dslName: string;
  minArgs: number;
  maxArgs?: number;
  resultType?: WorkflowExpressionFunctionResultType;
  argumentTypes?: readonly WorkflowExpressionArgumentType[];
  semanticRule?: 'date_diff' | 'conditional' | 'compatible' | 'numeric';
  coerceFirstArgToText?: boolean;
}

export type WorkflowExpressionFunctionDefinition = WorkflowExpressionFunctionDefinitionBase &
  (
    | { native: true; typescriptDeclaration: string }
    | { native: false; typescriptDeclaration?: never }
  );

/**
 * Single source of truth for callable expression functions.
 *
 * The registry drives the model prompt, native-JavaScript allowlist, generated
 * TypeScript declarations, sandbox compatibility API, arity validation, DSL
 * function names and result-type inference. `ifElse` remains runtime-only for
 * legacy workflows; newly generated JavaScript uses the native ternary operator.
 */
export const WORKFLOW_EXPRESSION_FUNCTION_REGISTRY = {
  regexpExtract: {
    dslName: 'REGEXP_EXTRACT',
    native: true,
    minArgs: 2,
    maxArgs: 3,
    resultType: 'text',
    argumentTypes: ['any', 'text', 'integer'],
    coerceFirstArgToText: true,
    typescriptDeclaration:
      'declare function regexpExtract(value: string, pattern: string, group?: number): string;',
  },
  year: {
    dslName: 'YEAR',
    native: true,
    minArgs: 1,
    maxArgs: 1,
    resultType: 'integer',
    argumentTypes: ['temporal'],
    typescriptDeclaration: 'declare function year(value: Date): number;',
  },
  month: {
    dslName: 'MONTH',
    native: true,
    minArgs: 1,
    maxArgs: 1,
    resultType: 'integer',
    argumentTypes: ['temporal'],
    typescriptDeclaration: 'declare function month(value: Date): number;',
  },
  upper: {
    dslName: 'UPPER',
    native: true,
    minArgs: 1,
    maxArgs: 1,
    resultType: 'text',
    argumentTypes: ['any'],
    coerceFirstArgToText: true,
    typescriptDeclaration: 'declare function upper(value: string): string;',
  },
  lower: {
    dslName: 'LOWER',
    native: true,
    minArgs: 1,
    maxArgs: 1,
    resultType: 'text',
    argumentTypes: ['any'],
    coerceFirstArgToText: true,
    typescriptDeclaration: 'declare function lower(value: string): string;',
  },
  trim: {
    dslName: 'TRIM',
    native: true,
    minArgs: 1,
    maxArgs: 1,
    resultType: 'text',
    argumentTypes: ['any'],
    coerceFirstArgToText: true,
    typescriptDeclaration: 'declare function trim(value: string): string;',
  },
  replace: {
    dslName: 'REPLACE',
    native: true,
    minArgs: 3,
    maxArgs: 3,
    resultType: 'text',
    argumentTypes: ['any', 'text', 'text'],
    coerceFirstArgToText: true,
    typescriptDeclaration:
      'declare function replace(value: string, search: string, replacement: string): string;',
  },
  concat: {
    dslName: 'CONCAT',
    native: true,
    minArgs: 1,
    resultType: 'text',
    typescriptDeclaration:
      'declare function concat(...values: Array<string | number | boolean | null | undefined>): string;',
  },
  nullif: {
    dslName: 'NULLIF',
    native: true,
    minArgs: 2,
    maxArgs: 2,
    resultType: 'same_as_first',
    semanticRule: 'compatible',
    typescriptDeclaration: 'declare function nullif<T>(value: T, other: T): T | null;',
  },
  dateDiff: {
    dslName: 'DATE_DIFF',
    native: true,
    minArgs: 3,
    maxArgs: 3,
    resultType: 'integer',
    argumentTypes: ['text', 'temporal', 'temporal'],
    semanticRule: 'date_diff',
    typescriptDeclaration: `declare function dateDiff(unit: ${WORKFLOW_DATE_DIFF_UNITS.map((unit) => JSON.stringify(unit)).join(' | ')}, start: Date, end: Date): number;`,
  },
  ifElse: {
    dslName: 'IF',
    native: false,
    minArgs: 3,
    maxArgs: 3,
    resultType: 'conditional',
    argumentTypes: ['boolean', 'any', 'any'],
    semanticRule: 'conditional',
  },
  coalesce: {
    dslName: 'COALESCE',
    native: true,
    minArgs: 2,
    resultType: 'same_as_first',
    semanticRule: 'compatible',
    typescriptDeclaration:
      'declare function coalesce<T>(...values: Array<T | null | undefined>): T;',
  },
  round: {
    dslName: 'ROUND',
    native: true,
    minArgs: 1,
    maxArgs: 2,
    resultType: 'decimal',
    argumentTypes: ['numeric', 'integer'],
    semanticRule: 'numeric',
    typescriptDeclaration: 'declare function round(value: number, digits?: number): number;',
  },
  abs: {
    dslName: 'ABS',
    native: true,
    minArgs: 1,
    maxArgs: 1,
    resultType: 'decimal',
    argumentTypes: ['numeric'],
    semanticRule: 'numeric',
    typescriptDeclaration: 'declare function abs(value: number): number;',
  },
} as const satisfies Record<string, WorkflowExpressionFunctionDefinition>;

export type WorkflowExpressionFunctionName = keyof typeof WORKFLOW_EXPRESSION_FUNCTION_REGISTRY;

interface WorkflowNativeExpressionIntrinsicDefinition {
  binaryOperator: 'contains' | 'not_contains';
  minArgs: number;
  maxArgs: number;
  typescriptDeclaration: string;
}

/** Native-only calls whose stable IR shape is a binary operator, not a function. */
export const WORKFLOW_NATIVE_EXPRESSION_INTRINSICS = {
  contains: {
    binaryOperator: 'contains',
    minArgs: 2,
    maxArgs: 2,
    typescriptDeclaration: 'declare function contains(value: unknown, search: unknown): boolean;',
  },
  notContains: {
    binaryOperator: 'not_contains',
    minArgs: 2,
    maxArgs: 2,
    typescriptDeclaration:
      'declare function notContains(value: unknown, search: unknown): boolean;',
  },
} as const satisfies Record<string, WorkflowNativeExpressionIntrinsicDefinition>;

export const WORKFLOW_EXPRESSION_FUNCTIONS = Object.fromEntries(
  Object.entries(WORKFLOW_EXPRESSION_FUNCTION_REGISTRY).map(([name, definition]) => [
    name,
    definition.dslName,
  ])
) as Record<WorkflowExpressionFunctionName, string>;

export const WORKFLOW_BINARY_EXPRESSION_OPERATORS = new Set<string>(
  Object.values(WORKFLOW_BINARY_EXPRESSION_METHODS)
);
export const WORKFLOW_UNARY_EXPRESSION_OPERATORS = new Set<string>(
  Object.values(WORKFLOW_UNARY_EXPRESSION_METHODS)
);
export const WORKFLOW_EXPRESSION_FUNCTION_NAMES = new Set<string>(
  Object.keys(WORKFLOW_EXPRESSION_FUNCTION_REGISTRY)
);

export function getWorkflowExpressionRuntimeCapabilities() {
  return {
    binaryMethods: WORKFLOW_BINARY_EXPRESSION_METHODS,
    unaryMethods: WORKFLOW_UNARY_EXPRESSION_METHODS,
    functions: Object.keys(WORKFLOW_EXPRESSION_FUNCTION_REGISTRY),
  };
}

export function getWorkflowExpressionCapabilityPrompt(): string {
  const nativeFunctions = Object.entries(WORKFLOW_EXPRESSION_FUNCTION_REGISTRY)
    .filter(([, definition]) => definition.native)
    .map(([name]) => name);
  return [
    'Native row expressions use expr(row => expression), with columns referenced as row["field"] or row.field.',
    'Allowed native operators: numeric +, -, *, /; comparisons ===, !==, >, >=, <, <=; boolean &&, ||, !; null fallback ??; and condition ? whenTrue : whenFalse.',
    `Allowed native domain functions: ${[
      ...nativeFunctions,
      ...Object.keys(WORKFLOW_NATIVE_EXPRESSION_INTRINSICS),
    ].join(', ')}.`,
    'Use concat(...) for text concatenation; native + is numeric-only in workflow expressions.',
    `Native cast function: cast(value, ${WORKFLOW_EXPRESSION_CAST_TYPES.map((type) => JSON.stringify(type)).join(' | ')}, { scale?: number }).`,
  ].join(' ');
}

export function getWorkflowExpressionTypeScriptDeclarations(): string {
  return [
    ...Object.values(WORKFLOW_EXPRESSION_FUNCTION_REGISTRY)
      .filter((definition) => definition.native)
      .map((definition) => definition.typescriptDeclaration),
    ...Object.values(WORKFLOW_NATIVE_EXPRESSION_INTRINSICS).map(
      (definition) => definition.typescriptDeclaration
    ),
  ].join('\n');
}

export function getWorkflowExpressionFunctionDefinition(
  name: string
): WorkflowExpressionFunctionDefinition | undefined {
  return WORKFLOW_EXPRESSION_FUNCTION_REGISTRY[name as WorkflowExpressionFunctionName] as
    | WorkflowExpressionFunctionDefinition
    | undefined;
}

export function getWorkflowNativeIntrinsicDefinition(
  name: string
): WorkflowNativeExpressionIntrinsicDefinition | undefined {
  return WORKFLOW_NATIVE_EXPRESSION_INTRINSICS[
    name as keyof typeof WORKFLOW_NATIVE_EXPRESSION_INTRINSICS
  ];
}

export function workflowExpressionArityIsValid(
  definition: { minArgs: number; maxArgs?: number },
  count: number
): boolean {
  return (
    count >= definition.minArgs && (definition.maxArgs === undefined || count <= definition.maxArgs)
  );
}

export function workflowExpressionArityDescription(definition: {
  minArgs: number;
  maxArgs?: number;
}): string {
  if (definition.maxArgs === definition.minArgs) return `exactly ${definition.minArgs}`;
  if (definition.maxArgs === undefined) return `at least ${definition.minArgs}`;
  return `${definition.minArgs} to ${definition.maxArgs}`;
}

export function workflowExpressionFunctionToDsl(name: string): string | undefined {
  return getWorkflowExpressionFunctionDefinition(name)?.dslName;
}

export function workflowExpressionFunctionResultType(
  name: string
): WorkflowExpressionFunctionResultType | undefined {
  return getWorkflowExpressionFunctionDefinition(name)?.resultType;
}

export function normalizeWorkflowExpressionCastType(targetType: string): string | undefined {
  if (!isWorkflowExpressionCastType(targetType)) return undefined;
  return targetType === 'timestamp' ? 'datetime' : targetType;
}

export function isWorkflowExpressionCastType(targetType: string): boolean {
  return (WORKFLOW_EXPRESSION_CAST_TYPES as readonly string[]).includes(targetType);
}
