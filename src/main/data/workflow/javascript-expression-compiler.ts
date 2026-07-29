import ts from 'typescript';
import { DataCommandError } from '../data-command-types';
import {
  getWorkflowExpressionFunctionDefinition,
  getWorkflowExpressionTypeScriptDeclarations,
  getWorkflowNativeIntrinsicDefinition,
  isWorkflowDecimalScale,
  isWorkflowExpressionCastType,
  WORKFLOW_DECIMAL_SCALE_MAX,
  WORKFLOW_DECIMAL_SCALE_MIN,
  WORKFLOW_EXPRESSION_CAST_TYPES,
  WORKFLOW_EXPRESSION_FUNCTION_REGISTRY,
  WORKFLOW_NATIVE_EXPRESSION_INTRINSICS,
  workflowExpressionArityDescription,
  workflowExpressionArityIsValid,
} from './workflow-expression-registry';
import type {
  WorkflowExpressionIr,
  WorkflowLiteral,
  WorkflowSourceLocation,
} from './workflow-model';
import { WORKFLOW_OPERATION_TYPES } from './workflow-operation-registry';

const GENERATED_SOURCE_NAME = '/generated-workflow.js';
const GENERATED_DECLARATIONS_NAME = '/workflow-authoring-sdk.d.ts';
const INTERNAL_EXPRESSION_FACTORY = '__workflowExpression';
const RESERVED_WORKFLOW_IDENTIFIERS = new Set([
  INTERNAL_EXPRESSION_FACTORY,
  '__finish',
  '__serializeWorkflowResult',
]);
const RESERVED_NATIVE_EXPRESSION_BINDINGS = new Set([
  'expr',
  'cast',
  ...Object.entries(WORKFLOW_EXPRESSION_FUNCTION_REGISTRY)
    .filter(([, definition]) => definition.native)
    .map(([name]) => name),
  ...Object.keys(WORKFLOW_NATIVE_EXPRESSION_INTRINSICS),
]);

const MINIMAL_TYPESCRIPT_STANDARD_LIBRARY = `
interface Object {}
interface Function {}
interface CallableFunction extends Function {}
interface NewableFunction extends Function {}
interface IArguments { readonly length: number; readonly [index: number]: unknown }
interface String { readonly length: number; replace(searchValue: string, replaceValue: string): string }
interface Number {}
interface Boolean {}
interface RegExp {}
interface Array<T> { readonly length: number; [index: number]: T }
interface ReadonlyArray<T> { readonly length: number; readonly [index: number]: T }
interface Date { valueOf(): number }
interface Promise<T> {}
type Readonly<T> = { readonly [P in keyof T]: T[P] };
type Record<K extends keyof any, T> = { [P in K]: T };
`;

export interface PrepareWorkflowJavaScriptInput {
  source: string;
  columns?: Array<{ name: string; type?: string }>;
}

export interface PreparedWorkflowJavaScript {
  executableSource: string;
  expressions: readonly PreparedWorkflowExpression[];
  usesNativeExpressions: boolean;
}

export interface PreparedWorkflowExpression {
  readonly id: string;
  readonly ir: WorkflowExpressionIr;
  readonly source: WorkflowSourceLocation;
}

interface SourceReplacement {
  start: number;
  end: number;
  text: string;
}

