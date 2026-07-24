import type {
  AgentRuntimeConfig,
  DataAnalyzeTaskRequirementResult,
  DataTaskRequirementAnalysisItem,
} from '../../../renderer/types';
import { runPiAiOneShot } from '../../claude/claude-sdk-one-shot';
import { DataCommandError } from '../data-command-types';
import { getWorkflowJavascriptCapabilityPrompt } from './workflow-operation-registry';
import { extractJsonObject, isRecord } from './utils';

const VALID_STATUSES = new Set(['supported', 'ambiguous', 'unsupported']);

export async function analyzeDataTaskRequirement({
  requirement,
  columns,
  runtimeConfig,
}: {
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
  runtimeConfig?: AgentRuntimeConfig;
}): Promise<DataAnalyzeTaskRequirementResult> {
  if (!runtimeConfig?.model?.trim()) {
    throw new DataCommandError(
      'INVALID_ARGUMENT',
      'Model configuration is required to analyze a data task'
    );
  }
  const response = await runPiAiOneShot(
    JSON.stringify({ requirement, inputColumns: columns }, null, 2),
    [
      'You are a strict capability checker for a data workflow DSL.',
      'Break the user request into the smallest independently verifiable requirements.',
      'Classify every requirement as supported, ambiguous, or unsupported.',
      'Never omit, merge away, or silently reinterpret any user requirement.',
      'supported means it can be expressed completely with the allowed operations and given columns.',
      'ambiguous means a user choice or missing rule is required. Explain exactly what is missing.',
      'unsupported means any part requires an unavailable operation, external service, second input, prediction, messaging, or unknown field.',
      'Return strict JSON only: {"items":[{"requirement":"original requirement","status":"supported|ambiguous|unsupported","reason":"optional concise reason","suggestedRequirement":"optional executable rewrite","operations":["operation names"]}]}',
      `Allowed operations: ${getWorkflowJavascriptCapabilityPrompt()}.`,
      'This workflow has exactly one input table. Treat joins and any second data source as unsupported.',
    ].join('\n'),
    runtimeConfig,
    { temperature: 0, maxTokens: 2_000 }
  );
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
