import ts from 'typescript';
import { DataCommandError } from '../data-command-types';
import { WORKFLOW_JAVASCRIPT_METHODS } from './javascript-capabilities';
import type {
  WorkflowSourceLocation,
  WorkflowExpressionIr,
  WorkflowDeduplicateConfig,
  WorkflowIr,
  WorkflowLimitConfig,
  WorkflowLiteral,
  WorkflowMissingValueConfig,
  WorkflowMissingValueRule,
  WorkflowMetricIr,
  WorkflowOperationIr,
  WorkflowPivotConfig,
  WorkflowPivotMetricIr,
  WorkflowSortKeyIr,
  WorkflowUnnestConfig,
  WorkflowUnpivotConfig,
} from './workflow-model';

interface FunctionDefinition {
  declaration: ts.FunctionDeclaration;
  name: string;
}

interface WorkflowValue {
  kind: 'workflow';
  ir: WorkflowIr;
}

interface NamespaceValue {
  kind: 'namespace';
  name: 'fn' | 'metric';
}

interface MetricExpressionValue {
  kind: 'metric_expression';
  fn: string;
  expression: WorkflowExpressionIr | '*';
}

type ProgramValue =
  | WorkflowValue
  | NamespaceValue
  | MetricExpressionValue
  | WorkflowExpressionIr
  | WorkflowMetricIr
  | WorkflowLiteral
  | ProgramValue[]
  | ProgramObject;

interface ProgramObject {
  [key: string]: ProgramValue;
}

/** Parses JavaScript as an AST and directly constructs Workflow IR. Generated code is never run. */
export function compileJavascriptWorkflowToIr(code: string): WorkflowIr {
  const sourceFile = createSourceFile(code, 'generated-workflow.js');
  assertNoSyntaxErrors(sourceFile);
  const functions = collectFunctions(sourceFile);
  const main = functions.get('main');
  if (!main) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      'Generated workflow JavaScript program must declare function main()'
    );
  }
  const result = new StaticWorkflowProgramCompiler(sourceFile, functions).callFunction(
    main,
    [],
    []
  );
  if (!result.ir.inputSeen) {
    throw new DataCommandError('VALIDATION_FAILED', 'Generated workflow must call inputDataset');
  }
  if (!result.ir.outputSeen) {
    throw new DataCommandError('VALIDATION_FAILED', 'Generated workflow must call outputTable');
  }
  return result.ir;
}

export function applyJavascriptFunctionPatch(
  code: string,
  functionName: string,
  replacement: string
): string {
  const sourceFile = createSourceFile(code, 'generated-workflow.js');
  assertNoSyntaxErrors(sourceFile);
  const target = collectFunctions(sourceFile).get(functionName);
  if (!target) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Cannot patch unknown workflow function: ${functionName}`
    );
  }
  const replacementFile = createSourceFile(replacement, 'workflow-function-patch.js');
  assertNoSyntaxErrors(replacementFile);
  const replacements = collectFunctions(replacementFile);
  if (replacements.size !== 1 || !replacements.has(functionName)) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Workflow function patch must contain only function ${functionName}`
    );
  }
  const declaration = target.declaration;
  return `${code.slice(0, declaration.getStart(sourceFile))}${replacement.trim()}${code.slice(declaration.getEnd())}`;
}

class StaticWorkflowProgramCompiler {
  constructor(
    private readonly sourceFile: ts.SourceFile,
    private readonly functions: Map<string, FunctionDefinition>
  ) {}