export function prepareWorkflowJavaScript(
  input: PrepareWorkflowJavaScriptInput
): PreparedWorkflowJavaScript {
  const sourceFile = ts.createSourceFile(
    GENERATED_SOURCE_NAME,
    input.source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS
  );
  assertInternalExpressionFactoryIsNotReferenced(sourceFile);
  assertNativeExpressionIdentifierIsNotShadowed(sourceFile);
  const expressionCalls = collectNativeExpressionCalls(sourceFile);
  if (input.columns) {
    assertWorkflowJavaScriptTypes(input.source, input.columns, sourceFile);
  }
  if (expressionCalls.length === 0) {
    return {
      executableSource: input.source,
      expressions: Object.freeze([]),
      usesNativeExpressions: false,
    };
  }

  const expressions: PreparedWorkflowExpression[] = [];
  const replacements = expressionCalls.map((call, index): SourceReplacement => {
    const callback = call.arguments[0];
    if (!callback || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))) {
      throw expressionDiagnostic(
        sourceFile,
        call,
        'NATIVE_EXPRESSION_CALLBACK_REQUIRED',
        'expr(...) requires exactly one arrow function or function expression'
      );
    }
    if (call.arguments.length !== 1 || callback.parameters.length !== 1) {
      throw expressionDiagnostic(
        sourceFile,
        call,
        'NATIVE_EXPRESSION_CALLBACK_REQUIRED',
        'expr(...) requires exactly one callback with one row parameter'
      );
    }
    if (
      callback.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ||
      (ts.isFunctionExpression(callback) && callback.asteriskToken)
    ) {
      throw expressionDiagnostic(
        sourceFile,
        callback,
        'NATIVE_EXPRESSION_CALLBACK_UNSUPPORTED',
        'The expr(...) callback must be synchronous and non-generator'
      );
    }
    const rowParameter = callback.parameters[0]?.name;
    if (!rowParameter || !ts.isIdentifier(rowParameter)) {
      throw expressionDiagnostic(
        sourceFile,
        callback,
        'NATIVE_EXPRESSION_ROW_PARAMETER_REQUIRED',
        'The expr(...) callback row parameter must be an identifier'
      );
    }
    const body = extractExpressionBody(callback, sourceFile);
    const ir = lowerNativeExpression(body, rowParameter.text, sourceFile);
    const start = call.getStart(sourceFile);
    const location = sourceFile.getLineAndCharacterOfPosition(start);
    const id = `expr_${index + 1}`;
    expressions.push(
      deepFreeze({
        id,
        ir,
        source: {
          functionName: findContainingFunctionName(sourceFile, start) ?? 'main',
          start,
          end: call.getEnd(),
          line: location.line + 1,
          column: location.character + 1,
        },
      })
    );
    const original = input.source.slice(call.getStart(sourceFile), call.getEnd());
    return {
      start: call.getStart(sourceFile),
      end: call.getEnd(),
      text: `${INTERNAL_EXPRESSION_FACTORY}(${JSON.stringify(id)})${newlinePadding(original)}`,
    };
  });

  let prepared = input.source;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    prepared =
      prepared.slice(0, replacement.start) + replacement.text + prepared.slice(replacement.end);
  }
  return {
    executableSource: prepared,
    expressions: Object.freeze(expressions),
    usesNativeExpressions: true,
  };
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function collectNativeExpressionCalls(sourceFile: ts.SourceFile): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'expr'
    ) {
      calls.push(node);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls;
}

