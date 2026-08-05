import type { AgentRuntimeConfig } from '../../../renderer/types';
import type { PrepDiagnostic } from '../../../shared/prep-dsl';
import { runPiAiOneShot, type PiAiOneShotResult } from '../../claude/claude-sdk-one-shot';
import { DataCommandError } from '../data-command-types';
import workflowGenerationSystemPrompt from './prompts/workflow-generation-system.txt?raw';
import {
  applyWorkflowFunctionPatch,
  compileWorkflowJavaScript,
  createWorkflowFunctionPatchCandidate,
  executeWorkflowJavaScriptInSandbox,
  indexJavaScriptFunctions,
  indexJavaScriptFunctionsBestEffort,
} from './javascript-runtime';
import { getWorkflowJavascriptCapabilityPrompt } from './workflow-ir-operation-registry';
import { getWorkflowExpressionCapabilityPrompt } from './workflow-expression-registry';
import {
  lowerGeneratedWorkflowIrSemantics,
  type GeneratedDataTaskWorkflow,
} from './workflow-ir-lowerer';
import { AI_PREP_DSL_RUNTIME_PROFILE_VERSION } from './prep-dsl-capability-profile';
import {
  claimWorkflowRepairAttempt,
  contextualizeWorkflowError,
  createWorkflowRepairBudget,
  isWorkflowDiagnosticRepairable,
  normalizeWorkflowFailureDiagnostics,
  workflowCommandCodeForDiagnostics,
  workflowDiagnosticsFromError,
  workflowRepairIncidentKey,
  workflowRepairStageForDiagnostics,
  type WorkflowRepairBudget,
  type WorkflowRepairBudgetConfig,
  type WorkflowRepairStrategy,
} from './workflow-failure';
import { computeWorkflowIrSemanticHash } from './workflow-ir';
import { extractJsonObject, isRecord } from './utils';

export const GENERATED_WORKFLOW_REPAIR_ATTEMPTS = 5;
export const GENERATED_WORKFLOW_REPAIR_POLICY: WorkflowRepairBudgetConfig = {
  maxAttempts: GENERATED_WORKFLOW_REPAIR_ATTEMPTS,
  maxAttemptsPerStage: {
    source: 2,
    semantic: 2,
    execution: 2,
  },
  maxAttemptsPerIncident: 2,
  maxReservedOutputTokens: 15_000,
};

const FUNCTION_PATCH_MAX_TOKENS = 1_200;
const FULL_REGENERATION_MAX_TOKENS = 3_000;

export interface WorkflowModelUsageEvent {
  phase: 'initial_generation' | 'repair';
  repairStrategy?: WorkflowRepairStrategy;
  attempt?: number;
  functionName?: string;
  failureStage?: string;
  errorCode?: string;
  operationType?: string;
  repairOutcome?: WorkflowRepairOutcome;
  result: PiAiOneShotResult;
}

export type WorkflowModelUsageObserver = (event: WorkflowModelUsageEvent) => void;
/**
 * Outcome at the validation frontier reached by one model repair call.
 * `escalated` means the candidate could not be accepted at that frontier and another
 * repair attempt (or the caller's broader validation/recovery path) is required.
 */
export type WorkflowRepairOutcome = 'success' | 'same_incident' | 'regressed' | 'escalated';

