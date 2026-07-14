import { DataCommandError } from '../data-command-types';
import { extractJsonObject, formatDslField, isRecord, literalToDsl } from './utils';

type WorkflowJsLiteral = string | number | boolean | null;

type WorkflowJsExpressionIr =
  | { kind: 'column'; name: string }
  | { kind: 'literal'; value: WorkflowJsLiteral }
  | { kind: 'binary'; op: string; left: WorkflowJsExpressionIr; right: WorkflowJsExpressionIr }
  | { kind: 'unary'; op: 'is_null' | 'is_not_null'; value: WorkflowJsExpressionIr }
  | { kind: 'function'; name: string; args: WorkflowJsExpressionIr[] }
  | { kind: 'workflow' }
  | { kind: 'namespace'; name: 'fn' | 'metric' }
  | { kind: 'metric'; fn: string; expression: WorkflowJsExpressionIr | '*' };

interface WorkflowJsMetricIr {
  fn: string;
  expression: WorkflowJsExpressionIr | '*';
  alias: string;
}

type WorkflowJsOperationIr =
  | { type: 'filter'; condition: WorkflowJsExpressionIr }
  | { type: 'sort'; column: WorkflowJsExpressionIr; direction: 'asc' | 'desc' }
  | { type: 'drop'; columns: string[] }
  | { type: 'select'; columns: string[] }
  | { type: 'rename'; source: string; target: string }
  | { type: 'derive'; column: string; expression: WorkflowJsExpressionIr }
  | {
      type: 'convert_type';
      column: string;
      targetType: string;
      options: Record<string, unknown>;
    }
  | { type: 'aggregate'; groupBy: WorkflowJsExpressionIr[]; metrics: WorkflowJsMetricIr[] };

export interface WorkflowJsIr {
  inputSeen: boolean;
  outputSeen: boolean;
  operations: WorkflowJsOperationIr[];
}

type WorkflowJsValue =
  | WorkflowJsExpressionIr
  | WorkflowJsIr
  | WorkflowJsMetricIr
  | WorkflowJsLiteral
  | WorkflowJsValueArray
  | WorkflowJsObject;

interface WorkflowJsValueArray extends Array<WorkflowJsValue> {}

interface WorkflowJsObject {
  [key: string]: WorkflowJsValue;
}

interface WorkflowJsToken {
  type: 'identifier' | 'string' | 'number' | 'punct' | 'boolean' | 'null';
  value: string;
}

