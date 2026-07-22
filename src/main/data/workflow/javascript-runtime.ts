import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { DataCommandError } from '../data-command-types';
import type { WorkflowIr, WorkflowOperationIr } from './workflow-model';
import { validateAndNormalizeWorkflowIr } from './workflow-ir';
import { WORKFLOW_OPERATION_TYPES } from './workflow-operation-registry';

export const WORKFLOW_SDK_VERSION = '2.0.0';

const WORKFLOW_IR_OPERATION_TYPES = [...WORKFLOW_OPERATION_TYPES];

export const WORKFLOW_SDK_RUNTIME_SOURCE = String.raw`
const freeze = value => Object.freeze(value);
const expression = value => freeze(value);
const literal = value => expression({ kind: 'literal', value });
const asExpression = value => value && typeof value === 'object' && value.__expression
  ? value.__expression
  : literal(value);
const wrapExpression = ir => {
  const api = Object.create(null);
  Object.defineProperty(api, '__expression', { value: ir, enumerable: false });
  for (const [name, op] of Object.entries({
    eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=',
    contains: 'contains', notContains: 'not_contains', add: '+', sub: '-', mul: '*', div: '/'
  })) {
    api[name] = value => wrapExpression(expression({
      kind: 'binary', op, left: ir, right: asExpression(value)
    }));
  }
  api.isNull = () => wrapExpression(expression({ kind: 'unary', op: 'is_null', value: ir }));
  api.isNotNull = () => wrapExpression(expression({ kind: 'unary', op: 'is_not_null', value: ir }));
  return freeze(api);
};
const requireWorkflow = value => {
  if (!value || value.__workflow !== true) {
    const error = new TypeError('First argument must be a WorkflowValue');
    error.code = 'INVALID_WORKFLOW_INPUT';
    throw error;
  }
};
const deepUnwrap = value => {
  if (Array.isArray(value)) return value.map(deepUnwrap);
  if (value && value.__metric) {
    return { fn: value.fn, expression: value.expression, alias: value.alias };
  }
  if (value && value.__expression) return value.__expression;
  if (value && typeof value === 'object') {
    const result = Object.create(null);
    for (const key of Object.keys(value)) result[key] = deepUnwrap(value[key]);
    return result;
  }
  return value;
};
const stackLocation = () => {
  const stack = String(new Error().stack || '').split('\n');
  for (const line of stack) {
    const match = line.match(/at\s+(?:([^\s(]+)\s+\()?generated-workflow\.js:(\d+):(\d+)\)?/);
    if (match) {
      return {
        functionName: match[1] || 'main',
        line: Number(match[2]),
        column: Number(match[3]),
        start: 0,
        end: 0
      };
    }
  }
  return { functionName: 'main', line: 1, column: 1, start: 0, end: 0 };
};
const slug = value => String(value || 'operation')
  .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'operation';
const operationIdCounts = new Map();
const stableOperationId = (type, location) => {
  const base = slug(location.functionName === 'main' ? type : location.functionName);
  const count = (operationIdCounts.get(base) || 0) + 1;
  operationIdCounts.set(base, count);
  return count === 1 ? base : base + '-' + count;
};
const workflowValue = nodeId => freeze(Object.assign(Object.create(null), {
  __workflow: true,
  __nodeId: nodeId
}));
const add = (type, input, fields) => {
  requireWorkflow(input);
  if (!allowedOperationTypes.has(type)) {
    const error = new TypeError('Unsupported workflow operation type: ' + String(type));
    error.code = 'UNSUPPORTED_WORKFLOW_OPERATION';
    throw error;
  }
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    const error = new TypeError('Workflow operation payload must be an object');
    error.code = 'INVALID_WORKFLOW_PAYLOAD';
    throw error;
  }
  const location = stackLocation();
  const operationId = stableOperationId(type, location);
  operations.push({ operationId, type, inputOperationId: input.__nodeId, ...deepUnwrap(fields) });
  provenance.push({ operationId, language: 'javascript', source: location });
  return workflowValue(operationId);
};
const sdk = Object.create(null);
sdk.INPUT_TABLE_ID = payload.inputTableId;
sdk.OUTPUT_TABLE_NAME = payload.outputTableName;
const allowedOperationTypes = new Set(${JSON.stringify(WORKFLOW_IR_OPERATION_TYPES)});
sdk.workflow = freeze({
  input: () => { inputSeen = true; return workflowValue('input'); },
  step: (input, type, fields) => add(type, input, fields),
  output: input => {
    requireWorkflow(input);
    outputSeen = true;
    outputOperationId = input.__nodeId;
    return input;
  }
});
sdk.col = name => wrapExpression(expression({ kind: 'column', name }));
sdk.lit = value => wrapExpression(literal(value));
sdk.fn = freeze(Object.fromEntries([
  'regexpExtract', 'year', 'month', 'upper', 'lower', 'trim', 'replace', 'concat'
].map(name => [name, (...args) => wrapExpression(expression({
  kind: 'function', name, args: args.map(asExpression)
}))])));
const metricFactory = name => value => {
  const result = Object.create(null);
  result.as = alias => freeze({
    __metric: true,
    fn: name,
    expression: value === undefined ? '*' : asExpression(value),
    alias
  });
  return freeze(result);
};
sdk.metric = freeze(Object.fromEntries([
  'sum', 'avg', 'min', 'max', 'count', 'countDistinct'
].map(name => [name, metricFactory(name)])));
sdk.__finish = value => { mainResult = value; };
`;

