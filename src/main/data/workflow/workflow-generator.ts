import type { AgentRuntimeConfig } from '../../../renderer/types';
import type { PrepDiagnostic } from '../../../shared/prep-dsl';
import { runPiAiOneShot } from '../../claude/claude-sdk-one-shot';
import { DataCommandError } from '../data-command-types';
import {
  applyWorkflowFunctionPatch,
  assertAtomicWorkflowHelpers,
  compileWorkflowJavaScript,
  executeWorkflowJavaScriptInSandbox,
} from './javascript-runtime';
import { getWorkflowJavascriptCapabilityPrompt } from './workflow-operation-registry';
import {
  exportWorkflowOperationsToPrepDsl,
  lowerWorkflowIrToOperations,
  type GeneratedDataTaskWorkflow,
} from './operation-compiler';
import { computeWorkflowIrSemanticHash } from './workflow-ir';
import { extractJsonObject, isRecord } from './utils';

export const GENERATED_WORKFLOW_REPAIR_ATTEMPTS = 2;

export function compileGeneratedJavaScriptWorkflow({
  javascriptSource,
  inputTableId,
  outputTableName,
  requirement,
  columns,
}: {
  javascriptSource: string;
  inputTableId: string;
  outputTableName: string;
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
}): GeneratedDataTaskWorkflow {
  const compiled = compileWorkflowJavaScript(javascriptSource);
  const ir = executeWorkflowJavaScriptInSandbox({ compiled, inputTableId, outputTableName });
  const verificationIr = executeWorkflowJavaScriptInSandbox({
    compiled,
    inputTableId,
    outputTableName,
  });
  const semanticHash = computeWorkflowIrSemanticHash(ir);
  if (semanticHash !== computeWorkflowIrSemanticHash(verificationIr)) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      'Generated workflow JavaScript produced non-deterministic Workflow IR',
      {
        diagnostics: [
          {
            severity: 'error',
            code: 'NON_DETERMINISTIC_WORKFLOW_BUILD',
            message: 'The same JavaScript source produced different Workflow IR results',
          },
        ],
      }
    );
  }
  assertAtomicWorkflowHelpers(ir);
  const operations = lowerWorkflowIrToOperations({ ir, inputTableId, outputTableName });
  return {
    ...exportWorkflowOperationsToPrepDsl({
      workflow: operations,
      sourceIr: ir,
      requirement,
      columns,
    }),
    javascriptSource,
    workflowIr: ir,
    workflowIrSemanticHash: semanticHash,
  };
}

function normalizeOptionalName(name: string | undefined): string | undefined {
  const normalized = name?.trim();
  return normalized || undefined;
}

