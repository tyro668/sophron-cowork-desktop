import requirementAnalysisSystemPrompt from './data-workflow/requirement-analysis-system.txt?raw';
import workflowGenerationSystemPrompt from './data-workflow/workflow-generation-system.txt?raw';
import type { WorkflowDiagnostic } from '../../shared/workflow-diagnostics';
import { EXPRESSION_FUNCTIONS } from '../../shared/expression/functions';
import { getJflowReference } from '../../shared/jflow';
import {
  getRequirementCapabilityContractOperationTypes,
  getRequirementCapabilityPrompt,
  getRequirementOperationTypeList,
  type RequirementCapabilityContract,
} from '../data/workflow/requirement-capability-registry';
import { renderPromptTemplate } from './template';

function jflowFunctionList(): string {
  return [
    ...EXPRESSION_FUNCTIONS.map((fn) => fn.name),
    'sumif',
    'countif',
    'avgif',
    'minif',
    'maxif',
    'countdistinctif',
  ].join(', ');
}

export function buildRequirementAnalysisSystemPrompt(): string {
  return renderPromptTemplate(requirementAnalysisSystemPrompt, {
    WORKFLOW_CAPABILITIES: getRequirementOperationTypeList(),
    REQUIREMENT_CAPABILITIES: getRequirementCapabilityPrompt(),
    JFLOW_FUNCTIONS: jflowFunctionList(),
  });
}

export function buildRequirementAnalysisUserPrompt(input: {
  requirement: string;
  requirementConversation?: Array<{ role: 'user' | 'assistant'; text: string }>;
  inputColumns: Array<{ name: string; type?: string }>;
}): string {
  return JSON.stringify(
    {
      ...input,
      conversationNote: input.requirementConversation?.length
        ? 'requirementConversation lists the earlier turns in order: each user message and the assistant analysis feedback it received. requirement contains every user message joined in order, so the newest message at the end usually answers or refines items from that feedback. Interpret short answers against the item they respond to instead of treating them as standalone requests, then classify the complete accumulated requirement.'
        : undefined,
    },
    null,
    2
  );
}

export function buildWorkflowGenerationSystemPrompt(input: {
  rawTableUri: string;
  resultTableName: string;
  /** Existing result table to overwrite; otherwise the program creates `@new(resultTableName)`. */
  resultTableUri?: string;
  requirementContract?: RequirementCapabilityContract;
}): string {
  const contract = input.requirementContract;
  return renderPromptTemplate(workflowGenerationSystemPrompt, {
    RAW_TABLE_URI: input.rawTableUri,
    WRITE_TARGET: input.resultTableUri
      ? `@id('${input.resultTableUri.replace(/'/g, "''")}')`
      : `@new('${input.resultTableName.replace(/'/g, "''")}')`,
    REQUIREMENT_SCOPE: contract
      ? `implement exactly these confirmed capabilities (operation kinds: ${getRequirementCapabilityContractOperationTypes(contract).join(', ')}): ${getRequirementCapabilityPrompt(contract.capabilityIds)}. Do not add unrelated steps.`
      : 'implement the requirement with the fewest clear steps.',
    JFLOW_FUNCTIONS: jflowFunctionList(),
    JFLOW_REFERENCE: getJflowReference('all'),
  });
}

export function buildWorkflowGenerationUserPrompt(input: {
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
  failedText?: string;
  diagnostics?: WorkflowDiagnostic[];
}): string {
  const lines = [
    `Requirement:\n${input.requirement}`,
    `Input columns:\n${input.columns.map((c) => `- [${c.name}]${c.type ? ` ${c.type}` : ''}`).join('\n')}`,
  ];
  if (input.failedText) {
    lines.push(
      `Your previous program failed:\n\`\`\`jflow\n${input.failedText}\n\`\`\``,
      `Diagnostics:\n${(input.diagnostics ?? [])
        .map(
          (d) =>
            `- ${d.code ?? 'error'}${d.line ? ` (line ${d.line}${d.column ? `:${d.column}` : ''})` : ''}: ${d.message}`
        )
        .join('\n')}`,
      'Return the complete corrected program.'
    );
  }
  return lines.join('\n\n');
}
