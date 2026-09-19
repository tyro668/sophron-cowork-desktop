import type {
  AgentRuntimeCustomTool,
  AgentRuntimeExtension,
  AfterSessionRunContext,
  BeforeSessionRunContext,
  BeforeSessionRunResult,
  SessionDeletedContext,
} from './agent-runtime-extension';
import { logError, logWarn } from '../utils/logger';

function mergeCustomTools(tools: AgentRuntimeCustomTool[]): AgentRuntimeCustomTool[] {
  const merged = new Map<string, AgentRuntimeCustomTool>();
  for (const tool of tools) {
    if (!tool?.name) {
      continue;
    }
    if (merged.has(tool.name)) {
      logWarn(`[AgentRuntimeExtensionManager] Duplicate custom tool overridden: ${tool.name}`);
    }
    merged.set(tool.name, tool);
  }
  return Array.from(merged.values());
}

export class AgentRuntimeExtensionManager {
  private readonly extensions: AgentRuntimeExtension[];

  constructor(extensions: AgentRuntimeExtension[] = []) {
    this.extensions = [...extensions];
  }

  register(extension: AgentRuntimeExtension): void {
    this.extensions.push(extension);
  }

  async beforeSessionRun(context: BeforeSessionRunContext): Promise<BeforeSessionRunResult> {
    const stablePrompts: string[] = [];
    const statePrompts: string[] = [];
    const customTools: AgentRuntimeCustomTool[] = [];
    const activateTools = new Set<string>();
    const toolPacks: BeforeSessionRunResult['toolPacks'] = {};

    for (const extension of this.extensions) {
      if (!extension.beforeSessionRun) {
        continue;
      }
      try {
        const result = await extension.beforeSessionRun(context);
        if (!result) {
          continue;
        }
        if (result.stablePrompt?.trim()) {
          stablePrompts.push(result.stablePrompt.trim());
        }
        if (result.statePrompt?.trim()) {
          statePrompts.push(result.statePrompt.trim());
        }
        if (result.customTools?.length) {
          customTools.push(...result.customTools);
          // Extensions that declare a catalog without an activation subset keep
          // every tool exposed — restricting is opt-in via activateTools.
          for (const toolName of result.activateTools ?? result.customTools.map((t) => t.name)) {
            activateTools.add(toolName);
          }
        } else if (result.activateTools?.length) {
          for (const toolName of result.activateTools) {
            activateTools.add(toolName);
          }
        }
        if (result.toolPacks) {
          Object.assign(toolPacks, result.toolPacks);
        }
      } catch (error) {
        logError(
          `[AgentRuntimeExtensionManager] beforeSessionRun failed for ${extension.name}:`,
          error
        );
      }
    }

    return {
      stablePrompt: stablePrompts.join('\n\n').trim() || undefined,
      statePrompt: statePrompts.join('\n\n').trim() || undefined,
      customTools: mergeCustomTools(customTools),
      activateTools: [...activateTools],
      toolPacks,
    };
  }

  async afterSessionRun(context: AfterSessionRunContext): Promise<void> {
    await Promise.allSettled(
      this.extensions.map(async (extension) => {
        if (!extension.afterSessionRun) {
          return;
        }
        try {
          await extension.afterSessionRun(context);
        } catch (error) {
          logError(
            `[AgentRuntimeExtensionManager] afterSessionRun failed for ${extension.name}:`,
            error
          );
        }
      })
    );
  }

  async onSessionDeleted(context: SessionDeletedContext): Promise<void> {
    await Promise.allSettled(
      this.extensions.map(async (extension) => {
        if (!extension.onSessionDeleted) {
          return;
        }
        try {
          await extension.onSessionDeleted(context);
        } catch (error) {
          logError(
            `[AgentRuntimeExtensionManager] onSessionDeleted failed for ${extension.name}:`,
            error
          );
        }
      })
    );
  }
}