const GENERATED_FILE = 'generated-workflow.js';
const DEFAULT_TIMEOUT_MS = 2_000;
const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

export interface JavaScriptFunctionIndexEntry {
  name: string;
  start: number;
  end: number;
  line: number;
  column: number;
  endLine: number;
}

export interface CompiledWorkflowJavaScript {
  source: string;
  functions: JavaScriptFunctionIndexEntry[];
}

export function compileWorkflowJavaScript(source: string): CompiledWorkflowJavaScript {
  try {
    // Construction invokes V8's native parser/compiler without executing generated code.
    new vm.Script(source, { filename: GENERATED_FILE });
  } catch (error) {
    throw normalizeJavaScriptError(
      error,
      'JAVASCRIPT_SYNTAX_ERROR',
      indexFunctionStartsBestEffort(source)
    );
  }
  const functions = indexJavaScriptFunctions(source);
  if (!functions.some((item) => item.name === 'main')) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      'Generated workflow JavaScript must declare function main()',
      {
        diagnostics: [
          {
            severity: 'error',
            code: 'MISSING_MAIN',
            message: 'Generated workflow JavaScript must declare function main()',
          },
        ],
      }
    );
  }
  return { source, functions };
}

function indexFunctionStartsBestEffort(source: string): JavaScriptFunctionIndexEntry[] {
  const lines = source.split(/\r?\n/);
  const starts = lines
    .map((line, index) => ({ match: /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/.exec(line), index }))
    .filter((item): item is { match: RegExpExecArray; index: number } => Boolean(item.match));
  return starts.map((item, index) => ({
    name: item.match[1],
    start: 0,
    end: source.length,
    line: item.index + 1,
    column: item.match.index + 1,
    endLine: (starts[index + 1]?.index ?? lines.length) + (index + 1 < starts.length ? 0 : 0),
  }));
}

export function executeWorkflowJavaScriptInSandbox({
  compiled,
  inputTableId,
  outputTableName,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
  compiled: CompiledWorkflowJavaScript;
  inputTableId: string;
  outputTableName: string;
  timeoutMs?: number;
}): WorkflowIr {
  const runner = createSandboxRunnerSource();
  const result = spawnSync(
    process.execPath,
    ['--permission', '--disable-proto=throw', '--max-old-space-size=64', '-e', runner],
    {
      input: JSON.stringify({
        javascript: compiled.source,
        inputTableId,
        outputTableName,
        timeoutMs,
        sdkVersion: WORKFLOW_SDK_VERSION,
      }),
      encoding: 'utf8',
      timeout: timeoutMs + 500,
      maxBuffer: DEFAULT_MAX_OUTPUT_BYTES,
      env: process.versions.electron
        ? { ELECTRON_RUN_AS_NODE: '1', PATH: process.env.PATH ?? '' }
        : { PATH: process.env.PATH ?? '' },
      windowsHide: true,
    }
  );
  if (result.error) {
    throw new DataCommandError(
      'RUN_FAILED',
      result.error.message.includes('ETIMEDOUT')
        ? `Workflow SDK sandbox exceeded ${timeoutMs}ms timeout`
        : `Workflow SDK sandbox failed to start: ${result.error.message}`
    );
  }
  let response: {
    ok?: boolean;
    ir?: unknown;
    error?: { code?: string; name?: string; message?: string; stack?: string };
  };
  try {
    response = JSON.parse(result.stdout || '{}') as typeof response;
  } catch {
    throw new DataCommandError(
      'RUN_FAILED',
      `Workflow SDK sandbox returned invalid output${result.stderr ? `: ${result.stderr}` : ''}`
    );
  }
  if (!response.ok || !response.ir) {
    throw normalizeSandboxError(response.error, compiled.functions);
  }
  return validateAndNormalizeWorkflowIr(response.ir);
}