export function extractGeneratedWorkflowJavascript(text: string): string {
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(extractJsonObject(trimmed)) as unknown;
    if (isRecord(parsed) && typeof parsed.workflowJs === 'string' && parsed.workflowJs.trim()) {
      return parsed.workflowJs.trim();
    }
  } catch {
    // Fall through to code-fence/raw extraction.
  }
  const fenced = trimmed.match(/```(?:javascript|js)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const workflowIndex = candidate.indexOf('workflow()');
  if (workflowIndex >= 0)
    return candidate
      .slice(workflowIndex)
      .trim()
      .replace(/;+\s*$/g, '');
  throw new DataCommandError(
    'VALIDATION_FAILED',
    'Workflow JS generation response must include workflowJs or a workflow() API chain'
  );
}

export function compileWorkflowJavascriptToIr(code: string): WorkflowJsIr {
  if (
    /\b(import|export|require|eval|Function|fetch|await|async|while|for|class|new)\b/.test(code)
  ) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      'Generated workflow JS uses unsupported JavaScript syntax. Use only the restricted workflow API chain.'
    );
  }
  const parser = new WorkflowJsParser(tokenizeWorkflowJavascript(code));
  const value = parser.parseExpression();
  parser.expectEnd();
  if (!isWorkflowJsIr(value)) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      'Generated workflow JS must compile to a workflow() API chain'
    );
  }
  if (!value.inputSeen) {
    throw new DataCommandError('VALIDATION_FAILED', 'Generated workflow JS must call inputDataset');
  }
  if (!value.outputSeen) {
    throw new DataCommandError('VALIDATION_FAILED', 'Generated workflow JS must call outputTable');
  }
  return value;
}

export function workflowJsIrToGeneratedOperations(ir: WorkflowJsIr): Record<string, unknown>[] {
  return ir.operations.map((operation) => {
    switch (operation.type) {
      case 'filter':
        return workflowFilterIrToOperation(operation.condition);
      case 'sort':
        return {
          type: 'sort',
          column: requireWorkflowJsColumnName(operation.column, 'sort.column'),
          direction: operation.direction,
        };
      case 'drop':
        return { type: 'drop', columns: operation.columns };
      case 'select':
        return { type: 'select', columns: operation.columns };
      case 'rename':
        return { type: 'rename', source: operation.source, target: operation.target };
      case 'derive':
        return {
          type: 'derive',
          column: operation.column,
          expression: workflowExpressionIrToDsl(operation.expression),
        };
      case 'convert_type':
        return {
          type: 'convert_type',
          column: operation.column,
          targetType: operation.targetType,
          ...operation.options,
        };
      case 'aggregate':
        return {
          type: 'aggregate',
          groupBy: operation.groupBy.map((column) =>
            requireWorkflowJsColumnName(column, 'aggregate.groupBy')
          ),
          metrics: operation.metrics.map((metric) => ({
            function: metric.fn,
            column:
              metric.expression === '*'
                ? '*'
                : requireWorkflowJsColumnName(metric.expression, 'aggregate.metrics.column'),
            alias: metric.alias,
          })),
        };
    }
  });
}

function workflowFilterIrToOperation(condition: WorkflowJsExpressionIr): Record<string, unknown> {
  if (condition.kind === 'binary') {
    return {
      type: 'filter',
      column: requireWorkflowJsColumnName(condition.left, 'filter.column'),
      operator: condition.op,
      ...(condition.right.kind === 'column'
        ? { rightColumn: condition.right.name }
        : { value: workflowLiteralFromExpression(condition.right, 'filter.value') }),
    };
  }
  if (condition.kind === 'unary') {
    return {
      type: 'filter',
      column: requireWorkflowJsColumnName(condition.value, 'filter.column'),
      operator: condition.op,
    };
  }
  throw new DataCommandError(
    'VALIDATION_FAILED',
    'filter() requires a comparison expression such as col("Sales").gt(lit(100))'
  );
}

function workflowExpressionIrToDsl(expression: WorkflowJsExpressionIr): string {
  switch (expression.kind) {
    case 'column':
      return formatDslField(expression.name);
    case 'literal':
      return literalToDsl(expression.value);
    case 'binary':
      return `${workflowExpressionIrToDsl(expression.left)} ${expression.op} ${workflowExpressionIrToDsl(expression.right)}`;
    case 'function':
      return `${workflowFunctionNameToDsl(expression.name)}(${normalizeWorkflowFunctionArgs(
        expression
      )
        .map(workflowExpressionIrToDsl)
        .join(', ')})`;
    default:
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Unsupported workflow expression in derive: ${expression.kind}`
      );
  }
}

function normalizeWorkflowFunctionArgs(
  expression: Extract<WorkflowJsExpressionIr, { kind: 'function' }>
): WorkflowJsExpressionIr[] {
  if (expression.name !== 'regexpExtract' || expression.args.length !== 2) {
    return expression.args;
  }
  const pattern = expression.args[1];
  if (
    pattern?.kind === 'literal' &&
    typeof pattern.value === 'string' &&
    regexHasCaptureGroup(pattern.value)
  ) {
    return [...expression.args, { kind: 'literal', value: 1 }];
  }
  return expression.args;
}

function regexHasCaptureGroup(pattern: string): boolean {
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (char === '(' && pattern[index + 1] !== '?') {
      return true;
    }
  }
  return false;
}

function workflowFunctionNameToDsl(name: string): string {
  switch (name) {
    case 'regexpExtract':
      return 'REGEXP_EXTRACT';
    case 'year':
      return 'YEAR';
    case 'month':
      return 'MONTH';
    case 'upper':
      return 'UPPER';
    case 'lower':
      return 'LOWER';
    case 'trim':
      return 'TRIM';
    case 'replace':
      return 'REPLACE';
    case 'concat':
      return 'CONCAT';
    default:
      throw new DataCommandError('VALIDATION_FAILED', `Unsupported workflow function: fn.${name}`);
  }
}

