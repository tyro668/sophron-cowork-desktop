import type {
  AgentRuntimeCustomTool,
  AgentRuntimeExtension,
  BeforeSessionRunResult,
} from '../../extensions/agent-runtime-extension';
import {
  AutomationCreateInputSchema,
  AutomationListInputSchema,
  AutomationPrepareParametersSchema,
  parseAutomationCreateInput,
  parseAutomationListInput,
  parseAutomationPrepareInput,
} from './contract';
import { buildAutomationToolPrompt } from './prompt';
import type { AutomationToolService } from './service';
import type { AutomationToolExecutionContext } from './contract';

export function createAutomationAgentRuntimeExtension(
  service: AutomationToolService
): AgentRuntimeExtension {
  return {
    name: 'automation-tools',
    async beforeSessionRun(context): Promise<BeforeSessionRunResult> {
      const currentUserMessage = [...context.existingMessages]
        .reverse()
        .find((message) => message.role === 'user');
      const executionContext = {
        sessionId: context.session.id,
        currentUserMessageId: currentUserMessage?.id,
      };
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      return {
        promptPrefix: buildAutomationToolPrompt({ now: Date.now(), timezone }),
        customTools: createAutomationCustomTools(service, executionContext),
      };
    },
    async onSessionDeleted({ sessionId }): Promise<void> {
      service.clearConversationContext(sessionId);
    },
  };
}

export function createAutomationCustomTools(
  service: AutomationToolService,
  executionContext: AutomationToolExecutionContext
): AgentRuntimeCustomTool[] {
  return [
    {
      name: 'automation_list',
      label: 'List automations',
      description:
        'List existing automations. Use before referencing an automation by name or when checking whether a similar automation already exists.',
      parameters: AutomationListInputSchema,
      execute: async (_toolCallId, params) => service.list(parseAutomationListInput(params)),
    },
    {
      name: 'automation_prepare',
      label: 'Prepare automation',
      description:
        'Validate and prepare a scheduled automation without creating it. Call only after action and execution time are fully known. Pass schedule and action as objects, not JSON strings. For a new data task, generate and validate the saved data task first, then pass its returned task id. This returns a draftId for automation_create.',
      parameters: AutomationPrepareParametersSchema,
      execute: async (_toolCallId, params) =>
        service.prepare(parseAutomationPrepareInput(params), executionContext),
    },
    {
      name: 'automation_create',
      label: 'Create automation',
      description:
        'Create a persistent scheduled automation from a valid automation_prepare draft. Call only when the user explicitly asked to create the prepared automation. Retrying the same draft is idempotent.',
      parameters: AutomationCreateInputSchema,
      execute: async (_toolCallId, params) =>
        service.create(parseAutomationCreateInput(params), executionContext),
    },
  ];
}
