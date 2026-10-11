import type {
  AgentRuntimeExtension,
  BeforeSessionRunResult,
} from '../extensions/agent-runtime-extension';
import type { MemoryService } from './memory-service';
import { buildMemoryAgentRuntimePrompt } from '../prompts/memory';
import { createMemoryUpdateCompatibilityTool } from './memory-update-compat-tool';
import { logWarn } from '../utils/logger';

export class MemoryExtension implements AgentRuntimeExtension {
  readonly name = 'memory';

  constructor(private readonly memoryService: MemoryService) {}

  async beforeSessionRun({
    session,
    prompt,
    signal,
  }: Parameters<
    NonNullable<AgentRuntimeExtension['beforeSessionRun']>
  >[0]): Promise<BeforeSessionRunResult | void> {
    const isEnabled = () => this.memoryService.isEnabled() && session.memoryEnabled;
    const enabled = isEnabled();
    let statePrompt: string | undefined;
    if (enabled) {
      try {
        statePrompt = await this.memoryService.buildPromptPrefix(session, prompt, signal);
      } catch (error) {
        // Retrieval failure must not remove the capability rules/compatibility
        // handler and bring back "Tool memory_update not found" on this turn.
        logWarn('[MemoryExtension] Memory context retrieval failed', error);
      }
    }

    // Retrieved memories are per-turn dynamic state, not stable domain rules.
    return {
      stablePrompt: buildMemoryAgentRuntimePrompt(enabled),
      statePrompt,
      customTools: [createMemoryUpdateCompatibilityTool(isEnabled)],
    };
  }

  async afterSessionRun({
    session,
    prompt,
    messages,
  }: Parameters<NonNullable<AgentRuntimeExtension['afterSessionRun']>>[0]): Promise<void> {
    if (!this.memoryService.isEnabled() || !session.memoryEnabled) {
      return;
    }
    await this.memoryService.enqueueIngestion({
      session,
      prompt,
      messages,
    });
  }

  async onSessionDeleted({
    sessionId,
  }: Parameters<NonNullable<AgentRuntimeExtension['onSessionDeleted']>>[0]): Promise<void> {
    await this.memoryService.deleteSession(sessionId);
  }
}
