import type { AgentRuntimeConfig } from '../../../renderer/types';
import type { PrepDiagnostic } from '../../../shared/prep-dsl';
import { runPiAiOneShot } from '../../claude/claude-sdk-one-shot';
import { DataCommandError } from '../data-command-types';
import { getWorkflowDslQuickReference } from '../data-dsl-reference';
import {
  compileWorkflowJavascriptToIr,
  extractGeneratedWorkflowJavascript,
  workflowJsIrToGeneratedOperations,
} from './js-parser';
import {
  compileGeneratedWorkflowPlan,
  getGeneratedWorkflowOperationPromptSpecs,
  type GeneratedWorkflowGenerationResult,
} from './operation-compiler';
import {
  parseGeneratedWorkflowDslResponse,
  reconcileGeneratedWorkflowWithDslInference,
  validateCompiledWorkflowDsl,
} from './schema-inferencer';
import { extractJsonObject, isRecord } from './utils';

export const GENERATED_WORKFLOW_CONFIG_REPAIR_ATTEMPTS = 2;
const DIRECT_DSL_GENERATION_FALLBACK_ENV = 'SOPHRON_ENABLE_DIRECT_DSL_GENERATION';

function isDirectDslGenerationFallbackEnabled(): boolean {
  const value = process.env[DIRECT_DSL_GENERATION_FALLBACK_ENV];
  return value === '1' || value?.toLowerCase() === 'true';
}

