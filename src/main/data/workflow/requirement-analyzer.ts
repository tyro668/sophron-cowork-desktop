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
import {
  getRequirementCapabilityOperation,
  getRequirementCapabilityPrompt,
} from './requirement-capability-registry';
import { extractJsonObject, isRecord } from './utils';

const VALID_STATUSES = new Set(['supported', 'ambiguous', 'unsupported']);

export async function analyzeDataTaskRequirement({
  requirement,
  columns,
  runtimeConfig,
  onModelUsage,
  signal,
}: {
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
  runtimeConfig?: AgentRuntimeConfig;
  onModelUsage?: (result: PiAiOneShotResult) => void;
  signal?: AbortSignal;
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
    { temperature: 0, maxTokens: 2_000, signal }
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
    .replace('{{REQUIREMENT_CAPABILITIES}}', getRequirementCapabilityPrompt())
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
  const capabilities = Array.isArray(value.capabilities)
    ? value.capabilities
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  const unknownCapabilities = capabilities.filter(
    (capability) => !getRequirementCapabilityOperation(capability)
  );
  const validCapabilities = capabilities.filter((capability) =>
    getRequirementCapabilityOperation(capability)
  );
  const derivedOperations = [
    ...new Set(
      validCapabilities
        .map((capability) => getRequirementCapabilityOperation(capability))
        .filter((operation): operation is string => Boolean(operation))
    ),
  ];
  const declaredStatus = value.status as DataTaskRequirementAnalysisItem['status'];
  const status =
    declaredStatus === 'supported' &&
    (unknownCapabilities.length > 0 || validCapabilities.length === 0)
      ? ('unsupported' as const)
      : declaredStatus;
  const modelReason =
    typeof value.reason === 'string' ? value.reason.trim() || undefined : undefined;
  const registryReason = unknownCapabilities.length
    ? `${unknownCapabilities.length > 1 ? 'Unavailable capabilities' : 'Unavailable capability'}: ${unknownCapabilities.join(', ')}`
    : declaredStatus === 'supported' && validCapabilities.length === 0
      ? 'Supported requirements must declare at least one certified capability'
      : undefined;
  return {
    requirement: value.requirement.trim(),
    status,
    reason: registryReason ?? modelReason,
    suggestedRequirement:
      typeof value.suggestedRequirement === 'string'
        ? value.suggestedRequirement.trim() || undefined
        : undefined,
    operations: derivedOperations,
    capabilities: validCapabilities,
  };
}
