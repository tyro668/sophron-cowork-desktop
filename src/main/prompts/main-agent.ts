import mainAgentSystemPrompt from './main-agent-system.txt?raw';
import { renderPromptTemplate } from './template';

export function buildMainAgentSystemPrompt(input: {
  workspaceInfo?: string;
  bundledPathHints?: string;
}): string {
  return renderPromptTemplate(
    mainAgentSystemPrompt,
    {
      WORKSPACE_INFO: input.workspaceInfo?.trim() ?? '',
      BUNDLED_PATH_HINTS: input.bundledPathHints?.trim() ?? '',
    },
    { omitEmptySections: true }
  );
}