export function createGeneratedWorkflowRepairBudget(): WorkflowRepairBudget {
  return createWorkflowRepairBudget(GENERATED_WORKFLOW_REPAIR_POLICY);
}

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
  let compiled: ReturnType<typeof compileWorkflowJavaScript>;
  try {
    compiled = compileWorkflowJavaScript(javascriptSource, { columns });
  } catch (error) {
    throw contextualizeWorkflowError(error, {
      failureStage: 'javascript_compile',
      commandErrorCode: 'VALIDATION_FAILED',
    });
  }

  let ir: ReturnType<typeof executeWorkflowJavaScriptInSandbox>;
  let verificationIr: ReturnType<typeof executeWorkflowJavaScriptInSandbox>;
  try {
    ir = executeWorkflowJavaScriptInSandbox({ compiled, inputTableId, outputTableName });
    verificationIr = executeWorkflowJavaScriptInSandbox({
      compiled,
      inputTableId,
      outputTableName,
    });
  } catch (error) {
    throw contextualizeWorkflowError(error, {
      failureStage: 'sandbox_execution',
      commandErrorCode: 'RUN_FAILED',
    });
  }

  try {
    if (computeWorkflowIrSemanticHash(ir) !== computeWorkflowIrSemanticHash(verificationIr)) {
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
  } catch (error) {
    throw contextualizeWorkflowError(error, {
      failureStage: 'ir_validation',
      commandErrorCode: 'VALIDATION_FAILED',
    });
  }

  try {
    const semantics = lowerGeneratedWorkflowIrSemantics({ ir, requirement, columns });
    return {
      ...semantics,
      runtimeCompatibilityProfileVersion: AI_PREP_DSL_RUNTIME_PROFILE_VERSION,
      workflowIrSemanticHash: computeWorkflowIrSemanticHash(semantics.workflowIr),
      javascriptSource,
    };
  } catch (error) {
    throw contextualizeWorkflowError(error, {
      failureStage: 'workflow_lowering',
      commandErrorCode: 'VALIDATION_FAILED',
    });
  }
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
  const firstFunctionIndex = candidate.search(/\bfunction\s+[$A-Z_a-z][$\w]*\s*\(/);
  if (mainIndex >= 0 && firstFunctionIndex >= 0 && firstFunctionIndex <= mainIndex) {
    return candidate.slice(firstFunctionIndex).trim();
  }
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
  repairBudget,
  onModelUsage,
}: {
  inputTableId: string;
  outputTableName: string;
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
  runtimeConfig?: AgentRuntimeConfig;
  repairBudget?: WorkflowRepairBudget;
  onModelUsage?: WorkflowModelUsageObserver;
}): Promise<GeneratedDataTaskWorkflow> {
  const config = requireGenerationRuntimeConfig(runtimeConfig);
  const sharedRepairBudget = repairBudget ?? createGeneratedWorkflowRepairBudget();
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
    onModelUsage?.({ phase: 'initial_generation', result: response });
    if (response.stopReason === 'length') {
      return await repairGeneratedWorkflowFromDiagnostics({
        inputTableId,
        outputTableName,
        requirement,
        columns,
        runtimeConfig,
        failedJavascriptSource:
          extractJavascriptSourceFromModelResponse(response.text) ?? response.text,
        diagnostics: createModelOutputTruncatedDiagnostics(),
        repairBudget: sharedRepairBudget,
        onModelUsage,
      });
    }
    try {
      return compileGeneratedJavascriptResponse({
        text: response.text,
        inputTableId,
        outputTableName,
        requirement,
        columns,
      });
    } catch (parseError) {
      const generationError = contextualizeWorkflowError(parseError, {
        failureStage: 'generation_response',
        commandErrorCode: 'VALIDATION_FAILED',
      });
      const diagnostics = workflowDiagnosticsFromError(generationError, {
        failureStage: 'generation_response',
        commandErrorCode: generationError.code,
      });
      if (!diagnostics.every(isWorkflowDiagnosticRepairable)) throw generationError;
      return await repairGeneratedWorkflowFromDiagnostics({
        inputTableId,
        outputTableName,
        requirement,
        columns,
        runtimeConfig,
        failedJavascriptSource:
          extractJavascriptSourceFromModelResponse(response.text) ?? response.text,
        diagnostics,
        repairBudget: sharedRepairBudget,
        onModelUsage,
      });
    }
  } catch (error) {
    if (error instanceof DataCommandError) throw error;
    throw contextualizeWorkflowError(error, {
      failureStage: 'generation_response',
      commandErrorCode: 'GENERATION_FAILED',
      repairClass: 'none',
    });
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
  repairBudget,
  onModelUsage,
}: {
  inputTableId: string;
  outputTableName: string;
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
  runtimeConfig?: AgentRuntimeConfig;
  failedJavascriptSource: string;
  diagnostics: PrepDiagnostic[];
  repairBudget?: WorkflowRepairBudget;
  onModelUsage?: WorkflowModelUsageObserver;
}): Promise<GeneratedDataTaskWorkflow> {
  const config = requireGenerationRuntimeConfig(runtimeConfig);
  const sharedRepairBudget = repairBudget ?? createGeneratedWorkflowRepairBudget();
  try {
    let currentJavascriptSource = failedJavascriptSource;
    let currentDiagnostics = diagnostics;
    let forceFullRegeneration = false;
    let duplicateRewrite = false;
    for (;;) {
      if (!currentDiagnostics.every(isWorkflowDiagnosticRepairable)) {
        throw workflowRepairStoppedError('not_repairable', currentDiagnostics);
      }
      const scopedRepairFunctionName = resolveRepairFunctionName(
        currentJavascriptSource,
        currentDiagnostics
      );
      const repairFunctionName =
        forceFullRegeneration || duplicateRewrite ? undefined : scopedRepairFunctionName;
      const repairStrategy: WorkflowRepairStrategy = duplicateRewrite
        ? 'duplicate_rewrite'
        : repairFunctionName
          ? 'function_patch'
          : 'full_regeneration';
      const maxOutputTokens = repairMaxOutputTokens(repairStrategy);
      const claim = claimWorkflowRepairAttempt({
        budget: sharedRepairBudget,
        javascriptSource: currentJavascriptSource,
        diagnostics: currentDiagnostics,
        repairFunctionName,
        strategy: repairStrategy,
        stage: workflowRepairStageForDiagnostics(currentDiagnostics),
        maxOutputTokens,
      });
      if (!claim.accepted) {
        if (
          claim.reason === 'duplicate' &&
          sharedRepairBudget.attemptsUsed < sharedRepairBudget.maxAttempts
        ) {
          if (repairStrategy === 'function_patch') {
            forceFullRegeneration = true;
            duplicateRewrite = false;
            continue;
          }
          if (repairStrategy === 'full_regeneration') {
            forceFullRegeneration = true;
            duplicateRewrite = true;
            continue;
          }
        }
        throw workflowRepairStoppedError(claim.reason, currentDiagnostics);
      }
      const response = await runPiAiOneShot(
        buildWorkflowGenerationUserPrompt({
          inputTableId,
          outputTableName,
          requirement,
          columns,
          failedJavascriptSource: currentJavascriptSource,
          diagnostics: currentDiagnostics,
          repairFunctionName,
          repairStrategy,
        }),
        buildWorkflowGenerationSystemPrompt(),
        config,
        { temperature: 0, maxTokens: maxOutputTokens }
      );
      const recordRepairUsage = (repairOutcome: WorkflowRepairOutcome): void => {
        onModelUsage?.({
          phase: 'repair',
          repairStrategy,
          attempt: claim.attempt,
          functionName:
            repairFunctionName ?? errorDiagnosticString(currentDiagnostics, 'functionName'),
          failureStage: errorDiagnosticString(currentDiagnostics, 'failureStage'),
          errorCode: errorDiagnosticString(currentDiagnostics, 'code'),
          operationType: errorDiagnosticString(currentDiagnostics, 'operationType'),
          repairOutcome,
          result: response,
        });
      };
      if (response.stopReason === 'length') {
        recordRepairUsage('escalated');
        currentDiagnostics = createModelOutputTruncatedDiagnostics();
        forceFullRegeneration = true;
        duplicateRewrite = false;
        continue;
      }
      try {
        const repairedWorkflow = compileRepairResponse({
          text: response.text,
          failedJavascriptSource: currentJavascriptSource,
          repairFunctionName,
          inputTableId,
          outputTableName,
          requirement,
          columns,
        });
        recordRepairUsage('success');
        return repairedWorkflow;
      } catch (error) {
        const repairError = contextualizeWorkflowError(error, {
          failureStage: 'generation_response',
          commandErrorCode: 'VALIDATION_FAILED',
        });
        const nextDiagnostics = workflowDiagnosticsFromError(repairError, {
          failureStage: 'generation_response',
          commandErrorCode: repairError.code,
        });
        if (!nextDiagnostics.every(isWorkflowDiagnosticRepairable)) {
          recordRepairUsage('escalated');
          throw repairError;
        }
        const nextJavascriptSource = extractRepairJavascriptCandidate({
          text: response.text,
          failedJavascriptSource: currentJavascriptSource,
          repairFunctionName,
        });
        if (!nextJavascriptSource) {
          recordRepairUsage('escalated');
          throw repairError;
        }
        const regressed =
          diagnosticProgressRank(nextDiagnostics) < diagnosticProgressRank(currentDiagnostics);
        const repeatedIncident =
          workflowRepairIncidentKey(nextDiagnostics) ===
          workflowRepairIncidentKey(currentDiagnostics);
        if (!regressed && !repeatedIncident) {
          recordRepairUsage('escalated');
          currentJavascriptSource = nextJavascriptSource;
          currentDiagnostics = nextDiagnostics;
          forceFullRegeneration = false;
          duplicateRewrite = false;
          continue;
        }
        recordRepairUsage(regressed ? 'regressed' : 'same_incident');
        // Keep the last candidate that reached the current validation frontier. A repair
        // that regresses to an earlier stage or repeats the same root cause must not become
        // the baseline for the next model call.
        if (repairFunctionName) {
          forceFullRegeneration = true;
          duplicateRewrite = false;
        } else if (repairStrategy === 'full_regeneration') {
          forceFullRegeneration = true;
          duplicateRewrite = true;
        }
      }
    }
  } catch (error) {
    if (error instanceof DataCommandError) throw error;
    throw contextualizeWorkflowError(error, {
      failureStage: 'generation_response',
      commandErrorCode: 'GENERATION_FAILED',
      repairClass: 'none',
    });
  }
}