  callFunction(
    definition: FunctionDefinition,
    args: ProgramValue[],
    stack: string[]
  ): WorkflowValue {
    if (stack.includes(definition.name)) {
      this.fail(
        definition.declaration,
        'RECURSIVE_FUNCTION',
        `Recursive workflow function calls are not supported: ${[...stack, definition.name].join(' -> ')}`,
        definition.name
      );
    }
    if (definition.declaration.parameters.length !== args.length) {
      this.fail(
        definition.declaration,
        'INVALID_FUNCTION_ARGUMENTS',
        `Workflow function ${definition.name} expects ${definition.declaration.parameters.length} argument(s), received ${args.length}`,
        definition.name
      );
    }
    const body = definition.declaration.body;
    if (!body) {
      this.fail(
        definition.declaration,
        'MISSING_FUNCTION_BODY',
        `Workflow function ${definition.name} must have a body`,
        definition.name
      );
    }
    const environment = new Map<string, ProgramValue>();
    definition.declaration.parameters.forEach((parameter, index) => {
      if (!ts.isIdentifier(parameter.name)) {
        this.fail(
          parameter,
          'UNSUPPORTED_PARAMETER',
          'Workflow function parameters must be identifiers',
          definition.name
        );
      }
      environment.set(parameter.name.text, args[index] as ProgramValue);
    });
    for (const statement of body.statements) {
      if (ts.isVariableStatement(statement)) {
        if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) {
          this.fail(
            statement,
            'MUTABLE_VARIABLE',
            'Generated workflow JavaScript may only declare const variables',
            definition.name
          );
        }
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
            this.fail(
              declaration,
              'UNSUPPORTED_VARIABLE',
              'Workflow variables require an identifier and initializer',
              definition.name
            );
          }
          environment.set(
            declaration.name.text,
            this.evaluate(declaration.initializer, environment, definition.name, [
              ...stack,
              definition.name,
            ])
          );
        }
        continue;
      }
      if (ts.isReturnStatement(statement) && statement.expression) {
        const returned = this.evaluate(statement.expression, environment, definition.name, [
          ...stack,
          definition.name,
        ]);
        if (isWorkflowValue(returned)) return returned;
        this.fail(
          statement.expression,
          'INVALID_FUNCTION_RETURN',
          `Workflow function ${definition.name} must return a workflow value`,
          definition.name
        );
      }
      this.fail(
        statement,
        'UNSUPPORTED_STATEMENT',
        `Unsupported statement in workflow function ${definition.name}: ${ts.SyntaxKind[statement.kind]}`,
        definition.name
      );
    }
    this.fail(
      body,
      'MISSING_RETURN',
      `Workflow function ${definition.name} must return a workflow value`,
      definition.name
    );
  }

  private evaluate(
    expression: ts.Expression,
    environment: Map<string, ProgramValue>,
    functionName: string,
    stack: string[]
  ): ProgramValue {
    if (ts.isParenthesizedExpression(expression)) {
      return this.evaluate(expression.expression, environment, functionName, stack);
    }
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      return expression.text;
    }
    if (ts.isNumericLiteral(expression)) return Number(expression.text);
    if (expression.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (expression.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (expression.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isIdentifier(expression)) {
      if (environment.has(expression.text)) return environment.get(expression.text) as ProgramValue;
      if (expression.text === 'INPUT_TABLE_ID' || expression.text === 'OUTPUT_TABLE_NAME') {
        return expression.text;
      }
      if (expression.text === 'fn' || expression.text === 'metric') {
        return { kind: 'namespace', name: expression.text };
      }
      this.fail(
        expression,
        'UNKNOWN_IDENTIFIER',
        `Unsupported identifier in workflow function ${functionName}: ${expression.text}`,
        functionName
      );
    }
    if (ts.isArrayLiteralExpression(expression)) {
      return expression.elements.map((element) => {
        if (ts.isSpreadElement(element)) {
          this.fail(element, 'UNSUPPORTED_SPREAD', 'Spread syntax is not supported', functionName);
        }
        return this.evaluate(element, environment, functionName, stack);
      });
    }
    if (ts.isObjectLiteralExpression(expression)) {
      const result: ProgramObject = {};
      for (const property of expression.properties) {
        if (!ts.isPropertyAssignment(property)) {
          this.fail(
            property,
            'UNSUPPORTED_OBJECT_PROPERTY',
            'Workflow objects require explicit property assignments',
            functionName
          );
        }
        const name = propertyName(property.name);
        if (!name) {
          this.fail(
            property.name,
            'UNSUPPORTED_OBJECT_KEY',
            'Workflow object keys must be static',
            functionName
          );
        }
        result[name] = this.evaluate(property.initializer, environment, functionName, stack);
      }
      return result;
    }
    if (ts.isCallExpression(expression)) {
      return this.evaluateCall(expression, environment, functionName, stack);
    }
    this.fail(
      expression,
      'UNSUPPORTED_EXPRESSION',
      `Unsupported JavaScript expression in workflow function ${functionName}: ${ts.SyntaxKind[expression.kind]}`,
      functionName
    );
  }

  private evaluateCall(
    call: ts.CallExpression,
    environment: Map<string, ProgramValue>,
    functionName: string,
    stack: string[]
  ): ProgramValue {
    if (ts.isIdentifier(call.expression)) {
      const name = call.expression.text;
      const args = call.arguments.map((argument) =>
        this.evaluate(argument, environment, functionName, stack)
      );
      if (name === 'workflow') {
        if (args.length !== 0)
          this.fail(
            call,
            'INVALID_WORKFLOW_CALL',
            'workflow() does not accept arguments',
            functionName
          );
        return { kind: 'workflow', ir: { inputSeen: false, outputSeen: false, operations: [] } };
      }
      if (name === 'col') {
        return { kind: 'column', name: this.requireString(args, 0, call, 'col', functionName) };
      }
      if (name === 'lit') {
        return { kind: 'literal', value: this.requireLiteral(args, 0, call, 'lit', functionName) };
      }
      const helper = this.functions.get(name);
      if (!helper || helper.name === 'main') {
        this.fail(
          call.expression,
          'UNSUPPORTED_FUNCTION',
          `Unsupported workflow function call: ${name}`,
          functionName
        );
      }
      return this.callFunction(helper, args, stack);
    }
    if (!ts.isPropertyAccessExpression(call.expression)) {
      this.fail(
        call.expression,
        'DYNAMIC_CALL',
        'Generated workflow JavaScript does not allow dynamic calls',
        functionName
      );
    }
    const member = call.expression.name.text;
    const target = this.evaluate(call.expression.expression, environment, functionName, stack);
    const args = call.arguments.map((argument) =>
      this.evaluate(argument, environment, functionName, stack)
    );
    if (isWorkflowValue(target)) {
      return this.applyWorkflowMethod(target, member, args, call, functionName);
    }
    if (isNamespaceValue(target)) {
      return this.applyNamespaceMethod(target, member, args, call, functionName);
    }
    if (isMetricExpressionValue(target) && member === 'as') {
      return {
        fn: target.fn,
        expression: target.expression,
        alias: this.requireString(args, 0, call, 'metric.as', functionName),
      };
    }
    if (isWorkflowExpression(target)) {
      return this.applyExpressionMethod(target, member, args, call, functionName);
    }
    this.fail(
      call.expression,
      'INVALID_CALL_RECEIVER',
      `Method ${member} is not valid for this workflow value`,
      functionName
    );
  }

  private applyWorkflowMethod(
    workflow: WorkflowValue,
    member: string,
    args: ProgramValue[],
    call: ts.CallExpression,
    functionName: string
  ): WorkflowValue {
    if (!WORKFLOW_JAVASCRIPT_METHODS.has(member)) {
      this.fail(
        call.expression,
        'UNSUPPORTED_WORKFLOW_METHOD',
        `Unsupported workflow method: ${member}`,
        functionName
      );
    }
    const location = this.sourceSpan(call, functionName);
    let operation: WorkflowOperationIr | undefined;
    switch (member) {
      case 'inputDataset':
        workflow.ir.inputSeen = true;
        break;
      case 'outputTable':
        workflow.ir.outputSeen = true;
        break;
      case 'filter':
        operation = {
          type: 'filter',
          condition: this.requireExpression(args[0], call, 'filter', functionName),
          location,
        };
        break;
      case 'sort':
        operation = {
          type: 'sort',
          column: this.requireExpression(args[0], call, 'sort', functionName),
          direction: this.requireSortDirection(args[1], call, functionName),
          location,
        };
        break;
      case 'drop':
      case 'select':
        operation = {
          type: member,
          columns: this.requireStringList(args[0], call, member, functionName),
          location,
        };
        break;
      case 'rename':
        operation = {
          type: 'rename',
          source: this.requireString(args, 0, call, 'rename', functionName),
          target: this.requireString(args, 1, call, 'rename', functionName),
          location,
        };
        break;
      case 'derive':
        operation = {
          type: 'derive',
          column: this.requireString(args, 0, call, 'derive', functionName),
          expression: this.requireExpression(args[1], call, 'derive', functionName),
          location,
        };
        break;
      case 'cast':
        operation = {
          type: 'convert_type',
          column: this.requireString(args, 0, call, 'cast', functionName),
          targetType: this.requireString(args, 1, call, 'cast', functionName),
          options: this.requireObject(args[2], call, 'cast', functionName),
          location,
        };
        break;
      case 'aggregate': {
        const config = this.requireObject(args[0], call, 'aggregate', functionName);
        operation = {
          type: 'aggregate',
          groupBy: this.requireExpressionList(
            config.groupBy,
            call,
            'aggregate.groupBy',
            functionName
          ),
          metrics: this.requireMetricList(config.metrics, call, 'aggregate.metrics', functionName),
          location,
        };
        break;
      }
      case 'deduplicate':
        operation = {
          type: 'deduplicate',
          config: this.parseDeduplicateConfig(args[0], call, functionName),
          location,
        };
        break;
      case 'handleMissing':
        operation = {
          type: 'missing_value',
          config: this.parseMissingValueConfig(args[0], call, functionName),
          location,
        };
        break;
      case 'limit':
        operation = {
          type: 'limit',
          config: this.parseLimitConfig(args, call, functionName),
          location,
        };
        break;
      case 'top':
        operation = {
          type: 'limit',
          config: this.parseTopConfig(args, call, functionName),
          location,
        };
        break;
      case 'pivot':
        operation = {
          type: 'pivot',
          config: this.parsePivotConfig(args[0], call, functionName),
          location,
        };
        break;
      case 'unpivot':
        operation = {
          type: 'unpivot',
          config: this.parseUnpivotConfig(args[0], call, functionName),
          location,
        };
        break;
      case 'unnest':
        operation = {
          type: 'unnest',
          config: this.parseUnnestConfig(args[0], call, functionName),
          location,
        };
        break;
    }
    if (operation) workflow.ir.operations.push(operation);
    return workflow;
  }

  private parseDeduplicateConfig(
    value: ProgramValue | undefined,
    node: ts.Node,
    functionName: string
  ): WorkflowDeduplicateConfig {
    const config = this.requireObject(value, node, 'deduplicate', functionName);
    return {
      columns: this.optionalStringList(
        config.by ?? config.columns,
        node,
        'deduplicate.by',
        functionName
      ),
      keep: config.keep === 'last' ? 'last' : 'first',
      orderBy: this.parseSortKeys(config.orderBy, node, 'deduplicate.orderBy', functionName),
    };
  }

  private parseMissingValueConfig(
    value: ProgramValue | undefined,
    node: ts.Node,
    functionName: string
  ): WorkflowMissingValueConfig {
    const config = this.requireObject(value, node, 'handleMissing', functionName);
    if (config.strategy === 'drop_empty_rows') return { strategy: 'drop_empty_rows' };
    if (!Array.isArray(config.rules) || config.rules.length === 0) {
      this.fail(
        node,
        'MISSING_VALUE_RULES_REQUIRED',
        'handleMissing requires non-empty rules',
        functionName
      );
    }
    const rules = config.rules.map((item): WorkflowMissingValueRule => {
      const rule = this.requireObject(item, node, 'handleMissing.rules', functionName);
      const column = typeof rule.column === 'string' ? rule.column : '';
      const method = rule.method;
      if (!column || !['skip', 'drop', 'nullify_values', 'literal_fill'].includes(String(method))) {
        this.fail(node, 'INVALID_MISSING_VALUE_RULE', 'Invalid handleMissing rule', functionName);
      }
      return {
        column,
        method: method as WorkflowMissingValueRule['method'],
        value: isWorkflowLiteral(rule.value) ? rule.value : undefined,
        values: Array.isArray(rule.values) ? rule.values.filter(isWorkflowLiteral) : undefined,
      };
    });
    return { strategy: 'by_column', rules };
  }

  private parseLimitConfig(
    args: ProgramValue[],
    node: ts.Node,
    functionName: string
  ): WorkflowLimitConfig {
    if (typeof args[0] === 'number') {
      return { mode: 'limit', limit: args[0], unit: 'rows', offset: 0, orderBy: [] };
    }
    const config = this.requireObject(args[0], node, 'limit', functionName);
    return {
      mode: config.mode === 'top' ? 'top' : 'limit',
      limit: typeof config.count === 'number' ? config.count : Number(config.limit ?? 0),
      unit: config.unit === 'percent' ? 'percent' : 'rows',
      offset: typeof config.offset === 'number' ? config.offset : 0,
      orderBy: this.parseSortKeys(config.orderBy, node, 'limit.orderBy', functionName),
    };
  }

  private parseTopConfig(
    args: ProgramValue[],
    node: ts.Node,
    functionName: string
  ): WorkflowLimitConfig {
    return {
      mode: 'top',
      limit: typeof args[0] === 'number' ? args[0] : 0,
      unit: 'rows',
      offset: 0,
      orderBy: this.parseSortKeys(args[1], node, 'top.orderBy', functionName),
    };
  }

  private parsePivotConfig(
    value: ProgramValue | undefined,
    node: ts.Node,
    functionName: string
  ): WorkflowPivotConfig {
    const config = this.requireObject(value, node, 'pivot', functionName);
    const using = Array.isArray(config.using)
      ? config.using.map((item): WorkflowPivotMetricIr => {
          const metric = this.requireObject(item, node, 'pivot.using', functionName);
          return {
            function: typeof metric.function === 'string' ? metric.function : '',
            expression:
              metric.expression === '*'
                ? '*'
                : this.requireExpression(
                    metric.expression,
                    node,
                    'pivot.using.expression',
                    functionName
                  ),
            alias: typeof metric.alias === 'string' ? metric.alias : '',
          };
        })
      : [];
    return {
      on: this.optionalStringList(config.on, node, 'pivot.on', functionName),
      values: Array.isArray(config.values) ? config.values.filter(isWorkflowLiteral) : [],
      using,
      groupBy: this.optionalStringList(config.groupBy, node, 'pivot.groupBy', functionName),
    };
  }

  private parseUnpivotConfig(
    value: ProgramValue | undefined,
    node: ts.Node,
    functionName: string
  ): WorkflowUnpivotConfig {
    const config = this.requireObject(value, node, 'unpivot', functionName);
    const except = this.optionalStringList(config.except, node, 'unpivot.except', functionName);
    return {
      mode: except.length > 0 ? 'except' : 'columns',
      columns:
        except.length > 0
          ? except
          : this.optionalStringList(config.columns, node, 'unpivot.columns', functionName),
      nameColumn: typeof config.nameColumn === 'string' ? config.nameColumn : 'name',
      valueColumn: typeof config.valueColumn === 'string' ? config.valueColumn : 'value',
      includeNulls: config.includeNulls === true,
    };
  }

  private parseUnnestConfig(
    value: ProgramValue | undefined,
    node: ts.Node,
    functionName: string
  ): WorkflowUnnestConfig {
    const config = this.requireObject(value, node, 'unnest', functionName);
    return {
      sourceKind: config.sourceKind === 'json' ? 'json' : 'list',
      column: typeof config.column === 'string' ? config.column : '',
      alias: typeof config.alias === 'string' ? config.alias : '',
      path: typeof config.path === 'string' ? config.path : undefined,
      withIndex: typeof config.withIndex === 'string' ? config.withIndex : undefined,
      recursive: config.recursive === true,
      maxDepth: typeof config.maxDepth === 'number' ? config.maxDepth : undefined,
      keepParentNames: config.keepParentNames === true,
    };
  }

  private parseSortKeys(
    value: ProgramValue | undefined,
    node: ts.Node,
    context: string,
    functionName: string
  ): WorkflowSortKeyIr[] {
    if (value === undefined) return [];
    if (!Array.isArray(value))
      this.fail(node, 'EXPECTED_SORT_KEYS', `${context} requires an array`, functionName);
    return value.map((item) => {
      const key = this.requireObject(item, node, context, functionName);
      if (typeof key.field !== 'string')
        this.fail(node, 'INVALID_SORT_KEY', `${context} requires field`, functionName);
      return {
        field: key.field,
        direction: key.direction === 'desc' ? 'desc' : 'asc',
        nulls: key.nulls === 'first' || key.nulls === 'last' ? key.nulls : undefined,
      };
    });
  }

  private optionalStringList(
    value: ProgramValue | undefined,
    node: ts.Node,
    context: string,
    functionName: string
  ): string[] {
    if (value === undefined) return [];
    return this.requireStringList(value, node, context, functionName);
  }

  private applyNamespaceMethod(
    namespace: NamespaceValue,
    member: string,
    args: ProgramValue[],
    call: ts.CallExpression,
    functionName: string
  ): ProgramValue {
    if (namespace.name === 'fn') {
      return {
        kind: 'function',
        name: member,
        args: args.map((arg) => this.expressionOrLiteral(arg, call, `fn.${member}`, functionName)),
      };
    }
    if (!['sum', 'avg', 'min', 'max', 'count', 'countDistinct'].includes(member)) {
      this.fail(call, 'UNSUPPORTED_METRIC', `Unsupported metric function: ${member}`, functionName);
    }
    return {
      kind: 'metric_expression',
      fn: member === 'countDistinct' ? 'count_distinct' : member,
      expression:
        member === 'count' && args.length === 0
          ? '*'
          : this.requireExpression(args[0], call, `metric.${member}`, functionName),
    };
  }

  private applyExpressionMethod(
    target: WorkflowExpressionIr,
    member: string,
    args: ProgramValue[],
    call: ts.CallExpression,
    functionName: string
  ): WorkflowExpressionIr {
    const binaryOperators: Record<string, string> = {
      eq: '=',
      neq: '<>',
      gt: '>',
      gte: '>=',
      lt: '<',
      lte: '<=',
      add: '+',
      sub: '-',
      mul: '*',
      div: '/',
      contains: 'contains',
      notContains: 'not_contains',
    };
    if (member === 'isNull' || member === 'isNotNull') {
      return { kind: 'unary', op: member === 'isNull' ? 'is_null' : 'is_not_null', value: target };
    }
    const op = binaryOperators[member];
    if (!op) {
      this.fail(
        call,
        'UNSUPPORTED_EXPRESSION_METHOD',
        `Unsupported expression method: ${member}`,
        functionName
      );
    }
    return {
      kind: 'binary',
      op,
      left: target,
      right: this.expressionOrLiteral(args[0], call, member, functionName),
    };
  }

  private expressionOrLiteral(
    value: ProgramValue | undefined,
    node: ts.Node,
    context: string,
    functionName: string
  ): WorkflowExpressionIr {
    if (isWorkflowLiteral(value)) return { kind: 'literal', value };
    return this.requireExpression(value, node, context, functionName);
  }

  private requireExpression(
    value: ProgramValue | undefined,
    node: ts.Node,
    context: string,
    functionName: string
  ): WorkflowExpressionIr {
    if (isWorkflowExpression(value)) return value;
    this.fail(
      node,
      'EXPECTED_EXPRESSION',
      `${context} requires a workflow expression`,
      functionName
    );
  }

  private requireString(
    args: ProgramValue[],
    index: number,
    node: ts.Node,
    context: string,
    functionName: string
  ): string {
    const value = args[index];
    if (typeof value === 'string') return value;
    this.fail(
      node,
      'EXPECTED_STRING',
      `${context} argument ${index + 1} must be a string`,
      functionName
    );
  }

  private requireLiteral(
    args: ProgramValue[],
    index: number,
    node: ts.Node,
    context: string,
    functionName: string
  ): WorkflowLiteral {
    const value = args[index];
    if (isWorkflowLiteral(value)) return value;
    this.fail(
      node,
      'EXPECTED_LITERAL',
      `${context} argument ${index + 1} must be a literal`,
      functionName
    );
  }

  private requireStringList(
    value: ProgramValue | undefined,
    node: ts.Node,
    context: string,
    functionName: string
  ): string[] {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value;
    this.fail(
      node,
      'EXPECTED_STRING_LIST',
      `${context} requires a string or string array`,
      functionName
    );
  }

  private requireObject(
    value: ProgramValue | undefined,
    node: ts.Node,
    context: string,
    functionName: string
  ): ProgramObject {
    if (value === undefined) return {};
    if (isProgramObject(value)) return value;
    this.fail(node, 'EXPECTED_OBJECT', `${context} requires a configuration object`, functionName);
  }

  private requireExpressionList(
    value: ProgramValue | undefined,
    node: ts.Node,
    context: string,
    functionName: string
  ): WorkflowExpressionIr[] {
    if (value === undefined) return [];
    if (Array.isArray(value)) {
      return value.map((item) => this.requireExpression(item, node, context, functionName));
    }
    this.fail(
      node,
      'EXPECTED_EXPRESSION_LIST',
      `${context} requires an expression array`,
      functionName
    );
  }

  private requireMetricList(
    value: ProgramValue | undefined,
    node: ts.Node,
    context: string,
    functionName: string
  ): WorkflowMetricIr[] {
    if (value === undefined) return [];
    if (Array.isArray(value) && value.every(isMetricIr)) return value;
    this.fail(
      node,
      'EXPECTED_METRIC_LIST',
      `${context} requires metric.*(...).as("alias")`,
      functionName
    );
  }

  private requireSortDirection(
    value: ProgramValue | undefined,
    node: ts.Node,
    functionName: string
  ): 'asc' | 'desc' {
    if (typeof value === 'string') {
      const normalized = value.toLowerCase();
      if (normalized === 'asc' || normalized === 'ascending') return 'asc';
      if (normalized === 'desc' || normalized === 'descending') return 'desc';
    }
    this.fail(
      node,
      'INVALID_SORT_DIRECTION',
      'sort direction must be "asc" or "desc"',
      functionName
    );
  }

  private sourceSpan(node: ts.Node, functionName: string): WorkflowSourceLocation {
    const start = node.getStart(this.sourceFile);
    const position = this.sourceFile.getLineAndCharacterOfPosition(start);
    return {
      functionName,
      start,
      end: node.getEnd(),
      line: position.line + 1,
      column: position.character + 1,
    };
  }

  private fail(node: ts.Node, code: string, message: string, functionName: string): never {
    const location = this.sourceSpan(node, functionName);
    throw new DataCommandError('VALIDATION_FAILED', message, {
      diagnostics: [{ severity: 'error', code, message, ...location }],
    });
  }
}