function normalizeOptionalName(name: string | undefined): string | undefined {
  const normalized = name?.trim();
  return normalized || undefined;
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

export async function generateWorkflowDslFromRequirement({
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
}): Promise<GeneratedWorkflowGenerationResult> {
  const config = requireGenerationRuntimeConfig(runtimeConfig);
  try {
    const response = await runPiAiOneShot(
      buildWorkflowDslGenerationUserPrompt({
        inputTableId,
        outputTableName,
        requirement,
        columns,
      }),
      buildWorkflowDslGenerationSystemPrompt(),
      config,
      { temperature: 0, maxTokens: 4_000 }
    );
    try {
      return parseGeneratedWorkflowJsResponse({
        text: response.text,
        inputTableId,
        outputTableName,
        requirement,
        columns,
      });
    } catch (parseError) {
      try {
        return parseGeneratedWorkflowPlanResponse({
          text: response.text,
          inputTableId,
          outputTableName,
          requirement,
          columns,
        });
      } catch (jsonParseError) {
        if (isUnsupportedGeneratedWorkflowOperationError(jsonParseError)) {
          if (!isDirectDslGenerationFallbackEnabled()) {
            throw jsonParseError;
          }
          return await generateAdvancedWorkflowDslFromPlan({
            inputTableId,
            outputTableName,
            requirement,
            columns,
            runtimeConfig,
            generatedPlanText: response.text,
            diagnostics: diagnosticsFromGenerationError(jsonParseError),
          });
        }
      }
      const failedWorkflowDsl = extractWorkflowDslFromModelResponse(response.text) ?? response.text;
      return await repairWorkflowDslFromDiagnostics({
        inputTableId,
        outputTableName,
        requirement,
        columns,
        runtimeConfig,
        failedWorkflowDsl,
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

export async function repairWorkflowDslFromDiagnostics({
  inputTableId,
  outputTableName,
  requirement,
  columns,
  runtimeConfig,
  failedWorkflowDsl,
  diagnostics,
}: {
  inputTableId: string;
  outputTableName: string;
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
  runtimeConfig?: AgentRuntimeConfig;
  failedWorkflowDsl: string;
  diagnostics: PrepDiagnostic[];
}): Promise<GeneratedWorkflowGenerationResult> {
  const config = requireGenerationRuntimeConfig(runtimeConfig);
  try {
    const response = await runPiAiOneShot(
      buildWorkflowDslGenerationUserPrompt({
        inputTableId,
        outputTableName,
        requirement,
        columns,
        failedWorkflowDsl,
        diagnostics,
      }),
      buildWorkflowDslGenerationSystemPrompt(),
      config,
      { temperature: 0, maxTokens: 4_000 }
    );
    return parseRepairWorkflowResponse({
      text: response.text,
      inputTableId,
      outputTableName,
      requirement,
      columns,
    });
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

async function generateAdvancedWorkflowDslFromPlan({
  inputTableId,
  outputTableName,
  requirement,
  columns,
  runtimeConfig,
  generatedPlanText,
  diagnostics,
}: {
  inputTableId: string;
  outputTableName: string;
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
  runtimeConfig?: AgentRuntimeConfig;
  generatedPlanText: string;
  diagnostics: PrepDiagnostic[];
}): Promise<GeneratedWorkflowGenerationResult> {
  const config = requireGenerationRuntimeConfig(runtimeConfig);
  try {
    const response = await runPiAiOneShot(
      buildAdvancedWorkflowDslGenerationUserPrompt({
        inputTableId,
        outputTableName,
        requirement,
        columns,
        generatedPlanText,
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

function buildWorkflowDslGenerationSystemPrompt(): string {
  return [
    'You convert user requirements into restricted JavaScript workflow API code for Sophron.',
    'Return only strict JSON. Do not return markdown, comments, explanations, or code fences.',
    'Use only the provided input columns. Do not invent field names.',
    'Do not write Sophron Prep DSL, SQL, imports, loops, variables, async code, or arbitrary JavaScript.',
    'Return {"workflowJs":"..."} where workflowJs is a single chain beginning with workflow() and ending with outputTable(OUTPUT_TABLE_NAME, { mode: "replace" }).',
    'Allowed workflow methods: inputDataset(INPUT_TABLE_ID, "src"), filter(expr), sort(col("field"), "asc|desc"), drop("field" or ["field"]), select(["field"]), rename("source", "target"), derive("field", expr), cast("field", "text|integer|float|decimal|date|datetime|boolean", options), aggregate({ groupBy: [col("field")], metrics: [metric.sum(col("field")).as("alias"), metric.count().as("alias")] }), outputTable(OUTPUT_TABLE_NAME, { mode: "replace" }).',
    'Allowed expression APIs: col("field"), lit(value), fn.regexpExtract(expr, pattern), fn.upper(expr), fn.lower(expr), fn.trim(expr), fn.replace(expr, search, replacement), fn.concat(...exprs).',
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
  generatedPlanText: string;
  diagnostics: PrepDiagnostic[];
}): string {
  return JSON.stringify(
    {
      task: 'Generate an advanced Sophron Prep DSL workflow from a previously generated structured plan that the stable compiler could not compile.',
      requirement: input.requirement,
      inputColumns: input.columns,
      requiredDslLines: {
        first: `input source dataset "${input.inputTableId}" as src`,
        last: `output table "${input.outputTableName}" mode replace`,
      },
      previousGeneratedPlanJson: safeParseJsonForPrompt(input.generatedPlanText),
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

function safeParseJsonForPrompt(text: string): unknown {
  try {
    return JSON.parse(extractJsonObject(text));
  } catch {
    return text;
  }
}

function buildWorkflowDslGenerationUserPrompt(input: {
  inputTableId: string;
  outputTableName: string;
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
  failedWorkflowDsl?: string;
  diagnostics?: PrepDiagnostic[];
}): string {
  return JSON.stringify(
    {
      task: 'Convert the user requirement into a structured Sophron data transform plan.',
      requirement: input.requirement,
      inputColumns: input.columns,
      compilationTarget: {
        inputTableId: input.inputTableId,
        outputTableName: input.outputTableName,
      },
      supportedOperations: getGeneratedWorkflowOperationPromptSpecs(),
      outputJsonSchema: {
        workflowJs:
          'single restricted JavaScript workflow API chain. Use INPUT_TABLE_ID and OUTPUT_TABLE_NAME constants exactly.',
        requiredColumns: [{ name: 'input column referenced by the DSL', type: 'optional' }],
        changeSummary: 'brief user-facing summary of what the workflow changes',
      },
      previousFailedAttempt: input.failedWorkflowDsl
        ? {
            compiledWorkflowDsl: input.failedWorkflowDsl,
            diagnostics: (input.diagnostics ?? []).map((diagnostic) => ({
              severity: diagnostic.severity,
              code: diagnostic.code,
              message: diagnostic.message,
              line: diagnostic.line,
              column: diagnostic.column,
            })),
            instruction: 'Return corrected workflowJs. Do not return DSL.',
          }
        : undefined,
      examples: [
        {
          requirement: '过滤掉Market为EU的数据',
          workflowJs:
            'workflow().inputDataset(INPUT_TABLE_ID, "src").filter(col("Market").neq(lit("EU"))).outputTable(OUTPUT_TABLE_NAME, { mode: "replace" })',
          requiredColumns: [{ name: 'Market' }],
        },
        {
          requirement: '按照Sales升序排列，删除记录数',
          workflowJs:
            'workflow().inputDataset(INPUT_TABLE_ID, "src").sort(col("Sales"), "asc").drop("记录数").outputTable(OUTPUT_TABLE_NAME, { mode: "replace" })',
          requiredColumns: [{ name: 'Sales' }, { name: '记录数' }],
        },
      ],
    },
    null,
    2
  );
}

function extractWorkflowDslFromModelResponse(text: string): string | null {
  try {
    const parsed = JSON.parse(extractJsonObject(text)) as unknown;
    if (isRecord(parsed) && typeof parsed.workflowDsl === 'string' && parsed.workflowDsl.trim()) {
      return parsed.workflowDsl.trim();
    }
  } catch {
    return null;
  }
  return null;
}

function parseRepairWorkflowResponse({
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
}): GeneratedWorkflowGenerationResult {
  const errors: string[] = [];
  try {
    return parseGeneratedWorkflowJsResponse({
      text,
      inputTableId,
      outputTableName,
      requirement,
      columns,
    });
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  try {
    return parseGeneratedWorkflowPlanResponse({
      text,
      inputTableId,
      outputTableName,
      requirement,
      columns,
    });
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  const workflowDsl = extractWorkflowDslFromModelResponse(text);
  if (workflowDsl) {
    return parseGeneratedWorkflowDslResponse(JSON.stringify({ workflowDsl }), columns);
  }

  throw new DataCommandError(
    'VALIDATION_FAILED',
    `Repair generation response must include workflowJs. Parser errors: ${errors.join('; ')}`
  );
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

function isUnsupportedGeneratedWorkflowOperationError(error: unknown): boolean {
  return (
    error instanceof DataCommandError &&
    error.code === 'VALIDATION_FAILED' &&
    error.message.includes('uses unsupported operation')
  );
}

function parseGeneratedWorkflowJsResponse({
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
}): GeneratedWorkflowGenerationResult {
  const workflowJs = extractGeneratedWorkflowJavascript(text);
  const ir = compileWorkflowJavascriptToIr(workflowJs);
  const operations = workflowJsIrToGeneratedOperations(ir);
  const compiled = compileGeneratedWorkflowPlan({
    operations,
    inputTableId,
    outputTableName,
    requirement,
    columns,
  });
  return reconcileGeneratedWorkflowWithDslInference(compiled, columns);
}

function parseGeneratedWorkflowPlanResponse({
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
}): GeneratedWorkflowGenerationResult {
  const parsed = JSON.parse(extractJsonObject(text)) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.operations)) {
    throw new Error('Workflow plan generation response must include operations');
  }
  const compiled = compileGeneratedWorkflowPlan({
    operations: parsed.operations,
    inputTableId,
    outputTableName,
    requirement,
    columns,
  });
  return validateCompiledWorkflowDsl(compiled, columns);
}
