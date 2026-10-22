/**
 * AI authoring: asks the model for a complete jflow program (single source, single write) and
 * extracts it. Compilation, validation and the repair loop live in the command service, which owns
 * the store and catalog.
 */
import type { AgentRuntimeConfig } from '../../../shared/contracts';
import type { WorkflowDiagnostic } from '../../../shared/workflow-diagnostics';
import { extractFencedBlock } from '../../../shared/structured-text';
import { runPiAiOneShot, type PiAiOneShotResult } from '../../agent/pi-ai-one-shot';
import {
  buildWorkflowGenerationSystemPrompt,
  buildWorkflowGenerationUserPrompt,
} from '../../prompts/data-workflow';
import { DataCommandError } from '../data-command-types';
import type { RequirementCapabilityContract } from './requirement-capability-registry';

/** Initial generation plus this many repair rounds. */
export const JFLOW_GENERATION_REPAIR_ATTEMPTS = 3;

export interface WorkflowModelUsageEvent {
  phase: 'initial_generation' | 'repair';
  attempt?: number;
  errorCode?: string;
  result: PiAiOneShotResult;
}

export type WorkflowModelUsageObserver = (event: WorkflowModelUsageEvent) => void;

export interface GeneratedJflowProgram {
  text: string;
  summary?: string;
}

export interface JflowGenerationRequest {
  rawTableUri: string;
  resultTableName: string;
  resultTableUri?: string;
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
  requirementContract?: RequirementCapabilityContract;
  runtimeConfig?: AgentRuntimeConfig;
  onModelUsage?: WorkflowModelUsageObserver;
  onActivity?: () => void;
  signal?: AbortSignal;
  /** Set for repair rounds. */
  previous?: { text: string; diagnostics: WorkflowDiagnostic[]; attempt: number };
}

export function extractJflowProgram(responseText: string): GeneratedJflowProgram {
  const text = (extractFencedBlock(responseText, ['jflow', 'text', '']) ?? '').trim();
  const fallback = responseText.trim();
  const program = text || (/^\s*(pipeline|source)\b/m.test(fallback) ? fallback : '');
  if (!program) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      'Workflow generation response did not contain a jflow program'
    );
  }
  const summary = /^summary:\s*(.+)$/im.exec(responseText)?.[1]?.trim();
  return { text: program, ...(summary ? { summary } : {}) };
}

export async function generateJflowProgram(
  request: JflowGenerationRequest
): Promise<GeneratedJflowProgram> {
  const config = request.runtimeConfig;
  if (!config || !config.model?.trim()) {
    throw new DataCommandError(
      'INVALID_ARGUMENT',
      'Model configuration is required to generate a data pipeline. Please select an available model and try again.'
    );
  }
  let response: PiAiOneShotResult;
  try {
    response = await runPiAiOneShot(
      buildWorkflowGenerationUserPrompt({
        requirement: request.requirement,
        columns: request.columns,
        failedText: request.previous?.text,
        diagnostics: request.previous?.diagnostics,
      }),
      buildWorkflowGenerationSystemPrompt({
        rawTableUri: request.rawTableUri,
        resultTableName: request.resultTableName,
        resultTableUri: request.resultTableUri,
        requirementContract: request.requirementContract,
      }),
      config,
      {
        temperature: 0,
        maxTokens: 4_000,
        signal: request.signal,
        onActivity: request.onActivity,
        reasoning: config.enableThinking ? 'low' : 'off',
        thinkingBudgets: { low: 1_024 },
      }
    );
  } catch (error) {
    if (request.signal?.aborted || error instanceof DataCommandError) throw error;
    throw new DataCommandError(
      'GENERATION_FAILED',
      `Workflow generation model call failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  request.onModelUsage?.({
    phase: request.previous ? 'repair' : 'initial_generation',
    ...(request.previous ? { attempt: request.previous.attempt } : {}),
    result: response,
  });
  return extractJflowProgram(response.text);
}