function assertNativeExpressionIdentifierIsNotShadowed(sourceFile: ts.SourceFile): void {
  const assertBinding = (name: ts.BindingName | ts.Identifier | undefined) => {
    if (!name) return;
    if (ts.isIdentifier(name)) {
      if (RESERVED_NATIVE_EXPRESSION_BINDINGS.has(name.text)) {
        throw expressionDiagnostic(
          sourceFile,
          name,
          'WORKFLOW_SDK_IDENTIFIER_SHADOWED',
          `The workflow expression SDK identifier ${name.text} must not be redeclared or used as a parameter`
        );
      }
      return;
    }
    for (const element of name.elements) {
      if (!ts.isOmittedExpression(element)) assertBinding(element.name);
    }
  };
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) assertBinding(node.name);
    else if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isClassDeclaration(node) ||
      ts.isClassExpression(node)
    ) {
      assertBinding(node.name);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function assertInternalExpressionFactoryIsNotReferenced(sourceFile: ts.SourceFile): void {
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && RESERVED_WORKFLOW_IDENTIFIERS.has(node.text)) {
      throw expressionDiagnostic(
        sourceFile,
        node,
        'RESERVED_WORKFLOW_IDENTIFIER',
        `${node.text} is reserved for the workflow compiler`
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function extractExpressionBody(
  callback: ts.ArrowFunction | ts.FunctionExpression,
  sourceFile: ts.SourceFile
): ts.Expression {
  if (!ts.isBlock(callback.body)) return callback.body;
  if (
    callback.body.statements.length === 1 &&
    ts.isReturnStatement(callback.body.statements[0]) &&
    callback.body.statements[0].expression
  ) {
    return callback.body.statements[0].expression;
  }
  throw expressionDiagnostic(
    sourceFile,
    callback.body,
    'NATIVE_EXPRESSION_BODY_UNSUPPORTED',
    'An expr(...) callback must be a single expression or a block containing one return statement'
  );
}

function lowerNativeExpression(
  node: ts.Expression,
  rowParameter: string,
  sourceFile: ts.SourceFile
): WorkflowExpressionIr {
  node = unwrapExpression(node);
  const column = readRowColumn(node, rowParameter);
  if (column !== null) return { kind: 'column', name: column };
  const literal = readLiteral(node);
  if (literal.found) return { kind: 'literal', value: literal.value };

  if (ts.isBinaryExpression(node)) {
    const nullCheck = lowerNullComparison(node, rowParameter, sourceFile);
    if (nullCheck) return nullCheck;
    if (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
      return {
        kind: 'function',
        name: 'coalesce',
        args: [
          lowerNativeExpression(node.left, rowParameter, sourceFile),
          lowerNativeExpression(node.right, rowParameter, sourceFile),
        ],
      };
    }
    const operator = nativeBinaryOperator(node.operatorToken.kind);
    if (!operator) {
      throw unsupportedExpression(
        sourceFile,
        node,
        `binary operator ${node.operatorToken.getText()}`
      );
    }
    return {
      kind: 'binary',
      op: operator,
      left: lowerNativeExpression(node.left, rowParameter, sourceFile),
      right: lowerNativeExpression(node.right, rowParameter, sourceFile),
    };
  }

  if (ts.isConditionalExpression(node)) {
    return {
      kind: 'function',
      name: 'ifElse',
      args: [
        lowerNativeExpression(node.condition, rowParameter, sourceFile),
        lowerNativeExpression(node.whenTrue, rowParameter, sourceFile),
        lowerNativeExpression(node.whenFalse, rowParameter, sourceFile),
      ],
    };
  }

  if (ts.isPrefixUnaryExpression(node)) {
    if (node.operator === ts.SyntaxKind.ExclamationToken) {
      return {
        kind: 'unary',
        op: 'not',
        value: lowerNativeExpression(node.operand, rowParameter, sourceFile),
      };
    }
    if (node.operator === ts.SyntaxKind.MinusToken) {
      return {
        kind: 'binary',
        op: '-',
        left: { kind: 'literal', value: 0 },
        right: lowerNativeExpression(node.operand, rowParameter, sourceFile),
      };
    }
  }

  if (ts.isCallExpression(node)) {
    return lowerNativeCall(node, rowParameter, sourceFile);
  }

  throw unsupportedExpression(sourceFile, node, node.getText(sourceFile));
}

function lowerNativeCall(
  node: ts.CallExpression,
  rowParameter: string,
  sourceFile: ts.SourceFile
): WorkflowExpressionIr {
  const name = readNativeFunctionName(node.expression);
  if (!name) throw unsupportedExpression(sourceFile, node, 'dynamic function call');
  if (name === 'cast') {
    if (node.arguments.length < 2 || node.arguments.length > 3) {
      throw expressionDiagnostic(
        sourceFile,
        node,
        'NATIVE_CAST_ARGUMENTS_INVALID',
        'cast(value, targetType, options?) requires two or three arguments'
      );
    }
    const requestedTargetType = readStringLiteral(node.arguments[1]);
    if (!requestedTargetType) {
      throw expressionDiagnostic(
        sourceFile,
        node.arguments[1],
        'NATIVE_CAST_TYPE_LITERAL_REQUIRED',
        'cast targetType must be a string literal'
      );
    }
    if (!isWorkflowExpressionCastType(requestedTargetType)) {
      throw expressionDiagnostic(
        sourceFile,
        node.arguments[1],
        'NATIVE_CAST_TYPE_UNSUPPORTED',
        `cast targetType must be one of ${WORKFLOW_EXPRESSION_CAST_TYPES.join(', ')}`
      );
    }
    const targetType = requestedTargetType;
    const options = readCastOptions(node.arguments[2], sourceFile);
    if (options.scale !== undefined && targetType !== 'decimal') {
      throw expressionDiagnostic(
        sourceFile,
        node.arguments[2],
        'NATIVE_CAST_SCALE_UNSUPPORTED',
        'cast scale is only supported for decimal values'
      );
    }
    return {
      kind: 'cast',
      value: lowerNativeExpression(node.arguments[0], rowParameter, sourceFile),
      targetType,
      options,
    };
  }
  const intrinsic = getWorkflowNativeIntrinsicDefinition(name);
  if (intrinsic) {
    assertNativeCallArity(name, intrinsic, node, sourceFile);
    return {
      kind: 'binary',
      op: intrinsic.binaryOperator,
      left: lowerNativeExpression(node.arguments[0], rowParameter, sourceFile),
      right: lowerNativeExpression(node.arguments[1], rowParameter, sourceFile),
    };
  }
  const definition = getWorkflowExpressionFunctionDefinition(name);
  if (!definition?.native) throw unsupportedExpression(sourceFile, node, `function ${name}`);
  assertNativeCallArity(name, definition, node, sourceFile);
  return {
    kind: 'function',
    name,
    args: node.arguments.map((argument) =>
      lowerNativeExpression(argument, rowParameter, sourceFile)
    ),
  };
}

function assertNativeCallArity(
  name: string,
  definition: { minArgs: number; maxArgs?: number },
  node: ts.CallExpression,
  sourceFile: ts.SourceFile
): void {
  if (workflowExpressionArityIsValid(definition, node.arguments.length)) return;
  throw expressionDiagnostic(
    sourceFile,
    node,
    'NATIVE_FUNCTION_ARGUMENTS_INVALID',
    `${name}(...) requires ${workflowExpressionArityDescription(definition)} argument(s)`
  );
}

function readNativeFunctionName(expression: ts.LeftHandSideExpression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  return null;
}

function lowerNullComparison(
  node: ts.BinaryExpression,
  rowParameter: string,
  sourceFile: ts.SourceFile
): WorkflowExpressionIr | null {
  const equality = new Set([
    ts.SyntaxKind.EqualsEqualsToken,
    ts.SyntaxKind.EqualsEqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsToken,
    ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ]);
  if (!equality.has(node.operatorToken.kind)) return null;
  const leftNull = node.left.kind === ts.SyntaxKind.NullKeyword;
  const rightNull = node.right.kind === ts.SyntaxKind.NullKeyword;
  if (leftNull === rightNull) return null;
  const value = lowerNativeExpression(leftNull ? node.right : node.left, rowParameter, sourceFile);
  const notNull =
    node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken ||
    node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken;
  return { kind: 'unary', op: notNull ? 'is_not_null' : 'is_null', value };
}

function nativeBinaryOperator(kind: ts.SyntaxKind): string | null {
  switch (kind) {
    case ts.SyntaxKind.PlusToken:
      return '+';
    case ts.SyntaxKind.MinusToken:
      return '-';
    case ts.SyntaxKind.AsteriskToken:
      return '*';
    case ts.SyntaxKind.SlashToken:
      return '/';
    case ts.SyntaxKind.EqualsEqualsToken:
    case ts.SyntaxKind.EqualsEqualsEqualsToken:
      return '=';
    case ts.SyntaxKind.ExclamationEqualsToken:
    case ts.SyntaxKind.ExclamationEqualsEqualsToken:
      return '<>';
    case ts.SyntaxKind.GreaterThanToken:
      return '>';
    case ts.SyntaxKind.GreaterThanEqualsToken:
      return '>=';
    case ts.SyntaxKind.LessThanToken:
      return '<';
    case ts.SyntaxKind.LessThanEqualsToken:
      return '<=';
    case ts.SyntaxKind.AmpersandAmpersandToken:
      return 'and';
    case ts.SyntaxKind.BarBarToken:
      return 'or';
    default:
      return null;
  }
}

function readRowColumn(node: ts.Expression, rowParameter: string): string | null {
  if (
    ts.isElementAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === rowParameter
  ) {
    return readStringLiteral(node.argumentExpression);
  }
  if (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === rowParameter
  ) {
    return node.name.text;
  }
  return null;
}

function readLiteral(node: ts.Expression): { found: boolean; value: WorkflowLiteral } {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { found: true, value: node.text };
  }
  if (ts.isNumericLiteral(node)) return { found: true, value: Number(node.text) };
  if (node.kind === ts.SyntaxKind.TrueKeyword) return { found: true, value: true };
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { found: true, value: false };
  if (node.kind === ts.SyntaxKind.NullKeyword) return { found: true, value: null };
  return { found: false, value: null };
}

function readStringLiteral(node: ts.Expression | undefined): string | null {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : null;
}

function readCastOptions(
  node: ts.Expression | undefined,
  sourceFile: ts.SourceFile
): { scale?: number } {
  if (!node) return {};
  if (ts.isNumericLiteral(node)) {
    assertNativeDecimalScale(Number(node.text), node, sourceFile);
    return { scale: Number(node.text) };
  }
  if (!ts.isObjectLiteralExpression(node)) {
    throw expressionDiagnostic(
      sourceFile,
      node,
      'NATIVE_CAST_OPTIONS_INVALID',
      'cast options must be an object literal or numeric scale'
    );
  }
  const scaleProperty = node.properties.find(
    (property) =>
      ts.isPropertyAssignment(property) &&
      ((ts.isIdentifier(property.name) && property.name.text === 'scale') ||
        (ts.isStringLiteral(property.name) && property.name.text === 'scale'))
  );
  if (!scaleProperty || !ts.isPropertyAssignment(scaleProperty)) return {};
  if (!ts.isNumericLiteral(scaleProperty.initializer)) {
    throw expressionDiagnostic(
      sourceFile,
      scaleProperty.initializer,
      'NATIVE_CAST_SCALE_INVALID',
      'cast scale must be a numeric literal'
    );
  }
  const scale = Number(scaleProperty.initializer.text);
  assertNativeDecimalScale(scale, scaleProperty.initializer, sourceFile);
  return { scale };
}

function assertNativeDecimalScale(scale: number, node: ts.Node, sourceFile: ts.SourceFile): void {
  if (isWorkflowDecimalScale(scale)) return;
  throw expressionDiagnostic(
    sourceFile,
    node,
    'NATIVE_CAST_SCALE_OUT_OF_RANGE',
    `cast decimal scale must be an integer from ${WORKFLOW_DECIMAL_SCALE_MIN} to ${WORKFLOW_DECIMAL_SCALE_MAX}`
  );
}

function unwrapExpression(node: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    node = node.expression;
  }
  return node;
}

function newlinePadding(source: string): string {
  const count = (source.match(/\n/g) ?? []).length;
  return count > 0 ? `/*${'\n'.repeat(count)}*/` : '';
}

function assertWorkflowJavaScriptTypes(
  source: string,
  columns: Array<{ name: string; type?: string }>,
  sourceFile: ts.SourceFile
): void {
  const declarations = workflowAuthoringDeclarations(
    columns,
    collectDeclaredWorkflowFields(sourceFile)
  );
  const options: ts.CompilerOptions = {
    allowJs: true,
    checkJs: true,
    noEmit: true,
    noLib: true,
    noImplicitAny: false,
    strictNullChecks: true,
    skipLibCheck: false,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.None,
    types: [],
  };
  const defaultHost = ts.createCompilerHost(options, true);
  const virtualFiles = new Map([
    [GENERATED_SOURCE_NAME, source],
    [GENERATED_DECLARATIONS_NAME, declarations],
  ]);
  const host: ts.CompilerHost = {
    ...defaultHost,
    fileExists: (fileName) => virtualFiles.has(fileName),
    readFile: (fileName) => virtualFiles.get(fileName),
    getSourceFile: (fileName, languageVersion) => {
      const content = virtualFiles.get(fileName);
      return content === undefined
        ? undefined
        : ts.createSourceFile(
            fileName,
            content,
            languageVersion,
            true,
            fileName.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS
          );
    },
    writeFile: () => undefined,
  };
  const program = ts.createProgram(
    [GENERATED_SOURCE_NAME, GENERATED_DECLARATIONS_NAME],
    options,
    host
  );
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .filter((item) => item.category === ts.DiagnosticCategory.Error);
  const diagnostic = diagnostics.find((item) => item.file?.fileName === GENERATED_SOURCE_NAME);
  if (!diagnostic) {
    const environmentDiagnostic = diagnostics[0];
    if (!environmentDiagnostic) return;
    const message = ts.flattenDiagnosticMessageText(environmentDiagnostic.messageText, '\n');
    throw new DataCommandError(
      'RUN_FAILED',
      `Workflow JavaScript type-check environment is invalid: ${message}`,
      {
        diagnostics: [
          {
            severity: 'error',
            code: `JAVASCRIPT_TYPECHECK_ENVIRONMENT_ERROR_${environmentDiagnostic.code}`,
            message,
          },
        ],
      }
    );
  }
  const start = diagnostic.start ?? 0;
  const location = sourceFile.getLineAndCharacterOfPosition(start);
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  throw new DataCommandError('VALIDATION_FAILED', message, {
    diagnostics: [
      {
        severity: 'error',
        code: `JAVASCRIPT_TYPE_ERROR_${diagnostic.code}`,
        message,
        line: location.line + 1,
        column: location.character + 1,
        functionName: findContainingFunctionName(sourceFile, start),
      },
    ],
  });
}

function workflowAuthoringDeclarations(
  columns: Array<{ name: string; type?: string }>,
  declaredFields: string[]
): string {
  const rowTypes = new Map(
    columns.map((column) => [column.name, javascriptColumnType(column.type)] as const)
  );
  for (const field of declaredFields) {
    // Full schema sequencing remains authoritative in IR lowering. Declaring
    // statically named outputs as any prevents false TypeScript errors when a
    // later helper reads a field created by an earlier derive/rename step.
    if (!rowTypes.has(field)) rowTypes.set(field, 'any');
  }
  const rowFields = [...rowTypes]
    .map(([name, type]) => `readonly ${JSON.stringify(name)}: ${type};`)
    .join('\n');
  const operationTypes = [...WORKFLOW_OPERATION_TYPES]
    .map((type) => JSON.stringify(type))
    .sort()
    .join(' | ');
  const otherOperationTypes = [...WORKFLOW_OPERATION_TYPES]
    .filter((type) => type !== 'filter' && type !== 'derive')
    .map((type) => JSON.stringify(type))
    .sort()
    .join(' | ');
  return `${MINIMAL_TYPESCRIPT_STANDARD_LIBRARY}
interface WorkflowInputRow {
${rowFields}
}
declare const workflowNativeExpressionBrand: unique symbol;
interface WorkflowNativeExpression<T = unknown> { readonly [workflowNativeExpressionBrand]: T }
declare function expr<T>(builder: (row: Readonly<WorkflowInputRow>) => T): WorkflowNativeExpression<T>;
${getWorkflowExpressionTypeScriptDeclarations()}
declare function cast(value: unknown, targetType: "integer" | "float" | "decimal", options?: { scale?: number } | number): number;
declare function cast(value: unknown, targetType: "text"): string;
declare function cast(value: unknown, targetType: "boolean"): boolean;
declare function cast(value: unknown, targetType: "date" | "datetime" | "timestamp"): Date;
declare const workflowValueBrand: unique symbol;
interface WorkflowValue { readonly [workflowValueBrand]: true }
type WorkflowOperationType = ${operationTypes};
type WorkflowOtherOperationType = ${otherOperationTypes};
interface WorkflowSdk {
  input(tableId: string, options?: { alias?: string }): WorkflowValue;
  step(input: WorkflowValue, type: "filter", payload: { condition: WorkflowNativeExpression<boolean> }): WorkflowValue;
  step(input: WorkflowValue, type: "derive", payload: { column: string; expression: WorkflowNativeExpression<unknown> }): WorkflowValue;
  step(input: WorkflowValue, type: WorkflowOtherOperationType, payload: Record<string, unknown>): WorkflowValue;
  output(input: WorkflowValue, tableName: string, options?: { mode?: "replace" }): WorkflowValue;
}
declare const workflow: WorkflowSdk;
declare const fn: any;
declare const metric: any;
declare function col(name: string): any;
declare function lit(value: unknown): any;
declare const INPUT_TABLE_ID: string;
declare const OUTPUT_TABLE_NAME: string;
`;
}

function collectDeclaredWorkflowFields(sourceFile: ts.SourceFile): string[] {
  const fields = new Set<string>();
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'workflow' &&
      node.expression.name.text === 'step'
    ) {
      const operationType = readStringLiteral(node.arguments[1]);
      const payload = node.arguments[2];
      if (payload && ts.isObjectLiteralExpression(payload)) {
        const field =
          operationType === 'derive'
            ? readObjectStringProperty(payload, 'column')
            : operationType === 'rename'
              ? readObjectStringProperty(payload, 'target')
              : null;
        if (field) fields.add(field);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...fields];
}

function readObjectStringProperty(node: ts.ObjectLiteralExpression, name: string): string | null {
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const propertyName =
      ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
        ? property.name.text
        : undefined;
    if (propertyName === name) return readStringLiteral(property.initializer);
  }
  return null;
}

