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
  AutomationSetEnabledInputSchema,
  AutomationUpdateScheduleInputSchema,
  parseAutomationCreateInput,
  parseAutomationListInput,
  parseAutomationPrepareScheduleUpdateInput,
  parseAutomationPrepareInput,
  parseAutomationSetEnabledInput,
  parseAutomationUpdateScheduleInput,
} from './contract';
import {
  buildAutomationToolStablePrompt,
  buildAutomationToolStatePrompt,
} from '../../prompts/automation-tools';
import { AUTOMATION_TOOL_COPY } from '../../prompts/tool-copy';
import { detectAutomationIntent, SessionPackActivation } from '../../extensions/agent-intent';
import { AUTOMATION_TOOL_PACKS } from '../../data/data-tool-packs';
import type { AutomationToolService } from './service';
import type { AutomationToolExecutionContext } from './contract';

export function createAutomationAgentRuntimeExtension(
  service: AutomationToolService
): AgentRuntimeExtension {
  const activations = new SessionPackActivation();
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
      const catalog = createAutomationCustomTools(service, executionContext);
      const pendingKinds = service.pendingDraftKinds(context.session.id);
      const hasPendingDrafts = pendingKinds.length > 0;
      const toolContexts = [
        {
          tools: catalog.map((tool) => tool.name),
          stablePrompt: buildAutomationToolStablePrompt(),
          statePrompt: buildAutomationToolStatePrompt({ now: Date.now(), timezone }),
        },
      ];
      const intent = detectAutomationIntent(context, {
        stickyActive: activations.activePacks(context.session.id).size > 0,
        hasPendingReceipts: hasPendingDrafts,
      });
      if (!intent.active) {
        activations.clear(context.session.id);
        return {
          customTools: catalog,
          activateTools: [],
          toolPacks: AUTOMATION_TOOL_PACKS,
          toolContexts,
        };
      }
      const previous = activations.activePacks(context.session.id);
      const packs = activations.activate(
        context.session.id,
        intent.continuation && previous.size > 0
          ? previous
          : [
              'automation.core',
              ...(intent.create ? ['automation.create'] : []),
              ...(intent.update ? ['automation.update'] : []),
            ]
      );
      const activateTools =
        hasPendingDrafts && intent.continuation
          ? pendingKinds.map((kind) =>
              kind === 'create' ? 'automation_create' : 'automation_update_schedule'
            )
          : [...packs].flatMap(
              (pack) =>
                AUTOMATION_TOOL_PACKS[pack as keyof typeof AUTOMATION_TOOL_PACKS]?.tools ?? []
            );
      return {
        stablePrompt: toolContexts[0].stablePrompt,
        statePrompt: toolContexts[0].statePrompt,
        customTools: catalog,
        activateTools,
        toolPacks: AUTOMATION_TOOL_PACKS,
        toolContexts,
      };
    },
    async onSessionDeleted({ sessionId }): Promise<void> {
      activations.clear(sessionId);
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
      name: 'automation_set_enabled',
      ...AUTOMATION_TOOL_COPY.automation_set_enabled,
      parameters: AutomationSetEnabledInputSchema,
      execute: async (_toolCallId, params) =>
        service.setEnabled(parseAutomationSetEnabledInput(params)),
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
