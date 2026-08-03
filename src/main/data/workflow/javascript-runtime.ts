import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import vm from 'node:vm';
import { parse, type FunctionDeclaration } from 'acorn';
import { DataCommandError } from '../data-command-types';
import type { WorkflowIr } from './workflow-model';
import { validateAndNormalizeWorkflowIr } from './workflow-ir';
import { WORKFLOW_IR_OPERATION_TYPES } from './workflow-ir-operation-registry';
import {
  prepareWorkflowJavaScript,
  type PreparedWorkflowExpression,
} from './javascript-expression-compiler';

export const WORKFLOW_SDK_VERSION = '2.1.0';

const ALLOWED_WORKFLOW_IR_OPERATION_TYPES = [...WORKFLOW_IR_OPERATION_TYPES];
const WORKFLOW_SANDBOX_RUNNER_FILE_NAME = 'workflow-sandbox-runner.js';

function resolveWorkflowSandboxRunnerPath(): string {
  const candidates = [
    process.resourcesPath
      ? join(process.resourcesPath, 'workflow', WORKFLOW_SANDBOX_RUNNER_FILE_NAME)
      : undefined,
    resolve(process.cwd(), 'src/main/data/workflow', WORKFLOW_SANDBOX_RUNNER_FILE_NAME),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const runtimePath = candidates.find((candidate) => existsSync(candidate));
  if (!runtimePath) {
    throw new DataCommandError(
      'RUN_FAILED',
      `Cannot find Workflow sandbox runner; checked: ${candidates.join(', ')}`
    );
  }
  return runtimePath;
}

export const WORKFLOW_SANDBOX_RUNNER_SOURCE = readFileSync(
  resolveWorkflowSandboxRunnerPath(),
  'utf8'
);

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
  /** Exact model-authored source retained for display, diagnostics, and patching. */
  originalSource: string;
  /** Compiler-owned source executed in the child-process sandbox. */
  executableSource: string;
  functions: JavaScriptFunctionIndexEntry[];
  /** Precompiled expression IR transferred separately from executable source. */
  expressions: readonly PreparedWorkflowExpression[];
}

export function compileWorkflowJavaScript(
  source: string,
  options: { columns?: Array<{ name: string; type?: string }> } = {}
): CompiledWorkflowJavaScript {
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
  const prepared = prepareWorkflowJavaScript({ source, columns: options.columns });
  try {
    new vm.Script(prepared.executableSource, { filename: GENERATED_FILE });
  } catch (error) {
    throw normalizeJavaScriptError(error, 'JAVASCRIPT_LOWERING_ERROR', functions);
  }
  return {
    originalSource: source,
    executableSource: prepared.executableSource,
    functions,
    expressions: prepared.expressions,
  };
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
  const result = spawnSync(
    process.execPath,
    [
      '--permission',
      '--disable-proto=throw',
      '--max-old-space-size=64',
      '-e',
      WORKFLOW_SANDBOX_RUNNER_SOURCE,
    ],
    {
      input: JSON.stringify({
        javascript: compiled.executableSource,
        expressions: compiled.expressions.map(({ id, ir }) => ({ id, ir })),
        inputTableId,
        outputTableName,
        timeoutMs,
        sdkVersion: WORKFLOW_SDK_VERSION,
        allowedOperationTypes: ALLOWED_WORKFLOW_IR_OPERATION_TYPES,
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
  replacementSource: string
): string {
  // A repair must be able to target source that failed expression lowering or
  // type checking. Structural indexing therefore operates on the original
  // parseable JavaScript and does not require the failed program to compile.
  const originalFunctions = new Map(
    indexJavaScriptFunctions(source).map((item) => [item.name, item])
  );
  const target = originalFunctions.get(functionName);
  if (!target) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Cannot patch unknown workflow function: ${functionName}`
    );
  }

  const replacementFunctions = indexJavaScriptFunctions(replacementSource);
  if (!replacementFunctions.some((item) => item.name === functionName)) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Workflow function patch must retain function ${functionName}`
    );
  }
  for (const replacement of replacementFunctions) {
    if (replacement.name === 'main' && functionName !== 'main') {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        'Workflow helper patch must not include function main'
      );
    }
    if (replacement.name !== functionName && originalFunctions.has(replacement.name)) {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Workflow function patch cannot redefine existing function ${replacement.name}`
      );
    }
  }

  const patched = `${source.slice(0, target.start)}${replacementSource.trim()}${source.slice(target.end)}`;
  compileWorkflowJavaScript(patched);
  return patched;
}

export function indexJavaScriptFunctions(source: string): JavaScriptFunctionIndexEntry[] {
  let program;
  try {
    program = parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      locations: true,
    });
  } catch (error) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Cannot parse workflow JavaScript structure with Acorn: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const names = new Set<string>();
  return program.body.map((node) => {
    if (node.type !== 'FunctionDeclaration' || !node.id) {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        'Generated workflow JavaScript may only contain named function declarations'
      );
    }
    const declaration = node as FunctionDeclaration;
    const name = declaration.id!.name;
    if (names.has(name)) {
      throw new DataCommandError('VALIDATION_FAILED', `Duplicate workflow function: ${name}`);
    }
    names.add(name);
    return {
      name,
      start: declaration.start,
      end: declaration.end,
      line: declaration.loc?.start.line ?? 1,
      column: (declaration.loc?.start.column ?? 0) + 1,
      endLine: declaration.loc?.end.line ?? 1,
    };
  });
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
