import type {
  AgentRuntimeExtension,
  BeforeSessionRunResult,
} from '../extensions/agent-runtime-extension';
import type { DataToolService } from './data-tool-service';
import { createDataCustomTools } from './data-tool-definitions';
import { buildDataToolPrompt } from './data-tool-prompt';

export function createDataAgentRuntimeExtension(
  dataToolService: DataToolService
): AgentRuntimeExtension {
  return {
    name: 'data-tools',
    async beforeSessionRun(context): Promise<BeforeSessionRunResult> {
      const dataContext = await dataToolService.resolveConversationContext(context);
      return {
        promptPrefix: buildDataToolPrompt(dataContext),
        customTools: createDataCustomTools(dataToolService, dataContext),
      };
    },
  };
}
