import type {
  AgentRuntimeConfig,
  DataAnalyzeTaskRequirementResult,
  DataTaskRequirementAnalysisItem,
} from '../../../renderer/types';
import { runPiAiOneShot, type PiAiOneShotResult } from '../../claude/claude-sdk-one-shot';
import { DataCommandError } from '../data-command-types';
import requirementAnalysisSystemPrompt from './prompts/requirement-analysis-system.txt?raw';
import { getWorkflowJavascriptCapabilityPrompt } from './workflow-ir-operation-registry';
import { getWorkflowExpressionCapabilityPrompt } from './workflow-expression-registry';
import { extractJsonObject, isRecord } from './utils';

const VALID_STATUSES = new Set(['supported', 'ambiguous', 'unsupported']);

export async function analyzeDataTaskRequirement({
  requirement,
  columns,
  runtimeConfig,
  onModelUsage,
}: {
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
  runtimeConfig?: AgentRuntimeConfig;
  onModelUsage?: (result: PiAiOneShotResult) => void;
}): Promise<DataAnalyzeTaskRequirementResult> {
  if (!runtimeConfig?.model?.trim()) {
    throw new DataCommandError(
      'INVALID_ARGUMENT',
      'Model configuration is required to analyze a data task'
    );
  }
  const response = await runPiAiOneShot(
    JSON.stringify({ requirement, inputColumns: columns }, null, 2),
    buildRequirementAnalysisSystemPrompt(),
    runtimeConfig,
    { temperature: 0, maxTokens: 2_000 }
  );
  onModelUsage?.(response);
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(response.text));
  } catch {
    throw new DataCommandError(
      'GENERATION_FAILED',
      'Requirement analysis did not return valid JSON'
    );
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.items) || parsed.items.length === 0) {
    throw new DataCommandError(
      'GENERATION_FAILED',
      'Requirement analysis did not return any requirement items'
    );
  }
  const items = parsed.items.map(normalizeAnalysisItem);
  const supportedCount = items.filter((item) => item.status === 'supported').length;
  return {
    status:
      supportedCount === items.length
        ? 'supported'
        : supportedCount === 0 && items.every((item) => item.status === 'unsupported')
          ? 'unsupported'
          : 'needs_confirmation',
    items,
  };
}

function buildRequirementAnalysisSystemPrompt(): string {
  return requirementAnalysisSystemPrompt
    .replace('{{WORKFLOW_CAPABILITIES}}', getWorkflowJavascriptCapabilityPrompt())
    .replace('{{WORKFLOW_EXPRESSION_CAPABILITIES}}', getWorkflowExpressionCapabilityPrompt())
    .trim();
}

function normalizeAnalysisItem(value: unknown): DataTaskRequirementAnalysisItem {
  if (
    !isRecord(value) ||
    typeof value.requirement !== 'string' ||
    !value.requirement.trim() ||
    typeof value.status !== 'string' ||
    !VALID_STATUSES.has(value.status)
  ) {
    throw new DataCommandError(
      'GENERATION_FAILED',
      'Requirement analysis returned an invalid item'
    );
  }
  return {
    requirement: value.requirement.trim(),
    status: value.status as DataTaskRequirementAnalysisItem['status'],
    reason: typeof value.reason === 'string' ? value.reason.trim() || undefined : undefined,
    suggestedRequirement:
      typeof value.suggestedRequirement === 'string'
        ? value.suggestedRequirement.trim() || undefined
        : undefined,
    operations: Array.isArray(value.operations)
      ? value.operations.filter((item): item is string => typeof item === 'string' && Boolean(item))
      : [],
  };
}
