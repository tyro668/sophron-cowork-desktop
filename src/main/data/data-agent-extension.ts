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
      });

      // The full catalog stays registered every turn so packs can be activated
      // later without rebuilding the session; only the subset is exposed.
      const catalog = createDataCustomTools(dataToolService, dataContext);
      const intent = detectDataIntent(context, {
        stickyActive: activations.activePacks(context.session.id).size > 0,
        hasPendingReceipts: dataToolService.hasPendingAnalysis(context.session.id),
      });
      if (!intent.active) {
        return { customTools: catalog, activateTools: [], toolPacks: DATA_TOOL_PACKS };
      }

      const packs = activations.activate(context.session.id, [
        'data.core',
        ...(intent.file ? (['data.tables'] as const) : []),
        ...(intent.normalizer ? (['data.normalizer'] as const) : []),
        ...(intent.cloud ? (['data.cloud'] as const) : []),
        ...(intent.authoring ? (['data.authoring'] as const) : []),
      ]);
      const activateTools = [...packs].flatMap(
        (pack) => DATA_TOOL_PACKS[pack as keyof typeof DATA_TOOL_PACKS]?.tools ?? []
      );
      return {
        stablePrompt: buildDataToolStablePrompt(),
        statePrompt: buildDataToolStatePrompt(dataContext),
        customTools: catalog,
        activateTools,
        toolPacks: DATA_TOOL_PACKS,
      };
    },
    async onSessionDeleted({ sessionId }): Promise<void> {
      activations.clear(sessionId);
      dataToolService.clearConversationContext(sessionId);
    },
  };
}