function extractGeneratedJavascriptSource(text: string): string {
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(extractJsonObject(trimmed)) as unknown;
    if (
      isRecord(parsed) &&
      typeof parsed.javascriptSource === 'string' &&
      parsed.javascriptSource.trim()
    ) {
      return parsed.javascriptSource.trim();
    }
  } catch {
    // Fall through to code-fence/raw program extraction.
  }
  const fenced = trimmed.match(/```(?:javascript|js)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const mainIndex = candidate.search(/\bfunction\s+main\s*\(/);
  if (mainIndex >= 0) return candidate.slice(mainIndex).trim();
  throw new DataCommandError(
    'VALIDATION_FAILED',
    'Workflow JavaScript generation response must include javascriptSource with function main()'
  );
}

export function normalizeColumnSnapshot(
  primary?: Array<{ name?: string; type?: string }>,
  fallback?: Array<{ name?: string; type?: string }>
): Array<{ name: string; type?: string }> {
  const source = primary?.length ? primary : fallback;
  return (source ?? [])
    .map((column) => ({
      name: String(column.name ?? '').trim(),
      type: typeof column.type === 'string' ? column.type : undefined,
    }))
    .filter((column) => Boolean(column.name));
}

export async function generateDataTaskWorkflowFromRequirement({
  inputTableId,
  outputTableName,
  requirement,
  columns,
  runtimeConfig,
}: {
  inputTableId: string;
  outputTableName: string;
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
  runtimeConfig?: AgentRuntimeConfig;
}): Promise<GeneratedDataTaskWorkflow> {
  const config = requireGenerationRuntimeConfig(runtimeConfig);
  try {
    const response = await runPiAiOneShot(
      buildWorkflowGenerationUserPrompt({
        inputTableId,
        outputTableName,
        requirement,
        columns,
      }),
      buildWorkflowGenerationSystemPrompt(),
      config,
      { temperature: 0, maxTokens: 4_000 }
    );
    try {
      return compileGeneratedJavascriptResponse({
        text: response.text,
        inputTableId,
        outputTableName,
        requirement,
        columns,
      });
    } catch (parseError) {
      return await repairGeneratedWorkflowFromDiagnostics({
        inputTableId,
        outputTableName,
        requirement,
        columns,
        runtimeConfig,
        failedJavascriptSource:
          extractJavascriptSourceFromModelResponse(response.text) ?? response.text,
        diagnostics: diagnosticsFromGenerationError(parseError),
      });
    }
  } catch (error) {
    if (error instanceof DataCommandError) throw error;
    throw new DataCommandError(
      'GENERATION_FAILED',
      `Failed to generate data task workflow: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function repairGeneratedWorkflowFromDiagnostics({
  inputTableId,
  outputTableName,
  requirement,
  columns,
  runtimeConfig,
  failedJavascriptSource,
  diagnostics,
}: {
  inputTableId: string;
  outputTableName: string;
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
  runtimeConfig?: AgentRuntimeConfig;
  failedJavascriptSource: string;
  diagnostics: PrepDiagnostic[];
}): Promise<GeneratedDataTaskWorkflow> {
  const config = requireGenerationRuntimeConfig(runtimeConfig);
  try {
    let currentJavascriptSource = failedJavascriptSource;
    let currentDiagnostics = diagnostics;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const repairFunctionName = resolveRepairFunctionName(
        currentJavascriptSource,
        currentDiagnostics
      );
      const response = await runPiAiOneShot(
        buildWorkflowGenerationUserPrompt({
          inputTableId,
          outputTableName,
          requirement,
          columns,
          failedJavascriptSource: currentJavascriptSource,
          diagnostics: currentDiagnostics,
          repairFunctionName,
        }),
        buildWorkflowGenerationSystemPrompt(),
        config,
        { temperature: 0, maxTokens: 4_000 }
      );
      try {
        return compileRepairResponse({
          text: response.text,
          failedJavascriptSource: currentJavascriptSource,
          repairFunctionName,
          inputTableId,
          outputTableName,
          requirement,
          columns,
        });
      } catch (error) {
        const nextDiagnostics = diagnosticsFromGenerationError(error);
        const retryAtomicRepair =
          attempt === 0 &&
          nextDiagnostics.some((diagnostic) => diagnostic.code === 'NON_ATOMIC_WORKFLOW_HELPER');
        if (!retryAtomicRepair) throw error;
        currentJavascriptSource =
          extractRepairJavascriptCandidate({
            text: response.text,
            failedJavascriptSource: currentJavascriptSource,
            repairFunctionName,
          }) ?? currentJavascriptSource;
        currentDiagnostics = nextDiagnostics;
      }
    }
    throw new DataCommandError('VALIDATION_FAILED', 'Workflow repair attempts exhausted');
  } catch (error) {
    if (error instanceof DataCommandError) throw error;
    throw new DataCommandError(
      'GENERATION_FAILED',
      `Failed to repair generated data task workflow: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function requireGenerationRuntimeConfig(runtimeConfig?: AgentRuntimeConfig): AgentRuntimeConfig {
  if (!runtimeConfig || !normalizeOptionalName(runtimeConfig.model)) {
    throw new DataCommandError(
      'INVALID_ARGUMENT',
      'Model configuration is required to generate a data task. Please select an available model and try again.'
    );
  }
  return runtimeConfig;
}

function buildWorkflowGenerationSystemPrompt(): string {
  return [
    'You convert user requirements into a safe function-oriented JavaScript workflow program for Sophron.',
    'Return only strict JSON. Do not return markdown, comments, explanations, or code fences.',
    'Use only the provided input columns. Do not invent field names.',
    'Do not write Sophron Prep DSL, SQL, imports, loops, mutable variables, async code, classes, dynamic calls, or system/network/file access.',
    'Return {"javascriptSource":"..."}. The program must contain named helper functions and function main().',
    'Use only the fixed bridge API workflow.input(INPUT_TABLE_ID, { alias: "src" }), workflow.step(input, operationType, payload), and workflow.output(input, OUTPUT_TABLE_NAME, { mode: "replace" }). Never call operation-specific functions or fluent receiver chains.',
    'Helper functions receive and return a workflow value. Each helper function must perform exactly one workflow operation and return its result.',
    'main() must compose atomic helpers through named const variables. Keep workflow.step() calls out of main(); main() only creates the input with workflow.input(), invokes helpers, and returns workflow.output().',
    'For repair requests, follow the response schema in the user message exactly. When a function patch is requested, return only that patch; otherwise return the complete corrected javascriptSource.',
    `Allowed workflow steps and canonical payloads: ${getWorkflowJavascriptCapabilityPrompt()}.`,
    'Automation has exactly one input dataset. Never call join, union, intersect, except, setOp, or reference a second input.',
    'Pivot must use exactly one on field, a non-empty fixed values array, and exactly one metric so the saved output schema is deterministic.',
    'Allowed expression APIs: col("field"), lit(value), fn.regexpExtract(expr, pattern), fn.year(expr), fn.month(expr), fn.upper(expr), fn.lower(expr), fn.trim(expr), fn.replace(expr, search, replacement), fn.concat(...exprs).',
    'Allowed comparison methods: eq, neq, gt, gte, lt, lte, contains, notContains, isNull, isNotNull.',
    'Allowed arithmetic methods: add, sub, mul, div.',
    'Column references must use the current field name at that point in the workflow chain. Before a rename, use the original input column name exactly; after a rename, later operations may use the renamed field.',
    "For regex digit matching, prefer '[0-9]+' over '\\\\d+' to avoid escaping ambiguity.",
    'When a regexpExtract pattern contains a capture group and the desired value is that group, provide the group index. Example: fn.regexpExtract(col("date"), "^[0-9]{4}-([0-9]{2})", 1).',
    'For string values, preserve the semantic value only. For example Chinese text like "过滤掉Market为EU的数据" means value "EU", not "EU的数据".',
    'If the user asks to delete, remove, drop, exclude, 去掉, 删除, 移除, 去除, 删掉, 剔除, or 不要 columns, use the drop operation for those columns. Do not express column removal as select-all-except unless the user explicitly asks to keep only a listed set of columns.',
    'For money, prices, rates, percentages, and other fixed-decimal business values, use cast(field, "decimal", { scale: 2 }). Avoid float unless approximate binary floating point is explicitly requested.',
    'When converting text currency such as "$8.34" to a number and the requirement says to remove the leading "$" symbol, call cast(input, field, "decimal", { removePrefix: "$", scale: 2 }).',
    'If the requirement is ambiguous, generate the safest valid operations and include only input columns actually used by the operations in requiredColumns.',
  ].join('\n');
}

function buildWorkflowGenerationUserPrompt(input: {
  inputTableId: string;
  outputTableName: string;
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
  failedJavascriptSource?: string;
  diagnostics?: PrepDiagnostic[];
  repairFunctionName?: string;
}): string {
  return JSON.stringify(
    {
      task: 'Convert the user requirement into standard JavaScript that builds a Sophron data workflow through the provided Workflow SDK.',
      requirement: input.requirement,
      inputColumns: input.columns,
      compilationTarget: {
        inputTableId: input.inputTableId,
        outputTableName: input.outputTableName,
      },
      outputJsonSchema:
        input.failedJavascriptSource && input.repairFunctionName
          ? {
              javascriptPatch: {
                functionName: input.repairFunctionName,
                replacementSource:
                  'one or more complete named function declarations; retain the requested function, optionally add uniquely named atomic helpers, and do not include main unless main is the requested function',
              },
            }
          : {
              javascriptSource:
                'complete standard function-oriented JavaScript with named helpers and main(). Express data operations only through the provided Workflow SDK and use INPUT_TABLE_ID and OUTPUT_TABLE_NAME constants exactly.',
              requiredColumns: [{ name: 'input column referenced by the DSL', type: 'optional' }],
              changeSummary: 'brief user-facing summary of what the workflow changes',
            },
      previousFailedAttempt: input.failedJavascriptSource
        ? {
            failedJavascriptSource: input.failedJavascriptSource,
            diagnostics: (input.diagnostics ?? []).map((diagnostic) => ({
              severity: diagnostic.severity,
              code: diagnostic.code,
              message: diagnostic.message,
              line: diagnostic.line,
              column: diagnostic.column,
              functionName: isRecord(diagnostic) ? diagnostic.functionName : undefined,
            })),
            instruction: input.repairFunctionName
              ? `Repair only ${input.repairFunctionName}. Return javascriptPatch with functionName exactly "${input.repairFunctionName}" and replacementSource containing the corrected function plus only any new atomic helpers it requires. Do not return the complete program or DSL.`
              : 'Return the complete corrected javascriptSource, including every helper and main(). Do not return a partial function or DSL.',
          }
        : undefined,
      examples: [
        {
          requirement: '过滤掉Market为EU的数据',
          javascriptSource:
            'function filterEurope(input) {\n  return workflow.step(input, "filter", { condition: col("Market").neq(lit("EU")) });\n}\n\nfunction main() {\n  const input = workflow.input(INPUT_TABLE_ID, { alias: "src" });\n  const filtered = filterEurope(input);\n  return workflow.output(filtered, OUTPUT_TABLE_NAME, { mode: "replace" });\n}',
          requiredColumns: [{ name: 'Market' }],
        },
        {
          requirement: '按照Sales升序排列，删除记录数',
          javascriptSource:
            'function sortSales(input) {\n  return workflow.step(input, "sort", { column: col("Sales"), direction: "asc" });\n}\n\nfunction removeRecordCount(input) {\n  return workflow.step(input, "drop", { columns: ["记录数"] });\n}\n\nfunction main() {\n  const input = workflow.input(INPUT_TABLE_ID, { alias: "src" });\n  const sorted = sortSales(input);\n  const cleaned = removeRecordCount(sorted);\n  return workflow.output(cleaned, OUTPUT_TABLE_NAME, { mode: "replace" });\n}',
          requiredColumns: [{ name: 'Sales' }, { name: '记录数' }],
        },
      ],
    },
    null,
    2
  );
}

function extractJavascriptSourceFromModelResponse(text: string): string | null {
  try {
    return extractGeneratedJavascriptSource(text);
  } catch {
    return null;
  }
}

function compileRepairResponse({
  text,
  failedJavascriptSource,
  repairFunctionName,
  inputTableId,
  outputTableName,
  requirement,
  columns,
}: {
  text: string;
  failedJavascriptSource: string;
  repairFunctionName?: string;
  inputTableId: string;
  outputTableName: string;
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
}): GeneratedDataTaskWorkflow {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Repair generation response must be valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (isRecord(parsed) && isRecord(parsed.javascriptPatch)) {
    if (!repairFunctionName) {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        'Workflow repair returned a function patch when full JavaScript was required'
      );
    }
    const functionName = parsed.javascriptPatch.functionName;
    const replacementSource = parsed.javascriptPatch.replacementSource;
    if (functionName !== repairFunctionName || typeof replacementSource !== 'string') {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Workflow repair patch must target function ${repairFunctionName} with string replacementSource`
      );
    }
    const patchedSource = applyWorkflowFunctionPatch(
      failedJavascriptSource,
      repairFunctionName,
      replacementSource
    );
    return compileGeneratedJavaScriptWorkflow({
      javascriptSource: patchedSource,
      inputTableId,
      outputTableName,
      requirement,
      columns,
    });
  }
  if (repairFunctionName) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Workflow repair for ${repairFunctionName} must return javascriptPatch, not complete JavaScript`
    );
  }
  return compileGeneratedJavascriptResponse({
    text,
    inputTableId,
    outputTableName,
    requirement,
    columns,
  });
}

function resolveRepairFunctionName(
  javascriptSource: string,
  diagnostics: PrepDiagnostic[]
): string | undefined {
  let functions: Set<string>;
  try {
    functions = new Set(
      compileWorkflowJavaScript(javascriptSource).functions.map((item) => item.name)
    );
  } catch {
    return undefined;
  }
  for (const diagnostic of diagnostics) {
    const functionName = isRecord(diagnostic) ? diagnostic.functionName : undefined;
    if (typeof functionName === 'string' && functions.has(functionName)) return functionName;
  }
  return undefined;
}

function extractRepairJavascriptCandidate({
  text,
  failedJavascriptSource,
  repairFunctionName,
}: {
  text: string;
  failedJavascriptSource: string;
  repairFunctionName?: string;
}): string | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (isRecord(parsed) && isRecord(parsed.javascriptPatch)) {
      const functionName = parsed.javascriptPatch.functionName;
      const replacementSource = parsed.javascriptPatch.replacementSource;
      if (
        repairFunctionName &&
        functionName === repairFunctionName &&
        typeof replacementSource === 'string'
      ) {
        return applyWorkflowFunctionPatch(
          failedJavascriptSource,
          repairFunctionName,
          replacementSource
        );
      }
      return null;
    }
    return repairFunctionName ? null : extractGeneratedJavascriptSource(text);
  } catch {
    return null;
  }
}

function diagnosticsFromGenerationError(error: unknown): PrepDiagnostic[] {
  if (error instanceof DataCommandError) {
    const details = error.details;
    if (
      isRecord(details) &&
      Array.isArray(details.diagnostics) &&
      details.diagnostics.every(isPrepDiagnosticLike)
    ) {
      return details.diagnostics;
    }
    return [{ severity: 'error', code: error.code, message: error.message }];
  }
  return [
    {
      severity: 'error',
      message: error instanceof Error ? error.message : String(error),
    },
  ];
}

function isPrepDiagnosticLike(value: unknown): value is PrepDiagnostic {
  return isRecord(value) && (value.severity === 'error' || value.severity === 'warning');
}

function compileGeneratedJavascriptResponse({
  text,
  inputTableId,
  outputTableName,
  requirement,
  columns,
}: {
  text: string;
  inputTableId: string;
  outputTableName: string;
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
}): GeneratedDataTaskWorkflow {
  const javascriptSource = extractGeneratedJavascriptSource(text);
  return compileGeneratedJavaScriptWorkflow({
    javascriptSource,
    inputTableId,
    outputTableName,
    requirement,
    columns,
  });
}
