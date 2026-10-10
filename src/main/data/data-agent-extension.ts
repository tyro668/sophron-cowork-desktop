import type {
  AgentRuntimeExtension,
  BeforeSessionRunResult,
} from '../extensions/agent-runtime-extension';
import { detectDataIntent, SessionPackActivation } from '../extensions/agent-intent';
import type { DataToolService } from './data-tool-service';
import { createDataCustomTools } from './data-tool-definitions';
import { DATA_TOOL_PACKS } from './data-tool-packs';
import { buildDataToolStablePrompt, buildDataToolStatePrompt } from '../prompts/data-tools';

export function createDataAgentRuntimeExtension(
  dataToolService: DataToolService
): AgentRuntimeExtension {
  const activations = new SessionPackActivation();
  return {
    name: 'data-tools',
    async beforeSessionRun(context): Promise<BeforeSessionRunResult> {
      const dataContext = await dataToolService.resolveConversationContext(context);
      const currentUserMessage = [...context.existingMessages]
        .reverse()
        .find((message) => message.role === 'user');
      dataToolService.updateExecutionContext({
        sessionId: context.session.id,
        currentUserMessageId: currentUserMessage?.id,
        runtimeConfig: context.runtimeConfig,
        authoringRequest: dataContext.authoringRequest,
        requirementConversation: context.existingMessages
          .slice(-30)
          .filter(
            (message) =>
              message.id !== currentUserMessage?.id &&
              (message.role === 'user' || message.role === 'assistant')
          )
          .flatMap((message) => {
            const text = message.content
              .filter((block) => block.type === 'text')
              .map((block) => block.text)
              .join('\n');
            return text ? [{ role: message.role as 'user' | 'assistant', text }] : [];
          }),
      });

      // The full catalog stays registered every turn so packs can be activated
      // later without rebuilding the session; only the subset is exposed.
      const catalog = createDataCustomTools(dataToolService, dataContext);
      const toolContexts = [
        {
          tools: catalog.map((tool) => tool.name),
          stablePrompt: buildDataToolStablePrompt(),
          statePrompt: buildDataToolStatePrompt(dataContext),
        },
      ];
      const hasPendingReceipts = dataToolService.hasPendingAnalysis(context.session.id);
      const needsClarification =
        hasPendingReceipts && !dataToolService.hasSupportedAnalysis(context.session.id);
      const intent = detectDataIntent(context, {
        stickyActive: activations.activePacks(context.session.id).size > 0,
        hasPendingReceipts,
        hasSelectedPipeline: !!dataContext.selectedDataPipelineId,
      });
      if (!intent.active && !dataContext.authoringRequest && !needsClarification) {
        activations.clear(context.session.id);
        return {
          customTools: catalog,
          activateTools: [],
          toolPacks: DATA_TOOL_PACKS,
          toolContexts,
        };
      }

      const previous = activations.activePacks(context.session.id);
      const packNames =
        intent.continuation &&
        previous.size > 0 &&
        !dataContext.authoringRequest &&
        !hasPendingReceipts
          ? [...previous]
          : [
              intent.generate || dataContext.authoringRequest || hasPendingReceipts
                ? 'data.generate'
                : intent.run
                  ? 'data.run'
                  : 'data.core',
              ...(intent.file ? ['data.tables'] : []),
              ...(intent.normalizer ? ['data.normalizer'] : []),
              ...(intent.cloud ? ['data.cloud'] : []),
              ...(intent.authoring && !dataContext.authoringRequest ? ['data.authoring'] : []),
            ];
      const packs = activations.activate(context.session.id, packNames);
      let activateTools = [
        ...new Set(
          [...packs].flatMap(
            (pack) => DATA_TOOL_PACKS[pack as keyof typeof DATA_TOOL_PACKS]?.tools ?? []
          )
        ),
      ];
      // Confirmation does not remove inspection/re-analysis: a failed generation
      // may need both in the same run. Receipts enforce the confirmation boundary.
      if (
        intent.run &&
        !dataContext.authoringRequest &&
        !hasPendingReceipts &&
        !intent.authoring &&
        (/pipelineId\s*[=:]/i.test(context.prompt) ||
          (dataContext.selectedDataPipelineId &&
            /当前|这个|该任务|它|再(?:次|运行|执行)|重跑|再跑|current|this|again/i.test(
              context.prompt
            )))
      ) {
        activateTools = ['data_run_pipeline'];
      }
      return {
        stablePrompt: toolContexts[0].stablePrompt,
        statePrompt: toolContexts[0].statePrompt,
        customTools: catalog,
        activateTools,
        toolPacks: DATA_TOOL_PACKS,
        toolContexts,
      };
    },
    async onSessionDeleted({ sessionId }): Promise<void> {
      activations.clear(sessionId);
      dataToolService.clearConversationContext(sessionId);
    },
  };
}
