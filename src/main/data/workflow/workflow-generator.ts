import type { AgentRuntimeConfig } from '../../../renderer/types';
import type { PrepDiagnostic } from '../../../shared/prep-dsl';
import { runPiAiOneShot } from '../../claude/claude-sdk-one-shot';
import { DataCommandError } from '../data-command-types';
import { getWorkflowDslQuickReference } from '../data-dsl-reference';
import {
  applyJavascriptFunctionPatch,
  compileJavascriptWorkflowToIr,
} from './javascript-workflow-compiler';
import { getWorkflowJavascriptCapabilityPrompt } from './javascript-capabilities';
import { compileGeneratedWorkflowIr, type GeneratedDataTaskWorkflow } from './operation-compiler';
import {
  parseGeneratedWorkflowDslResponse,
  reconcileGeneratedWorkflowWithDslInference,
} from './schema-inferencer';
import { extractJsonObject, isRecord } from './utils';

export const GENERATED_WORKFLOW_REPAIR_ATTEMPTS = 2;
const DIRECT_DSL_GENERATION_FALLBACK_ENV = 'SOPHRON_ENABLE_DIRECT_DSL_GENERATION';

function isDirectDslGenerationFallbackEnabled(): boolean {
  const value = process.env[DIRECT_DSL_GENERATION_FALLBACK_ENV];
  return value === '1' || value?.toLowerCase() === 'true';
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
      if (isDirectDslGenerationFallbackEnabled()) {
        return await generateAdvancedWorkflowDslFromFailedJavascript({
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
      const response = await runPiAiOneShot(
        buildWorkflowGenerationUserPrompt({
          inputTableId,
          outputTableName,
          requirement,
          columns,
          failedJavascriptSource: currentJavascriptSource,
          diagnostics: currentDiagnostics,
        }),
        buildWorkflowGenerationSystemPrompt(),
        config,
        { temperature: 0, maxTokens: 4_000 }
      );
      try {
        return compileRepairResponse({
          text: response.text,
          failedJavascriptSource: currentJavascriptSource,
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
          extractRepairJavascriptCandidate(response.text, currentJavascriptSource) ??
          currentJavascriptSource;
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

async function generateAdvancedWorkflowDslFromFailedJavascript({
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
    const response = await runPiAiOneShot(
      buildAdvancedWorkflowDslGenerationUserPrompt({
        inputTableId,
        outputTableName,
        requirement,
        columns,
        failedJavascriptSource,
        diagnostics,
      }),
      buildAdvancedWorkflowDslGenerationSystemPrompt(),
      config,
      { temperature: 0, maxTokens: 6_000 }
    );
    return parseGeneratedWorkflowDslResponse(response.text, columns);
  } catch (error) {
    if (error instanceof DataCommandError) throw error;
    throw new DataCommandError(
      'GENERATION_FAILED',
      `Failed to generate advanced data task workflow: ${
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
    'Helper functions receive and return a workflow value. main() creates the input with workflow().inputDataset(INPUT_TABLE_ID, "src"), composes helpers using const variables, and returns outputTable(OUTPUT_TABLE_NAME, { mode: "replace" }).',
    'Each helper function must perform exactly one workflow operation and return its result. Never chain multiple workflow methods inside one helper.',
    'main() must compose atomic helpers through named const variables. Keep data-processing operations out of main(); main() only creates the input, invokes helpers, and returns outputTable().',
    'For a repair request naming one failed function, return {"javascriptPatch":{"functionName":"...","replacement":"replacement source"}} instead of regenerating unaffected functions. The replacement must retain the named function and may also declare new uniquely named atomic helpers when splitting it is necessary; never include main in a helper patch.',
    `Allowed data-processing methods: ${getWorkflowJavascriptCapabilityPrompt()}.`,
    'Method signatures: filter(expr), sort(col("field"), "asc|desc"), drop("field" or ["field"]), select(["field"]), rename("source", "target"), derive("field", expr), cast("field", "text|integer|float|decimal|date|datetime|boolean", options), aggregate({ groupBy: [col("field")], metrics: [metric.sum(col("field")).as("alias"), metric.count().as("alias")] }).',
    'Single-input extended methods: deduplicate({ by?: ["field"], keep?: "first|last", orderBy?: [{ field, direction, nulls? }] }), handleMissing({ strategy: "drop_empty_rows" } or { rules: [{ column, method: "skip|drop|nullify_values|literal_fill", value?, values? }] }), limit(number or { count, unit?: "rows|percent", offset? }), top(count, [{ field, direction, nulls? }]), unpivot({ columns or except, nameColumn, valueColumn, includeNulls? }), unnest({ sourceKind: "list|json", column, alias, path?, withIndex?, recursive?, maxDepth?, keepParentNames? }), pivot({ on: ["field"], values: [fixed literals], using: [{ function, expression, alias }], groupBy?: ["field"] }).',
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
    'When converting text currency such as "$8.34" to a number and the requirement says to remove the leading "$" symbol, call cast(field, "decimal", { removePrefix: "$", scale: 2 }).',
    'If the requirement is ambiguous, generate the safest valid operations and include only input columns actually used by the operations in requiredColumns.',
  ].join('\n');
}

function buildAdvancedWorkflowDslGenerationSystemPrompt(): string {
  return [
    'You generate advanced Sophron Prep DSL only when the stable operation compiler cannot express the user requirement.',
    'Return only strict JSON. Do not return markdown, comments, explanations, or code fences.',
    'Use only the provided input columns. Do not invent field names.',
    'This is an explicitly enabled fallback from failed javascriptSource generation. Do not produce or consume JSON operation plans.',
    'The workflowDsl must start with the provided input source dataset line and end with the provided output table line.',
    'If a field name contains spaces or special characters, reference it as [`field name`].',
    'In expressions, reference fields with [field] or [`field name`]. Never use bare SQL identifier syntax such as `field name` or "field name".',
    'Prefer deterministic, readable Prep DSL. Do not use SQL syntax unless the Prep DSL reference explicitly supports it.',
  ].join('\n');
}

function buildAdvancedWorkflowDslGenerationUserPrompt(input: {
  inputTableId: string;
  outputTableName: string;
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
  failedJavascriptSource: string;
  diagnostics: PrepDiagnostic[];
}): string {
  return JSON.stringify(
    {
      task: 'Generate an advanced Sophron Prep DSL workflow only because the generated JavaScript source could not be parsed or compiled.',
      requirement: input.requirement,
      inputColumns: input.columns,
      requiredDslLines: {
        first: `input source dataset "${input.inputTableId}" as src`,
        last: `output table "${input.outputTableName}" mode replace`,
      },
      failedJavascriptSource: input.failedJavascriptSource,
      previousDiagnostics: input.diagnostics.map((diagnostic) => ({
        severity: diagnostic.severity,
        code: diagnostic.code,
        message: diagnostic.message,
        line: diagnostic.line,
        column: diagnostic.column,
      })),
      dslReference: getWorkflowDslQuickReference(),
      outputJsonSchema: {
        workflowDsl: 'complete multiline Prep DSL string',
        requiredColumns: [{ name: 'input column referenced by the DSL', type: 'optional' }],
        explanation: 'brief explanation of why advanced DSL was needed',
      },
    },
    null,
    2
  );
}

function buildWorkflowGenerationUserPrompt(input: {
  inputTableId: string;
  outputTableName: string;
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
  failedJavascriptSource?: string;
  diagnostics?: PrepDiagnostic[];
}): string {
  return JSON.stringify(
    {
      task: 'Convert the user requirement into restricted JavaScript source for a Sophron data transform.',
      requirement: input.requirement,
      inputColumns: input.columns,
      compilationTarget: {
        inputTableId: input.inputTableId,
        outputTableName: input.outputTableName,
      },
      outputJsonSchema: {
        javascriptSource:
          'function-oriented restricted JavaScript program with named helpers and main(). Use INPUT_TABLE_ID and OUTPUT_TABLE_NAME constants exactly.',
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
            instruction:
              'If a diagnostic names one helper function, return javascriptPatch whose replacement retains that function. The replacement may additionally declare new uniquely named atomic helpers when the failed function must be split; keep the named function as an orchestration wrapper and do not include main. If no helper function is named (including NON_ATOMIC_WORKFLOW_HELPER), return complete corrected javascriptSource with main(). Do not return DSL.',
          }
        : undefined,
      examples: [
        {
          requirement: '过滤掉Market为EU的数据',
          javascriptSource:
            'function filterEurope(input) {\n  return input.filter(col("Market").neq(lit("EU")));\n}\n\nfunction main() {\n  const input = workflow().inputDataset(INPUT_TABLE_ID, "src");\n  const filtered = filterEurope(input);\n  return filtered.outputTable(OUTPUT_TABLE_NAME, { mode: "replace" });\n}',
          requiredColumns: [{ name: 'Market' }],
        },
        {
          requirement: '按照Sales升序排列，删除记录数',
          javascriptSource:
            'function sortSales(input) {\n  return input.sort(col("Sales"), "asc");\n}\n\nfunction removeRecordCount(input) {\n  return input.drop("记录数");\n}\n\nfunction main() {\n  const input = workflow().inputDataset(INPUT_TABLE_ID, "src");\n  const sorted = sortSales(input);\n  const cleaned = removeRecordCount(sorted);\n  return cleaned.outputTable(OUTPUT_TABLE_NAME, { mode: "replace" });\n}',
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
  inputTableId,
  outputTableName,
  requirement,
  columns,
}: {
  text: string;
  failedJavascriptSource: string;
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
    const functionName = parsed.javascriptPatch.functionName;
    const replacement = parsed.javascriptPatch.replacement;
    if (typeof functionName !== 'string' || typeof replacement !== 'string') {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        'Repair javascriptPatch must include string functionName and replacement'
      );
    }
    const patched = applyJavascriptFunctionPatch(failedJavascriptSource, functionName, replacement);
    return compileGeneratedJavascriptResponse({
      text: JSON.stringify({ javascriptSource: patched }),
      inputTableId,
      outputTableName,
      requirement,
      columns,
    });
  }

  const workflowDsl = extractWorkflowDslFromModelResponse(text);
  if (workflowDsl && isDirectDslGenerationFallbackEnabled()) {
    return parseGeneratedWorkflowDslResponse(JSON.stringify({ workflowDsl }), columns);
  }

  return compileGeneratedJavascriptResponse({
    text,
    inputTableId,
    outputTableName,
    requirement,
    columns,
  });
}

function extractRepairJavascriptCandidate(
  text: string,
  failedJavascriptSource: string
): string | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (isRecord(parsed) && isRecord(parsed.javascriptPatch)) {
      const functionName = parsed.javascriptPatch.functionName;
      const replacement = parsed.javascriptPatch.replacement;
      if (typeof functionName === 'string' && typeof replacement === 'string') {
        return applyJavascriptFunctionPatch(failedJavascriptSource, functionName, replacement);
      }
    }
    return extractGeneratedJavascriptSource(text);
  } catch {
    return null;
  }
}

function extractWorkflowDslFromModelResponse(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (isRecord(parsed) && typeof parsed.workflowDsl === 'string' && parsed.workflowDsl.trim()) {
      return parsed.workflowDsl.trim();
    }
  } catch {
    return null;
  }
  return null;
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
  const ir = compileJavascriptWorkflowToIr(javascriptSource, { enforceAtomicHelpers: true });
  const compiled = compileGeneratedWorkflowIr({
    ir,
    inputTableId,
    outputTableName,
    requirement,
    columns,
  });
  return {
    ...reconcileGeneratedWorkflowWithDslInference(compiled, columns),
    javascriptSource,
  };
}
