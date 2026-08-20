import type {
  AgentRuntimeCustomTool,
  AgentRuntimeExtension,
  BeforeSessionRunResult,
} from '../../extensions/agent-runtime-extension';
import {
  AutomationCreateInputSchema,
  AutomationListInputSchema,
  AutomationPrepareScheduleUpdateParametersSchema,
  AutomationPrepareParametersSchema,
  AutomationUpdateScheduleInputSchema,
  parseAutomationCreateInput,
  parseAutomationListInput,
  parseAutomationPrepareScheduleUpdateInput,
  parseAutomationPrepareInput,
  parseAutomationUpdateScheduleInput,
} from './contract';
import { buildAutomationToolPrompt } from '../../prompts/automation-tools';
import { AUTOMATION_TOOL_COPY } from '../../prompts/tool-copy';
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
      ...AUTOMATION_TOOL_COPY.automation_list,
      parameters: AutomationListInputSchema,
      execute: async (_toolCallId, params) => service.list(parseAutomationListInput(params)),
    },
    {
      name: 'automation_prepare',
      ...AUTOMATION_TOOL_COPY.automation_prepare,
      parameters: AutomationPrepareParametersSchema,
      execute: async (_toolCallId, params) =>
        service.prepare(parseAutomationPrepareInput(params), executionContext),
    },
    {
      name: 'automation_create',
      ...AUTOMATION_TOOL_COPY.automation_create,
      parameters: AutomationCreateInputSchema,
      execute: async (_toolCallId, params) =>
        service.create(parseAutomationCreateInput(params), executionContext),
    },
    {
      name: 'automation_prepare_schedule_update',
      ...AUTOMATION_TOOL_COPY.automation_prepare_schedule_update,
      parameters: AutomationPrepareScheduleUpdateParametersSchema,
      execute: async (_toolCallId, params) =>
        service.prepareScheduleUpdate(
          parseAutomationPrepareScheduleUpdateInput(params),
          executionContext
        ),
    },
    {
      name: 'automation_update_schedule',
      ...AUTOMATION_TOOL_COPY.automation_update_schedule,
      parameters: AutomationUpdateScheduleInputSchema,
      execute: async (_toolCallId, params) =>
        service.updateSchedule(parseAutomationUpdateScheduleInput(params), executionContext),
    },
  ];
}