function javascriptColumnType(type: string | undefined): string {
  const normalized = String(type ?? '')
    .trim()
    .toLowerCase();
  if (['integer', 'int', 'bigint', 'float', 'double', 'decimal', 'number'].includes(normalized)) {
    return 'number';
  }
  if (normalized === 'boolean' || normalized === 'bool') return 'boolean';
  if (normalized === 'date' || normalized === 'timestamp' || normalized === 'datetime') {
    return 'Date';
  }
  if (['text', 'string', 'varchar'].includes(normalized)) return 'string';
  return 'any';
}

function findContainingFunctionName(
  sourceFile: ts.SourceFile,
  position: number
): string | undefined {
  let result: string | undefined;
  const visit = (node: ts.Node) => {
    if (position < node.getStart(sourceFile) || position > node.getEnd()) return;
    if (ts.isFunctionDeclaration(node) && node.name) result = node.name.text;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}

function unsupportedExpression(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  description: string
): DataCommandError {
  return expressionDiagnostic(
    sourceFile,
    node,
    'UNSUPPORTED_NATIVE_EXPRESSION',
    `Unsupported native workflow expression: ${description}`
  );
}

function expressionDiagnostic(
  sourceFile: ts.SourceFile,
  node: ts.Node | undefined,
  code: string,
  message: string
): DataCommandError {
  const start = node?.getStart(sourceFile) ?? 0;
  const location = sourceFile.getLineAndCharacterOfPosition(start);
  return new DataCommandError('VALIDATION_FAILED', message, {
    diagnostics: [
      {
        severity: 'error',
        code,
        message,
        line: location.line + 1,
        column: location.character + 1,
        functionName: findContainingFunctionName(sourceFile, start),
      },
    ],
  });
}