function errorDiagnosticString(diagnostics: PrepDiagnostic[], field: string): string | undefined {
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity !== 'error') continue;
    const value = (diagnostic as PrepDiagnostic & Record<string, unknown>)[field];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function repairMaxOutputTokens(strategy: WorkflowRepairStrategy): number {
  return strategy === 'function_patch' ? FUNCTION_PATCH_MAX_TOKENS : FULL_REGENERATION_MAX_TOKENS;
}

function diagnosticProgressRank(diagnostics: PrepDiagnostic[]): number {
  const stage = diagnostics
    .filter((diagnostic) => diagnostic.severity === 'error')
    .map((diagnostic) => (diagnostic as PrepDiagnostic & Record<string, unknown>).failureStage)
    .find((value): value is string => typeof value === 'string');
  switch (stage) {
    case 'generation_response':
      return 0;
    case 'javascript_compile':
      return 1;
    case 'sandbox_execution':
      return 2;
    case 'ir_validation':
      return 3;
    case 'workflow_lowering':
      return 4;
    case 'generation_contract':
      return 5;
    case 'dsl_compile':
      return 6;
    case 'node_validation':
      return 7;
    case 'node_execution':
      return 8;
    case 'output_validation':
      return 9;
    default:
      return 0;
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

function createModelOutputTruncatedDiagnostics(): PrepDiagnostic[] {
  return normalizeWorkflowFailureDiagnostics(
    [
      {
        severity: 'error',
        code: 'MODEL_OUTPUT_TRUNCATED',
        message: 'The model response reached its output token limit before generation completed',
      },
    ],
    {
      failureStage: 'generation_response',
      commandErrorCode: 'VALIDATION_FAILED',
      repairClass: 'full_regeneration',
    }
  ).map((diagnostic) => ({
    ...diagnostic,
    repairHint:
      'Return a shorter complete JavaScript program. Keep helpers concise, include main(), and close every JSON string, delimiter, and function body.',
  }));
}

function buildWorkflowGenerationSystemPrompt(): string {
  return workflowGenerationSystemPrompt
    .replace('{{WORKFLOW_CAPABILITIES}}', getWorkflowJavascriptCapabilityPrompt())
    .replace('{{WORKFLOW_EXPRESSION_CAPABILITIES}}', getWorkflowExpressionCapabilityPrompt())
    .trim();
}

function buildWorkflowGenerationUserPrompt(input: {
  inputTableId: string;
  outputTableName: string;
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
  failedJavascriptSource?: string;
  diagnostics?: PrepDiagnostic[];
  repairFunctionName?: string;
  repairStrategy?: WorkflowRepairStrategy;
}): string {
  const scopedRepairContext =
    input.failedJavascriptSource && input.repairFunctionName
      ? buildScopedRepairSourceContext(input.failedJavascriptSource, input.repairFunctionName)
      : undefined;
  return JSON.stringify(
    {
      task: 'Convert the user requirement into standard JavaScript that builds a Sophron data workflow through the provided Workflow SDK.',
      requirement: input.requirement,
      inputColumns: input.columns,
      compilationTarget: {
        inputTableId: input.inputTableId,
        outputTableName: input.outputTableName,
      },
      generationRules: {
        sequentialHelpers:
          'A helper may call workflow.step() multiple times in sequence. Bind every intermediate workflow value to a descriptive const, pass it to the next step, and return the final value.',
        mainContract:
          'The complete program must call workflow.input() exactly once and workflow.output() exactly once. main() must return the exact object returned by workflow.output().',
      },
      outputJsonSchema:
        input.failedJavascriptSource && input.repairFunctionName
          ? {
              javascriptPatch: {
                functionName: input.repairFunctionName,
                replacementSource:
                  'one or more complete named function declarations; retain the requested function, optionally add uniquely named helpers, and do not include main unless main is the requested function',
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
            failedJavascriptSource: scopedRepairContext ? undefined : input.failedJavascriptSource,
            repairTarget: scopedRepairContext,
            diagnostics: (input.diagnostics ?? []).map((diagnostic) => ({
              severity: diagnostic.severity,
              code: diagnostic.code,
              message: diagnostic.message,
              line: diagnostic.line,
              column: diagnostic.column,
              functionName: isRecord(diagnostic) ? diagnostic.functionName : undefined,
              operationId: isRecord(diagnostic) ? diagnostic.operationId : undefined,
              operationType: isRecord(diagnostic) ? diagnostic.operationType : undefined,
              expectedSignature: isRecord(diagnostic) ? diagnostic.expectedSignature : undefined,
              repairHint: isRecord(diagnostic) ? diagnostic.repairHint : undefined,
              sourceLine: isRecord(diagnostic) ? diagnostic.sourceLine : undefined,
              sourceExcerpt: isRecord(diagnostic) ? diagnostic.sourceExcerpt : undefined,
              caret: isRecord(diagnostic) ? diagnostic.caret : undefined,
              nodeId: isRecord(diagnostic) ? diagnostic.nodeId : undefined,
              nodeType: isRecord(diagnostic) ? diagnostic.nodeType : undefined,
              failureStage: isRecord(diagnostic) ? diagnostic.failureStage : undefined,
              repairClass: isRecord(diagnostic) ? diagnostic.repairClass : undefined,
            })),
            repairStrategy: input.repairStrategy,
            previousRepairWasIdentical: input.repairStrategy === 'duplicate_rewrite',
            instruction:
              input.repairStrategy === 'duplicate_rewrite'
                ? 'The previous repair returned byte-for-byte identical JavaScript and repeated the same diagnostics. Do not copy the failed source unchanged. Rewrite the failing function or, when its boundary is uncertain, reconstruct the complete program from scratch. Return complete corrected javascriptSource with every helper and main(). Apply the reported source excerpt, caret, repairHint, and canonical expectedSignature exactly. Do not return javascriptPatch or DSL.'
                : input.repairFunctionName
                  ? `Repair only ${input.repairFunctionName}. Return javascriptPatch with functionName exactly "${input.repairFunctionName}" and replacementSource containing the corrected function plus only any new helpers it requires. Do not return the complete program or DSL.`
                  : 'A full repair is required. Return the complete corrected javascriptSource, including every helper and main(). Apply every diagnostic source excerpt, caret, repairHint, and canonical expectedSignature exactly. Do not return a partial function, javascriptPatch, or DSL.',
          }
        : undefined,
      examples: input.failedJavascriptSource
        ? undefined
        : [
            {
              requirement: '过滤掉Market为EU的数据',
              javascriptSource:
                'function filterEurope(input) {\n  return workflow.step(input, "filter", { condition: expr(row => row["Market"] !== "EU") });\n}\n\nfunction main() {\n  const input = workflow.input(INPUT_TABLE_ID, { alias: "src" });\n  const filtered = filterEurope(input);\n  return workflow.output(filtered, OUTPUT_TABLE_NAME, { mode: "replace" });\n}',
              requiredColumns: [{ name: 'Market' }],
            },
            {
              requirement: '按照Sales升序排列，删除记录数',
              javascriptSource:
                'function sortSales(input) {\n  return workflow.step(input, "sort", { column: expr(row => row["Sales"]), direction: "asc" });\n}\n\nfunction removeRecordCount(input) {\n  return workflow.step(input, "drop", { columns: ["记录数"] });\n}\n\nfunction main() {\n  const input = workflow.input(INPUT_TABLE_ID, { alias: "src" });\n  const sorted = sortSales(input);\n  const cleaned = removeRecordCount(sorted);\n  return workflow.output(cleaned, OUTPUT_TABLE_NAME, { mode: "replace" });\n}',
              requiredColumns: [{ name: 'Sales' }, { name: '记录数' }],
            },
            {
              requirement: '从 Date 提取年份和月份',
              javascriptSource:
                'function extractYearAndMonth(input) {\n  const withYear = workflow.step(input, "derive", { column: "Year", expression: expr(row => year(row["Date"])) });\n  const withMonth = workflow.step(withYear, "derive", { column: "Month", expression: expr(row => month(row["Date"])) });\n  return withMonth;\n}\n\nfunction main() {\n  const input = workflow.input(INPUT_TABLE_ID, { alias: "src" });\n  const enriched = extractYearAndMonth(input);\n  return workflow.output(enriched, OUTPUT_TABLE_NAME, { mode: "replace" });\n}',
              requiredColumns: [{ name: 'Date' }],
            },
            {
              requirement:
                '根据利润率新增“经营等级”：利润率大于等于 20% 为“高收益”，0%到20%之间为“低收益”，小于0%为“亏损”。Sales 为 0 的话利润率置0。',
              javascriptSource:
                'function addProfitRate(input) {\n  return workflow.step(input, "derive", { column: "利润率", expression: expr(row => cast(row["Sales"] == null || row["Sales"] === 0 ? 0 : row["Profit"] / row["Sales"], "decimal", { scale: 2 })) });\n}\n\nfunction addOperatingGrade(input) {\n  return workflow.step(input, "derive", { column: "经营等级", expression: expr(row => row["利润率"] >= 0.2 ? "高收益" : row["利润率"] >= 0 ? "低收益" : "亏损") });\n}\n\nfunction main() {\n  const input = workflow.input(INPUT_TABLE_ID, { alias: "src" });\n  const withProfitRate = addProfitRate(input);\n  const withOperatingGrade = addOperatingGrade(withProfitRate);\n  return workflow.output(withOperatingGrade, OUTPUT_TABLE_NAME, { mode: "replace" });\n}',
              requiredColumns: [{ name: 'Sales' }, { name: 'Profit' }],
            },
            {
              requirement:
                '以 Product Type 为行分组，将 Market 透视为列，固定生成 Central、East、South、West 四列，单元格汇总 Sales。',
              javascriptSource:
                'function pivotMarketSales(input) {\n  return workflow.step(input, "pivot", { config: { on: ["Market"], values: ["Central", "East", "South", "West"], using: [{ function: "sum", expression: expr(row => row["Sales"]), alias: "Sales" }], groupBy: ["Product Type"] } });\n}\n\nfunction main() {\n  const input = workflow.input(INPUT_TABLE_ID, { alias: "src" });\n  const pivoted = pivotMarketSales(input);\n  return workflow.output(pivoted, OUTPUT_TABLE_NAME, { mode: "replace" });\n}',
              requiredColumns: [{ name: 'Product Type' }, { name: 'Market' }, { name: 'Sales' }],
            },
            {
              requirement: '按客户汇总销售额，找出销售额最高的前10名客户',
              javascriptSource:
                'function summarizeCustomers(input) {\n  return workflow.step(input, "aggregate", { groupBy: [expr(row => row["Customer ID"]), expr(row => row["Customer Name"])], metrics: [{ fn: "sum", expression: expr(row => row["Sales"]), alias: "总销售额" }] });\n}\n\nfunction rankCustomers(input) {\n  const sorted = workflow.step(input, "sort", { column: expr(row => row["总销售额"]), direction: "desc" });\n  const limited = workflow.step(sorted, "limit", { config: { mode: "limit", limit: 10, unit: "rows", offset: 0, orderBy: [] } });\n  return limited;\n}\n\nfunction main() {\n  const input = workflow.input(INPUT_TABLE_ID, { alias: "src" });\n  const summarized = summarizeCustomers(input);\n  const ranked = rankCustomers(summarized);\n  return workflow.output(ranked, OUTPUT_TABLE_NAME, { mode: "replace" });\n}',
              requiredColumns: [
                { name: 'Customer ID' },
                { name: 'Customer Name' },
                { name: 'Sales' },
              ],
            },
            {
              requirement:
                '按 Country 汇总 Sales，然后计算各国家销售额占全部国家销售额的比例，结果按占比降序排列。',
              javascriptSource:
                'function summarizeCountrySales(input) {\n  return workflow.step(input, "aggregate", { groupBy: [expr(row => row["Country"])], metrics: [{ fn: "sum", expression: expr(row => row["Sales"]), alias: "国家销售额" }] });\n}\n\nfunction addOverallSales(input) {\n  return workflow.step(input, "derive_window", { column: "全部销售额", function: "sum", expression: expr(row => row["国家销售额"]), partitionBy: [], orderBy: [] });\n}\n\nfunction addSalesShare(input) {\n  return workflow.step(input, "derive", { column: "销售额占比", expression: expr(row => cast(row["全部销售额"] == null || row["全部销售额"] === 0 ? 0 : row["国家销售额"] / row["全部销售额"], "decimal", { scale: 4 })) });\n}\n\nfunction sortBySalesShare(input) {\n  return workflow.step(input, "sort", { column: expr(row => row["销售额占比"]), direction: "desc" });\n}\n\nfunction main() {\n  const input = workflow.input(INPUT_TABLE_ID, { alias: "src" });\n  const summarized = summarizeCountrySales(input);\n  const withOverallSales = addOverallSales(summarized);\n  const withSalesShare = addSalesShare(withOverallSales);\n  const sorted = sortBySalesShare(withSalesShare);\n  return workflow.output(sorted, OUTPUT_TABLE_NAME, { mode: "replace" });\n}',
              requiredColumns: [{ name: 'Country' }, { name: 'Sales' }],
            },
          ],
    },
    null,
    2
  );
}

function buildScopedRepairSourceContext(
  javascriptSource: string,
  functionName: string
): { functionName: string; source: string; availableFunctions: string[] } | undefined {
  let functions: ReturnType<typeof indexJavaScriptFunctionsBestEffort>;
  try {
    functions = indexJavaScriptFunctions(javascriptSource);
  } catch {
    functions = indexJavaScriptFunctionsBestEffort(javascriptSource);
  }
  const target = functions.find((item) => item.name === functionName);
  if (!target) return undefined;
  return {
    functionName,
    source: javascriptSource.slice(target.start, target.end).trim(),
    availableFunctions: functions.map((item) => item.name),
  };
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
  let functionNames: string[];
  try {
    functionNames = indexJavaScriptFunctions(javascriptSource).map((item) => item.name);
  } catch {
    functionNames = indexJavaScriptFunctionsBestEffort(javascriptSource).map((item) => item.name);
  }
  for (const diagnostic of diagnostics) {
    const functionName = isRecord(diagnostic) ? diagnostic.functionName : undefined;
    if (
      typeof functionName === 'string' &&
      functionNames.filter((name) => name === functionName).length === 1
    ) {
      return functionName;
    }
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
        return createWorkflowFunctionPatchCandidate(
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

function workflowRepairStoppedError(
  reason:
    | 'duplicate'
    | 'exhausted'
    | 'stage_exhausted'
    | 'incident_exhausted'
    | 'token_exhausted'
    | 'not_repairable',
  diagnostics: PrepDiagnostic[]
): DataCommandError {
  const stopMessages: Record<typeof reason, string> = {
    duplicate:
      'Workflow repair stopped because the same source and diagnostics were already attempted',
    exhausted: 'Workflow repair attempts exhausted',
    stage_exhausted: 'Workflow repair attempts for this failure stage were exhausted',
    incident_exhausted: 'Workflow repair attempts for this root cause were exhausted',
    token_exhausted: 'Workflow repair output token budget was exhausted',
    not_repairable: 'Workflow failure is not eligible for automatic repair',
  };
  const stopMessage = stopMessages[reason];
  const diagnostic = diagnostics.find((item) => item.severity === 'error');
  const diagnosticLocation = diagnostic?.line
    ? ` at line ${diagnostic.line}${diagnostic.column ? `, column ${diagnostic.column}` : ''}`
    : '';
  const diagnosticMessage = diagnostic ? `${diagnostic.message}${diagnosticLocation}` : undefined;
  const message = diagnosticMessage ? `${stopMessage}: ${diagnosticMessage}` : stopMessage;
  const publicStopReason =
    reason === 'stage_exhausted' || reason === 'incident_exhausted' || reason === 'token_exhausted'
      ? 'exhausted'
      : reason;
  return new DataCommandError(workflowCommandCodeForDiagnostics(diagnostics), message, {
    diagnostics,
    repairStopReason: publicStopReason,
    repairBudgetStopReason: reason,
  });
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