export function applyWorkflowFunctionPatch(
  source: string,
  functionName: string,
  replacement: string
): string {
  compileWorkflowJavaScript(source);
  const original = new Map(indexJavaScriptFunctions(source).map((item) => [item.name, item]));
  const target = original.get(functionName);
  if (!target) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Cannot patch unknown workflow function: ${functionName}`
    );
  }
  try {
    new vm.Script(replacement, { filename: GENERATED_FILE });
  } catch (error) {
    throw normalizeJavaScriptError(
      error,
      'JAVASCRIPT_SYNTAX_ERROR',
      indexFunctionStartsBestEffort(replacement)
    );
  }
  const replacements = new Map(
    indexJavaScriptFunctions(replacement).map((item) => [item.name, item])
  );
  if (!replacements.has(functionName)) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Workflow function patch must contain function ${functionName}`
    );
  }
  for (const name of replacements.keys()) {
    if (name === 'main' && functionName !== 'main') {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        'Workflow helper patch must not replace function main'
      );
    }
    if (name !== functionName && original.has(name)) {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Workflow function patch cannot redefine existing function ${name}`
      );
    }
  }
  return `${source.slice(0, target.start)}${replacement.trim()}${source.slice(target.end)}`;
}

export function assertAtomicWorkflowHelpers(ir: WorkflowIr): void {
  const provenance = new Map(ir.provenance.map((item) => [item.operationId, item.source] as const));
  const byFunction = new Map<string, WorkflowOperationIr[]>();
  for (const operation of ir.operations) {
    const location = operation.operationId
      ? provenance.get(operation.operationId)
      : operation.location;
    const functionName = location?.functionName;
    if (!functionName || functionName === 'main') continue;
    byFunction.set(functionName, [...(byFunction.get(functionName) ?? []), operation]);
  }
  for (const [functionName, operations] of byFunction) {
    if (operations.length <= 1) continue;
    const first = operations[0];
    const location = first.operationId ? provenance.get(first.operationId) : first.location;
    const message = `Generated helper ${functionName} contains ${operations.length} workflow operations. Each helper must contain exactly one operation; compose helpers with named const variables in main().`;
    throw new DataCommandError('VALIDATION_FAILED', message, {
      diagnostics: [
        {
          severity: 'error',
          code: 'NON_ATOMIC_WORKFLOW_HELPER',
          message,
          line: location?.line,
          column: location?.column,
          functionName,
        },
      ],
    });
  }
}

export function indexJavaScriptFunctions(source: string): JavaScriptFunctionIndexEntry[] {
  const masked = maskJavaScriptNonCode(source);
  const functions: JavaScriptFunctionIndexEntry[] = [];
  const names = new Set<string>();
  const pattern = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let match: RegExpExecArray | null;
  let consumedUntil = 0;
  while ((match = pattern.exec(masked))) {
    if (masked.slice(consumedUntil, match.index).trim()) {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        'Generated workflow JavaScript may only contain named function declarations'
      );
    }
    const name = match[1];
    if (names.has(name)) {
      throw new DataCommandError('VALIDATION_FAILED', `Duplicate workflow function: ${name}`);
    }
    names.add(name);
    const openParen = pattern.lastIndex - 1;
    const closeParen = findMatchingDelimiter(masked, openParen, '(', ')');
    const bodyStart = masked.indexOf('{', closeParen + 1);
    if (bodyStart < 0 || masked.slice(closeParen + 1, bodyStart).trim()) {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Cannot locate body of workflow function ${name}`
      );
    }
    const bodyEnd = findMatchingDelimiter(masked, bodyStart, '{', '}');
    const startPosition = sourcePositionAt(source, match.index);
    const endPosition = sourcePositionAt(source, bodyEnd + 1);
    functions.push({
      name,
      start: match.index,
      end: bodyEnd + 1,
      line: startPosition.line,
      column: startPosition.column,
      endLine: endPosition.line,
    });
    consumedUntil = bodyEnd + 1;
    pattern.lastIndex = consumedUntil;
  }
  if (masked.slice(consumedUntil).trim() || functions.length === 0) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      'Generated workflow JavaScript may only contain named function declarations'
    );
  }
  return functions;
}