function createSourceFile(code: string, name: string): ts.SourceFile {
  return ts.createSourceFile(name, code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
}

function assertNoSyntaxErrors(sourceFile: ts.SourceFile): void {
  const diagnostics = (
    sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  if (!diagnostics?.length) return;
  const diagnostic = diagnostics[0];
  const start = diagnostic.start ?? 0;
  const position = sourceFile.getLineAndCharacterOfPosition(start);
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  throw new DataCommandError('VALIDATION_FAILED', message, {
    diagnostics: [
      {
        severity: 'error',
        code: 'JAVASCRIPT_SYNTAX_ERROR',
        message,
        line: position.line + 1,
        column: position.character + 1,
        start,
        end: start + (diagnostic.length ?? 0),
      },
    ],
  });
}

function collectFunctions(sourceFile: ts.SourceFile): Map<string, FunctionDefinition> {
  const functions = new Map<string, FunctionDefinition>();
  for (const statement of sourceFile.statements) {
    if (!ts.isFunctionDeclaration(statement) || !statement.name) {
      const start = statement.getStart(sourceFile);
      const position = sourceFile.getLineAndCharacterOfPosition(start);
      const message = 'Generated workflow JavaScript may only contain named function declarations';
      throw new DataCommandError('VALIDATION_FAILED', message, {
        diagnostics: [
          {
            severity: 'error',
            code: 'UNSUPPORTED_TOP_LEVEL_STATEMENT',
            message,
            line: position.line + 1,
            column: position.character + 1,
          },
        ],
      });
    }
    const name = statement.name.text;
    if (functions.has(name)) {
      throw new DataCommandError('VALIDATION_FAILED', `Duplicate workflow function: ${name}`);
    }
    functions.set(name, { declaration: statement, name });
  }
  return functions;
}

function propertyName(name: ts.PropertyName): string | null {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
    ? name.text
    : null;
}

function isWorkflowValue(value: ProgramValue): value is WorkflowValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'kind' in value &&
    value.kind === 'workflow'
  );
}

function isNamespaceValue(value: ProgramValue): value is NamespaceValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'kind' in value &&
    value.kind === 'namespace'
  );
}

function isMetricExpressionValue(value: ProgramValue): value is MetricExpressionValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'kind' in value &&
    value.kind === 'metric_expression'
  );
}

function isWorkflowExpression(value: ProgramValue | undefined): value is WorkflowExpressionIr {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'kind' in value &&
    ['column', 'literal', 'binary', 'unary', 'function'].includes(String(value.kind))
  );
}

function isWorkflowLiteral(value: ProgramValue | undefined): value is WorkflowLiteral {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function isMetricIr(value: ProgramValue): value is WorkflowMetricIr {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'fn' in value &&
    'alias' in value &&
    typeof value.fn === 'string' &&
    typeof value.alias === 'string' &&
    'expression' in value
  );
}

function isProgramObject(value: ProgramValue): value is ProgramObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !('kind' in value) &&
    !('fn' in value)
  );
}
