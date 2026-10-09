import type { AgentRuntimeConfig } from '../../../shared/contracts';
import type { PrepDiagnostic } from '../../../shared/prep-dsl';
import { runPiAiOneShot, type PiAiOneShotResult } from '../../agent/pi-ai-one-shot';
import {
  buildWorkflowGenerationSystemPrompt,
  buildWorkflowGenerationUserPrompt,
} from '../../prompts/data-workflow';
import { DataCommandError } from '../data-command-types';
import {
  applyWorkflowFunctionPatch,
  compileWorkflowJavaScript,
  createWorkflowFunctionPatchCandidate,
  executeWorkflowJavaScriptInSandbox,
  indexJavaScriptFunctions,
  indexJavaScriptFunctionsBestEffort,
} from './javascript-runtime';
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
import {
  getRequirementCapabilityContractOperationTypes,
  validateWorkflowIrAgainstRequirementCapabilityContract,
  type RequirementCapabilityContract,
} from './requirement-capability-registry';
import { extractJsonObject, isRecord } from './utils';
import { extractFencedBlock } from '../../../shared/structured-text';

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
  requirementContract,
}: {
  javascriptSource: string;
  inputTableId: string;
  outputTableName: string;
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
  requirementContract?: RequirementCapabilityContract;
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
    if (requirementContract) {
      validateWorkflowIrAgainstRequirementCapabilityContract(ir, requirementContract);
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
  const candidate = extractFencedBlock(trimmed, ['javascript', 'js']) ?? trimmed;
  try {
    if (indexJavaScriptFunctions(candidate).some((entry) => entry.name === 'main')) {
      return candidate;
    }
  } catch {
    // The caller reports the stable generation-contract error below.
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
  requirementContract,
  runtimeConfig,
  repairBudget,
  onModelUsage,
  onActivity,
  signal,
}: {
  inputTableId: string;
  outputTableName: string;
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
  requirementContract?: RequirementCapabilityContract;
  runtimeConfig?: AgentRuntimeConfig;
  repairBudget?: WorkflowRepairBudget;
  onModelUsage?: WorkflowModelUsageObserver;
  onActivity?: () => void;
  signal?: AbortSignal;
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
        requirementContract,
      }),
      buildWorkflowGenerationSystemPrompt({
        operationTypes: requirementContract
          ? getRequirementCapabilityContractOperationTypes(requirementContract)
          : undefined,
      }),
      config,
      {
        temperature: 0,
        maxTokens: 4_000,
        signal,
        onActivity,
        reasoning: config.enableThinking ? 'low' : 'off',
        thinkingBudgets: { low: 1_024 },
      }
    );
    onModelUsage?.({ phase: 'initial_generation', result: response });
    if (response.stopReason === 'length') {
      return await repairGeneratedWorkflowFromDiagnostics({
        inputTableId,
        outputTableName,
        requirement,
        columns,
        requirementContract,
        runtimeConfig,
        failedJavascriptSource:
          extractJavascriptSourceFromModelResponse(response.text) ?? response.text,
        diagnostics: createModelOutputTruncatedDiagnostics(),
        repairBudget: sharedRepairBudget,
        onModelUsage,
        onActivity,
        signal,
      });
    }
    try {
      return compileGeneratedJavascriptResponse({
        text: response.text,
        inputTableId,
        outputTableName,
        requirement,
        columns,
        requirementContract,
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
        requirementContract,
        runtimeConfig,
        failedJavascriptSource:
          extractJavascriptSourceFromModelResponse(response.text) ?? response.text,
        diagnostics,
        repairBudget: sharedRepairBudget,
        onModelUsage,
        onActivity,
        signal,
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
  requirementContract,
  runtimeConfig,
  failedJavascriptSource,
  diagnostics,
  repairBudget,
  onModelUsage,
  onActivity,
  signal,
}: {
  inputTableId: string;
  outputTableName: string;
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
  requirementContract?: RequirementCapabilityContract;
  runtimeConfig?: AgentRuntimeConfig;
  failedJavascriptSource: string;
  diagnostics: PrepDiagnostic[];
  repairBudget?: WorkflowRepairBudget;
  onModelUsage?: WorkflowModelUsageObserver;
  onActivity?: () => void;
  signal?: AbortSignal;
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
          requirementContract,
          failedJavascriptSource: currentJavascriptSource,
          diagnostics: currentDiagnostics,
          repairFunctionName,
          repairStrategy,
        }),
        buildWorkflowGenerationSystemPrompt({
          repairFunctionName,
          operationTypes: requirementContract
            ? getRequirementCapabilityContractOperationTypes(requirementContract)
            : undefined,
        }),
        config,
        {
          temperature: 0,
          maxTokens: maxOutputTokens,
          signal,
          onActivity,
          reasoning: config.enableThinking ? 'low' : 'off',
          thinkingBudgets: { low: 1_024 },
        }
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
          requirementContract,
        });
        recordRepairUsage('success');
        return repairedWorkflow;
      } catch (error) {
        if (error instanceof WorkflowRepairResponseFormatError) {
          // Never apply a full-program response as a scoped patch. Ask for a
          // complete repair against the last valid baseline within the same budget.
          recordRepairUsage('escalated');
          forceFullRegeneration = true;
          duplicateRewrite = false;
          continue;
        }
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
  requirementContract,
}: {
  text: string;
  failedJavascriptSource: string;
  repairFunctionName?: string;
  inputTableId: string;
  outputTableName: string;
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
  requirementContract?: RequirementCapabilityContract;
}): GeneratedDataTaskWorkflow {
  let parsed: unknown;
  try {
    parsed = parseRepairResponse(text, failedJavascriptSource, repairFunctionName);
  } catch (error) {
    if (error instanceof WorkflowRepairResponseFormatError) throw error;
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
      requirementContract,
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
    requirementContract,
  });
}

class WorkflowRepairResponseFormatError extends DataCommandError {
  constructor() {
    super(
      'VALIDATION_FAILED',
      'The model returned JavaScript outside the requested function patch scope'
    );
  }
}

/** Some models put a replacement helper under javascriptSource. Normalize only
 * a structurally scoped patch; full programs and ambiguous source need a new
 * full-generation request, never an implicit overwrite of unrelated functions. */
function parseRepairResponse(
  text: string,
  failedJavascriptSource: string,
  repairFunctionName?: string
): unknown {
  const parsed: unknown = JSON.parse(text);
  if (
    !repairFunctionName ||
    !isRecord(parsed) ||
    'javascriptPatch' in parsed ||
    typeof parsed.javascriptSource !== 'string'
  )
    return parsed;
  try {
    indexJavaScriptFunctions(parsed.javascriptSource);
    createWorkflowFunctionPatchCandidate(
      failedJavascriptSource,
      repairFunctionName,
      parsed.javascriptSource
    );
  } catch {
    throw new WorkflowRepairResponseFormatError();
  }
  return {
    javascriptPatch: {
      functionName: repairFunctionName,
      replacementSource: parsed.javascriptSource,
    },
  };
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
    const parsed = parseRepairResponse(text, failedJavascriptSource, repairFunctionName);
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
  requirementContract,
}: {
  text: string;
  inputTableId: string;
  outputTableName: string;
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
  requirementContract?: RequirementCapabilityContract;
}): GeneratedDataTaskWorkflow {
  const javascriptSource = extractGeneratedJavascriptSource(text);
  return compileGeneratedJavaScriptWorkflow({
    javascriptSource,
    inputTableId,
    outputTableName,
    requirement,
    columns,
    requirementContract,
  });
}
