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

interface WorkflowExpressionCastDefinition {
  normalizedType: 'integer' | 'float' | 'decimal' | 'text' | 'boolean' | 'date' | 'datetime';
  typescriptResult: 'number' | 'string' | 'boolean' | 'Date';
  supportsScale: boolean;
}

/** Authoring spellings and options accepted by the existing Prep DSL lowering path. */
export const WORKFLOW_EXPRESSION_CAST_REGISTRY = {
  integer: { normalizedType: 'integer', typescriptResult: 'number', supportsScale: false },
  float: { normalizedType: 'float', typescriptResult: 'number', supportsScale: false },
  decimal: { normalizedType: 'decimal', typescriptResult: 'number', supportsScale: true },
  text: { normalizedType: 'text', typescriptResult: 'string', supportsScale: false },
  boolean: { normalizedType: 'boolean', typescriptResult: 'boolean', supportsScale: false },
  date: { normalizedType: 'date', typescriptResult: 'Date', supportsScale: false },
  datetime: { normalizedType: 'datetime', typescriptResult: 'Date', supportsScale: false },
  timestamp: { normalizedType: 'datetime', typescriptResult: 'Date', supportsScale: false },
} as const satisfies Record<string, WorkflowExpressionCastDefinition>;

export const WORKFLOW_EXPRESSION_CAST_TYPES = Object.freeze(
  Object.keys(WORKFLOW_EXPRESSION_CAST_REGISTRY) as Array<
    keyof typeof WORKFLOW_EXPRESSION_CAST_REGISTRY
  >
);

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
      'declare function regexpExtract(value: unknown, pattern: string, group?: number): string;',
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
    typescriptDeclaration: 'declare function upper(value: unknown): string;',
  },
  lower: {
    dslName: 'LOWER',
    native: true,
    minArgs: 1,
    maxArgs: 1,
    resultType: 'text',
    argumentTypes: ['any'],
    coerceFirstArgToText: true,
    typescriptDeclaration: 'declare function lower(value: unknown): string;',
  },
  trim: {
    dslName: 'TRIM',
    native: true,
    minArgs: 1,
    maxArgs: 1,
    resultType: 'text',
    argumentTypes: ['any'],
    coerceFirstArgToText: true,
    typescriptDeclaration: 'declare function trim(value: unknown): string;',
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
      'declare function replace(value: unknown, search: string, replacement: string): string;',
  },
  concat: {
    dslName: 'CONCAT',
    native: true,
    minArgs: 1,
    resultType: 'text',
    typescriptDeclaration:
      'declare function concat(...values: Array<string | number | boolean | Date | null>): string;',
  },
  nullif: {
    dslName: 'NULLIF',
    native: true,
    minArgs: 2,
    maxArgs: 2,
    resultType: 'same_as_first',
    semanticRule: 'compatible',
    typescriptDeclaration: [
      'declare function nullif(value: number, other: number): number;',
      'declare function nullif(value: string, other: string): string;',
      'declare function nullif(value: boolean, other: boolean): boolean;',
      'declare function nullif(value: Date, other: Date): Date;',
    ].join('\n'),
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
    typescriptDeclaration: [
      'declare function coalesce(...values: Array<number | null>): number;',
      'declare function coalesce(...values: Array<string | null>): string;',
      'declare function coalesce(...values: Array<boolean | null>): boolean;',
      'declare function coalesce(...values: Array<Date | null>): Date;',
    ].join('\n'),
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
    typescriptDeclaration: 'declare function contains(value: unknown, search: string): boolean;',
  },
  notContains: {
    binaryOperator: 'not_contains',
    minArgs: 2,
    maxArgs: 2,
    typescriptDeclaration: 'declare function notContains(value: unknown, search: string): boolean;',
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
    `Native cast functions: cast(value, ${WORKFLOW_EXPRESSION_CAST_TYPES.filter(
      (type) => !WORKFLOW_EXPRESSION_CAST_REGISTRY[type].supportsScale
    )
      .map((type) => JSON.stringify(type))
      .join(
        ' | '
      )}); cast(value, "decimal", { scale?: ${workflowDecimalScaleTypeScriptType()} } | ${workflowDecimalScaleTypeScriptType()}). Decimal is the only cast that accepts a scale.`,
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
    ...getWorkflowExpressionCastTypeScriptDeclarations(),
  ].join('\n');
}

function getWorkflowExpressionCastTypeScriptDeclarations(): string[] {
  const withoutScale = Object.entries(WORKFLOW_EXPRESSION_CAST_REGISTRY).filter(
    ([, definition]) => !definition.supportsScale
  );
  const byResult = new Map<string, string[]>();
  for (const [name, definition] of withoutScale) {
    byResult.set(definition.typescriptResult, [
      ...(byResult.get(definition.typescriptResult) ?? []),
      name,
    ]);
  }
  const declarations = [...byResult].map(
    ([result, names]) =>
      `declare function cast(value: unknown, targetType: ${names.map((name) => JSON.stringify(name)).join(' | ')}): ${result};`
  );
  const scale = workflowDecimalScaleTypeScriptType();
  declarations.push(
    `declare function cast(value: unknown, targetType: "decimal", options?: { scale?: ${scale} } | ${scale}): number;`
  );
  return declarations;
}

function workflowDecimalScaleTypeScriptType(): string {
  return Array.from(
    { length: WORKFLOW_DECIMAL_SCALE_MAX - WORKFLOW_DECIMAL_SCALE_MIN + 1 },
    (_, index) => String(index + WORKFLOW_DECIMAL_SCALE_MIN)
  ).join(' | ');
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
  return WORKFLOW_EXPRESSION_CAST_REGISTRY[
    targetType as keyof typeof WORKFLOW_EXPRESSION_CAST_REGISTRY
  ]?.normalizedType;
}

export function isWorkflowExpressionCastType(targetType: string): boolean {
  return Object.prototype.hasOwnProperty.call(WORKFLOW_EXPRESSION_CAST_REGISTRY, targetType);
}

export function workflowExpressionCastSupportsScale(targetType: string): boolean {
  return Boolean(
    WORKFLOW_EXPRESSION_CAST_REGISTRY[targetType as keyof typeof WORKFLOW_EXPRESSION_CAST_REGISTRY]
      ?.supportsScale
  );
}
