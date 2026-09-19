/**
 * MCP tool bridging for the agent runner: wraps MCPManager tools as pi
 * ToolDefinition[] custom tools whose execute() delegates to callTool and
 * normalizes results for the model.
 */
import { Type, type TSchema } from '@sinclair/typebox';
import type { AgentSession, ToolDefinition } from '@mariozechner/pi-coding-agent';
import type { MCPManager } from '../mcp/mcp-manager';
import type { AgentToolPack } from '../extensions/agent-runtime-extension';
import { normalizeMcpToolResultForModel } from './tool-result-utils';
import { logError } from '../utils/logger';

export function buildMcpCustomTools(mcpManager: MCPManager): ToolDefinition[] {
  const mcpTools = mcpManager.getTools();
  return mcpTools.map((mcpTool) => {
    // Wrap the raw JSON Schema inputSchema as a TypeBox TSchema
    const parameters = Type.Unsafe<Record<string, unknown>>(
      mcpTool.inputSchema as Record<string, unknown>
    );

    const toolDef: ToolDefinition<TSchema, unknown> = {
      name: mcpTool.name,
      label: `${mcpTool.serverName} → ${mcpTool.originalName || mcpTool.name}`,
      description: mcpTool.description || `MCP tool from ${mcpTool.serverName}`,
      parameters,
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        try {
          const result = await mcpManager.callTool(mcpTool.name, params as Record<string, unknown>);
          const normalizedResult = normalizeMcpToolResultForModel(result);
          return {
            content: [{ type: 'text' as const, text: normalizedResult.text }],
            details:
              normalizedResult.images.length > 0
                ? { sophronImages: normalizedResult.images }
                : undefined,
          };
        } catch (err: unknown) {
          logError(`[AgentRunner] MCP tool ${mcpTool.name} failed:`, err);
          throw err instanceof Error ? err : new Error(String(err));
        }
      },
    };
    return toolDef;
  });
}

/**
 * Group MCP tools into one discoverable pack per server. MCP tools stay
 * registered but hidden until activated via capabilities_search — connected
 * servers can add dozens of schemas that should not ship in every request.
 */
export function buildMcpToolPacks(mcpManager: MCPManager): Record<string, AgentToolPack> {
  const byServer = new Map<string, string[]>();
  for (const tool of mcpManager.getTools()) {
    const key = `mcp.${tool.serverName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
    const list = byServer.get(key) ?? [];
    list.push(tool.name);
    byServer.set(key, list);
  }
  return Object.fromEntries(
    [...byServer.entries()].map(([name, tools]) => [
      name,
      { description: `MCP tools from connected server "${name.slice(4)}"`, tools },
    ])
  );
}

/**
 * Apply a new active-tool set in place. The SDK's `setActiveToolsByName`
 * replaces `agent.state.tools` with a fresh array, but a running agent loop
 * captured the previous array instance in its context (`context.tools` is the
 * same reference — not a copy) — so mid-run activations via the public API
 * would only take effect on the next prompt. Mutating the live array makes the
 * next loop iteration see the new tools immediately. Falls back to the public
 * API when SDK internals differ from the expected shape.
 */
export function applyActiveToolsInPlace(piSession: AgentSession, toolNames: string[]): string[] {
  const internals = piSession as unknown as {
    _toolRegistry?: Map<string, { name: string }>;
    _rebuildSystemPrompt?: (toolNames: string[]) => string;
    _baseSystemPrompt?: string;
  };
  const agent = piSession.agent as unknown as {
    state?: { tools?: Array<{ name: string }> };
    setSystemPrompt?: (prompt: string) => void;
  };
  const liveTools = agent?.state?.tools;
  const registry = internals._toolRegistry;
  if (
    !Array.isArray(liveTools) ||
    !registry ||
    typeof agent.setSystemPrompt !== 'function' ||
    typeof internals._rebuildSystemPrompt !== 'function'
  ) {
    piSession.setActiveToolsByName(toolNames);
    return piSession.getActiveToolNames();
  }
  const resolved: Array<{ name: string }> = [];
  const validNames: string[] = [];
  for (const name of new Set(toolNames)) {
    const tool = registry.get(name);
    if (tool) {
      resolved.push(tool);
      validNames.push(name);
    }
  }
  liveTools.length = 0;
  liveTools.push(...resolved);
  internals._baseSystemPrompt = internals._rebuildSystemPrompt.call(piSession, validNames);
  agent.setSystemPrompt(internals._baseSystemPrompt);
  return validNames;
}

/**
 * Get shell environment with proper PATH (including node, npm, etc.)
 * GUI apps on macOS don't inherit shell PATH, so we need to extract it
 */