/** Masks literals and comments while preserving offsets for diagnostics and patching. */
function maskJavaScriptNonCode(source: string): string {
  const chars = [...source];
  let quote: "'" | '"' | '`' | null = null;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    const next = chars[index + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      else chars[index] = ' ';
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        chars[index] = chars[index + 1] = ' ';
        index += 1;
        blockComment = false;
      } else if (char !== '\n') chars[index] = ' ';
      continue;
    }
    if (quote) {
      if (char === '\\') {
        chars[index] = ' ';
        if (index + 1 < chars.length && chars[index + 1] !== '\n') chars[index + 1] = ' ';
        index += 1;
      } else if (char === quote) {
        chars[index] = ' ';
        quote = null;
      } else if (char !== '\n') chars[index] = ' ';
      continue;
    }
    if (char === '/' && next === '/') {
      chars[index] = chars[index + 1] = ' ';
      index += 1;
      lineComment = true;
    } else if (char === '/' && next === '*') {
      chars[index] = chars[index + 1] = ' ';
      index += 1;
      blockComment = true;
    } else if (char === "'" || char === '"' || char === '`') {
      chars[index] = ' ';
      quote = char;
    }
  }
  return chars.join('');
}

function findMatchingDelimiter(
  source: string,
  start: number,
  open: '(' | '{',
  close: ')' | '}'
): number {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === open) depth += 1;
    if (source[index] === close) depth -= 1;
    if (depth === 0) return index;
  }
  throw new DataCommandError('VALIDATION_FAILED', 'Unbalanced generated workflow function');
}

function sourcePositionAt(source: string, offset: number): { line: number; column: number } {
  const lines = source.slice(0, offset).split(/\r?\n/);
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function normalizeJavaScriptError(
  error: unknown,
  code: string,
  functions: JavaScriptFunctionIndexEntry[]
): DataCommandError {
  const value = error as {
    message?: string;
    stack?: string;
    lineNumber?: number;
    columnNumber?: number;
  };
  const match = String(value.stack ?? '').match(/generated-workflow\.js:(\d+)(?::(\d+))?/);
  const line = value.lineNumber ?? (match ? Number(match[1]) : undefined);
  const column = value.columnNumber ?? (match?.[2] ? Number(match[2]) : undefined);
  const fn =
    line === undefined
      ? undefined
      : functions.find((item) => item.line <= line && item.endLine >= line);
  const message = value.message ?? String(error);
  return new DataCommandError('VALIDATION_FAILED', message, {
    diagnostics: [
      {
        severity: 'error',
        code,
        message,
        line,
        column,
        functionName: fn?.name,
      },
    ],
  });
}

function normalizeSandboxError(
  error: { code?: string; name?: string; message?: string; stack?: string } | undefined,
  functions: JavaScriptFunctionIndexEntry[]
): DataCommandError {
  const match = error?.stack?.match(/generated-workflow\.js:(\d+):(\d+)/);
  const line = match ? Number(match[1]) : undefined;
  const column = match ? Number(match[2]) : undefined;
  const fn =
    line === undefined
      ? undefined
      : functions.find((item) => item.line <= line && item.endLine >= line);
  const message = error?.message ?? 'unknown error';
  return new DataCommandError('RUN_FAILED', `Workflow SDK sandbox execution failed: ${message}`, {
    diagnostics: [
      {
        severity: 'error',
        code: error?.code ?? 'SDK_RUNTIME_ERROR',
        message,
        line,
        column,
        functionName: fn?.name,
      },
    ],
  });
}

function createSandboxRunnerSource(): string {
  return String.raw`
'use strict';
const vm = require('node:vm');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(input);
    const operations = [];
    const provenance = [];
    let inputSeen = false;
    let outputSeen = false;
    let outputOperationId = null;
    let mainResult;
    ${WORKFLOW_SDK_RUNTIME_SOURCE}
    const context = vm.createContext(Object.freeze({ ...sdk }), {
      codeGeneration: { strings: false, wasm: false }
    });
    const script = new vm.Script(
      payload.javascript + '\n;__finish(main());',
      { filename: 'generated-workflow.js' }
    );
    script.runInContext(context, { timeout: payload.timeoutMs, breakOnSigint: true });
    requireWorkflow(mainResult);
    process.stdout.write(JSON.stringify({
      ok: true,
      ir: {
        irVersion: '1.0',
        kind: 'workflow',
        sourceLanguage: 'javascript',
        sdkVersion: payload.sdkVersion,
        inputSeen,
        outputSeen,
        outputOperationId,
        operations,
        provenance
      }
    }));
  } catch (error) {
    process.stdout.write(JSON.stringify({
      ok: false,
      error: {
        code: error && error.code,
        name: error && error.name,
        message: error && error.message,
        stack: error && error.stack
      }
    }));
  }
});
`;
}