function requireWorkflowJsColumnName(expression: WorkflowJsExpressionIr, context: string): string {
  if (expression.kind === 'column') return expression.name;
  throw new DataCommandError(
    'VALIDATION_FAILED',
    `Generated workflow JS ${context} must be a column reference`
  );
}

function workflowLiteralFromExpression(
  expression: WorkflowJsExpressionIr,
  context: string
): WorkflowJsLiteral {
  if (expression.kind === 'literal') return expression.value;
  throw new DataCommandError(
    'VALIDATION_FAILED',
    `Generated workflow JS ${context} must be a literal. Use right column comparisons with col("field").`
  );
}

function tokenizeWorkflowJavascript(code: string): WorkflowJsToken[] {
  const tokens: WorkflowJsToken[] = [];
  let index = 0;
  while (index < code.length) {
    const char = code[index] ?? '';
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      const quote = char;
      let value = '';
      index += 1;
      while (index < code.length) {
        const current = code[index] ?? '';
        if (current === '\\') {
          const next = code[index + 1];
          if (next !== undefined) {
            value += next === 'n' ? '\n' : next === 't' ? '\t' : next;
            index += 2;
            continue;
          }
        }
        if (current === quote) {
          index += 1;
          break;
        }
        value += current;
        index += 1;
      }
      tokens.push({ type: 'string', value });
      continue;
    }
    if (/[0-9-]/.test(char) && /^-?\d/.test(code.slice(index))) {
      const match = /^-?\d+(?:\.\d+)?/.exec(code.slice(index));
      if (match) {
        tokens.push({ type: 'number', value: match[0] });
        index += match[0].length;
        continue;
      }
    }
    if (/[_$A-Za-z]/.test(char)) {
      const match = /^[$_A-Za-z][$_A-Za-z0-9]*/.exec(code.slice(index));
      if (match) {
        const value = match[0];
        if (value === 'true' || value === 'false') {
          tokens.push({ type: 'boolean', value });
        } else if (value === 'null') {
          tokens.push({ type: 'null', value });
        } else {
          tokens.push({ type: 'identifier', value });
        }
        index += value.length;
        continue;
      }
    }
    if ('().,[]{}:'.includes(char)) {
      tokens.push({ type: 'punct', value: char });
      index += 1;
      continue;
    }
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Unsupported character in generated workflow JS: ${char}`
    );
  }
  return tokens;
}

class WorkflowJsParser {
  private index = 0;

  constructor(private readonly tokens: WorkflowJsToken[]) {}

  parseExpression(): WorkflowJsValue {
    let value = this.parsePrimary();
    while (this.matchPunct('.')) {
      const member = this.expectIdentifier();
      const args = this.matchPunct('(') ? this.parseArgumentsAfterOpenParen() : [];
      value = this.applyMemberCall(value, member, args);
    }
    return value;
  }

  expectEnd(): void {
    if (this.peek()) {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Unexpected token in generated workflow JS: ${this.peek()?.value}`
      );
    }
  }

  private parsePrimary(): WorkflowJsValue {
    const token = this.next();
    if (!token) {
      throw new DataCommandError('VALIDATION_FAILED', 'Unexpected end of generated workflow JS');
    }
    if (token.type === 'string') return token.value;
    if (token.type === 'number') return Number(token.value);
    if (token.type === 'boolean') return token.value === 'true';
    if (token.type === 'null') return null;
    if (token.type === 'identifier') {
      if (this.matchPunct('(')) {
        return this.applyFunctionCall(token.value, this.parseArgumentsAfterOpenParen());
      }
      if (token.value === 'INPUT_TABLE_ID' || token.value === 'OUTPUT_TABLE_NAME')
        return token.value;
      if (token.value === 'fn' || token.value === 'metric') {
        return { kind: 'namespace', name: token.value };
      }
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Unsupported identifier in generated workflow JS: ${token.value}`
      );
    }
    if (token.value === '[') return this.parseArrayAfterOpenBracket();
    if (token.value === '{') return this.parseObjectAfterOpenBrace();
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Unexpected token in generated workflow JS: ${token.value}`
    );
  }

  private parseArgumentsAfterOpenParen(): WorkflowJsValue[] {
    const args: WorkflowJsValue[] = [];
    if (this.matchPunct(')')) return args;
    while (this.peek()) {
      args.push(this.parseExpression());
      if (this.matchPunct(')')) return args;
      this.expectPunct(',');
    }
    throw new DataCommandError(
      'VALIDATION_FAILED',
      'Unclosed argument list in generated workflow JS'
    );
  }

  private parseArrayAfterOpenBracket(): WorkflowJsValue[] {
    const values: WorkflowJsValue[] = [];
    if (this.matchPunct(']')) return values;
    while (this.peek()) {
      values.push(this.parseExpression());
      if (this.matchPunct(']')) return values;
      this.expectPunct(',');
    }
    throw new DataCommandError('VALIDATION_FAILED', 'Unclosed array in generated workflow JS');
  }

  private parseObjectAfterOpenBrace(): Record<string, WorkflowJsValue> {
    const value: Record<string, WorkflowJsValue> = {};
    if (this.matchPunct('}')) return value;
    while (this.peek()) {
      const keyToken = this.next();
      if (!keyToken || (keyToken.type !== 'identifier' && keyToken.type !== 'string')) {
        throw new DataCommandError(
          'VALIDATION_FAILED',
          'Object keys in generated workflow JS must be identifiers or strings'
        );
      }
      this.expectPunct(':');
      value[keyToken.value] = this.parseExpression();
      if (this.matchPunct('}')) return value;
      this.expectPunct(',');
    }
    throw new DataCommandError('VALIDATION_FAILED', 'Unclosed object in generated workflow JS');
  }

  private applyFunctionCall(name: string, args: WorkflowJsValue[]): WorkflowJsValue {
    switch (name) {
      case 'workflow':
        if (args.length !== 0) this.throwArity(name);
        return { inputSeen: false, outputSeen: false, operations: [] };
      case 'col':
        return { kind: 'column', name: this.requireStringArg(args, 0, 'col') };
      case 'lit':
        return { kind: 'literal', value: this.requireLiteralArg(args, 0, 'lit') };
      default:
        throw new DataCommandError(
          'VALIDATION_FAILED',
          `Unsupported function in generated workflow JS: ${name}`
        );
    }
  }

  private applyMemberCall(
    target: WorkflowJsValue,
    member: string,
    args: WorkflowJsValue[]
  ): WorkflowJsValue {
    if (isWorkflowJsIr(target)) return this.applyWorkflowMethod(target, member, args);
    if (isWorkflowJsNamespace(target)) return this.applyNamespaceMethod(target, member, args);
    if (isWorkflowJsMetricExpression(target) && member === 'as') {
      return {
        fn: target.fn,
        expression: target.expression,
        alias: this.requireStringArg(args, 0, 'metric.as'),
      };
    }
    if (isWorkflowJsExpression(target)) return this.applyExpressionMethod(target, member, args);
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Unsupported member call in generated workflow JS: ${member}`
    );
  }

  private applyWorkflowMethod(
    workflow: WorkflowJsIr,
    member: string,
    args: WorkflowJsValue[]
  ): WorkflowJsIr {
    switch (member) {
      case 'inputDataset':
        workflow.inputSeen = true;
        return workflow;
      case 'filter':
        workflow.operations.push({
          type: 'filter',
          condition: this.requireExpressionArg(args, 0, 'filter'),
        });
        return workflow;
      case 'sort':
        workflow.operations.push({
          type: 'sort',
          column: this.requireExpressionArg(args, 0, 'sort'),
          direction: this.normalizeSortDirection(this.requireStringArg(args, 1, 'sort')),
        });
        return workflow;
      case 'drop':
        workflow.operations.push({
          type: 'drop',
          columns: this.requireStringList(args[0], 'drop'),
        });
        return workflow;
      case 'select':
        workflow.operations.push({
          type: 'select',
          columns: this.requireStringList(args[0], 'select'),
        });
        return workflow;
      case 'rename':
        workflow.operations.push({
          type: 'rename',
          source: this.requireStringArg(args, 0, 'rename'),
          target: this.requireStringArg(args, 1, 'rename'),
        });
        return workflow;
      case 'derive':
        workflow.operations.push({
          type: 'derive',
          column: this.requireStringArg(args, 0, 'derive'),
          expression: this.requireExpressionArg(args, 1, 'derive'),
        });
        return workflow;
      case 'cast':
        workflow.operations.push({
          type: 'convert_type',
          column: this.requireStringArg(args, 0, 'cast'),
          targetType: this.requireStringArg(args, 1, 'cast'),
          options: this.requireOptionalObjectArg(args, 2, 'cast'),
        });
        return workflow;
      case 'aggregate': {
        const config = this.requireOptionalObjectArg(args, 0, 'aggregate');
        workflow.operations.push({
          type: 'aggregate',
          groupBy: this.requireExpressionArray(config.groupBy, 'aggregate.groupBy'),
          metrics: this.requireMetricArray(config.metrics, 'aggregate.metrics'),
        });
        return workflow;
      }
      case 'outputTable':
        workflow.outputSeen = true;
        return workflow;
      default:
        throw new DataCommandError('VALIDATION_FAILED', `Unsupported workflow method: ${member}`);
    }
  }

  private applyNamespaceMethod(
    namespace: { kind: 'namespace'; name: 'fn' | 'metric' },
    member: string,
    args: WorkflowJsValue[]
  ): WorkflowJsValue {
    if (namespace.name === 'fn') {
      return {
        kind: 'function',
        name: member,
        args: args.map((arg, index) =>
          typeof arg === 'string' ||
          typeof arg === 'number' ||
          typeof arg === 'boolean' ||
          arg === null
            ? ({ kind: 'literal', value: arg } as WorkflowJsExpressionIr)
            : this.requireExpressionValue(arg, `fn.${member}[${index}]`)
        ),
      };
    }
    if (!['sum', 'avg', 'min', 'max', 'count', 'countDistinct'].includes(member)) {
      throw new DataCommandError('VALIDATION_FAILED', `Unsupported metric function: ${member}`);
    }
    return {
      kind: 'metric',
      fn: member === 'countDistinct' ? 'count_distinct' : member,
      expression:
        member === 'count' && args.length === 0 ? '*' : this.requireExpressionArg(args, 0, member),
    };
  }

  private applyExpressionMethod(
    target: WorkflowJsExpressionIr,
    member: string,
    args: WorkflowJsValue[]
  ): WorkflowJsExpressionIr {
    const right = args.length > 0 ? this.requireExpressionOrLiteral(args[0], member) : null;
    switch (member) {
      case 'eq':
        return this.binary(target, '=', right);
      case 'neq':
        return this.binary(target, '<>', right);
      case 'gt':
        return this.binary(target, '>', right);
      case 'gte':
        return this.binary(target, '>=', right);
      case 'lt':
        return this.binary(target, '<', right);
      case 'lte':
        return this.binary(target, '<=', right);
      case 'add':
        return this.binary(target, '+', right);
      case 'sub':
        return this.binary(target, '-', right);
      case 'mul':
        return this.binary(target, '*', right);
      case 'div':
        return this.binary(target, '/', right);
      case 'contains':
        return this.binary(target, 'contains', right);
      case 'notContains':
        return this.binary(target, 'not_contains', right);
      case 'isNull':
        return { kind: 'unary', op: 'is_null', value: target };
      case 'isNotNull':
        return { kind: 'unary', op: 'is_not_null', value: target };
      default:
        throw new DataCommandError(
          'VALIDATION_FAILED',
          `Unsupported expression method in generated workflow JS: ${member}`
        );
    }
  }

  private binary(
    left: WorkflowJsExpressionIr,
    op: string,
    right: WorkflowJsExpressionIr | null
  ): WorkflowJsExpressionIr {
    if (!right) {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Expression method ${op} requires an argument`
      );
    }
    return { kind: 'binary', op, left, right };
  }

  private requireExpressionOrLiteral(
    value: WorkflowJsValue | undefined,
    context: string
  ): WorkflowJsExpressionIr {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null
    ) {
      return { kind: 'literal', value };
    }
    return this.requireExpressionValue(value, context);
  }

  private requireExpressionArg(
    args: WorkflowJsValue[],
    index: number,
    context: string
  ): WorkflowJsExpressionIr {
    return this.requireExpressionValue(args[index], context);
  }

  private requireExpressionValue(
    value: WorkflowJsValue | undefined,
    context: string
  ): WorkflowJsExpressionIr {
    if (
      isWorkflowJsExpression(value) &&
      value.kind !== 'workflow' &&
      value.kind !== 'namespace' &&
      value.kind !== 'metric'
    ) {
      return value;
    }
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Generated workflow JS ${context} requires an expression`
    );
  }

  private requireExpressionArray(
    value: WorkflowJsValue | undefined,
    context: string
  ): WorkflowJsExpressionIr[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => this.requireExpressionValue(item, context));
  }

  private requireMetricArray(
    value: WorkflowJsValue | undefined,
    context: string
  ): WorkflowJsMetricIr[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => {
      if (isWorkflowJsMetricIr(item)) return item;
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `${context} requires metric.*(...).as("alias")`
      );
    });
  }

  private requireStringList(value: WorkflowJsValue | undefined, context: string): string[] {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      return value;
    }
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Generated workflow JS ${context} requires a string or string array`
    );
  }

  private requireStringArg(args: WorkflowJsValue[], index: number, context: string): string {
    const value = args[index];
    if (typeof value === 'string') return value;
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Generated workflow JS ${context} argument ${index + 1} must be a string`
    );
  }

  private requireLiteralArg(
    args: WorkflowJsValue[],
    index: number,
    context: string
  ): WorkflowJsLiteral {
    const value = args[index];
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null
    ) {
      return value;
    }
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Generated workflow JS ${context} argument ${index + 1} must be a literal`
    );
  }

  private requireOptionalObjectArg(
    args: WorkflowJsValue[],
    index: number,
    context: string
  ): Record<string, WorkflowJsValue> {
    const value = args[index];
    if (value === undefined) return {};
    if (isPlainWorkflowJsObject(value)) return value;
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Generated workflow JS ${context} argument ${index + 1} must be an object`
    );
  }

  private normalizeSortDirection(value: string): 'asc' | 'desc' {
    return value.toLowerCase() === 'desc' || value.toLowerCase() === 'descending' ? 'desc' : 'asc';
  }

  private throwArity(name: string): never {
    throw new DataCommandError('VALIDATION_FAILED', `${name} received unsupported arguments`);
  }

  private expectIdentifier(): string {
    const token = this.next();
    if (!token || token.type !== 'identifier') {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        'Expected identifier in generated workflow JS'
      );
    }
    return token.value;
  }

  private expectPunct(value: string): void {
    if (!this.matchPunct(value)) {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Expected "${value}" in generated workflow JS`
      );
    }
  }

  private matchPunct(value: string): boolean {
    if (this.peek()?.type === 'punct' && this.peek()?.value === value) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private next(): WorkflowJsToken | undefined {
    const token = this.peek();
    if (token) this.index += 1;
    return token;
  }

  private peek(): WorkflowJsToken | undefined {
    return this.tokens[this.index];
  }
}

function isWorkflowJsIr(value: unknown): value is WorkflowJsIr {
  return isRecord(value) && Array.isArray(value.operations);
}

function isWorkflowJsNamespace(
  value: unknown
): value is { kind: 'namespace'; name: 'fn' | 'metric' } {
  return (
    isRecord(value) &&
    value.kind === 'namespace' &&
    (value.name === 'fn' || value.name === 'metric')
  );
}

function isWorkflowJsExpression(value: unknown): value is WorkflowJsExpressionIr {
  return isRecord(value) && typeof value.kind === 'string';
}

function isWorkflowJsMetricExpression(
  value: unknown
): value is { kind: 'metric'; fn: string; expression: WorkflowJsExpressionIr | '*' } {
  return isRecord(value) && value.kind === 'metric' && typeof value.fn === 'string';
}

function isWorkflowJsMetricIr(value: unknown): value is WorkflowJsMetricIr {
  return (
    isRecord(value) &&
    typeof value.fn === 'string' &&
    typeof value.alias === 'string' &&
    'expression' in value
  );
}

function isPlainWorkflowJsObject(value: unknown): value is Record<string, WorkflowJsValue> {
  return isRecord(value) && !('kind' in value) && !('operations' in value) && !('fn' in value);
}
