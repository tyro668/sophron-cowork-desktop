/**
 * MCP tool bridging for the agent runner: wraps MCPManager tools as pi
 * ToolDefinition[] custom tools whose execute() delegates to callTool and
 * normalizes results for the model.
 */
import { Type, type TSchema } from 'typebox';
import type { JsonObject } from '@earendil-works/pi-ai';
import type { AgentSession, ToolDefinition } from '@earendil-works/pi-coding-agent';
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
      label: `${mcpTool.serverName} → ${mcpTool.originalName}`,
      description: mcpTool.description || `MCP tool from ${mcpTool.serverName}`,
      parameters,
      async execute(toolCallId, params, signal) {
        try {
          const result = await mcpManager.callTool(
            mcpTool.name,
            params as Record<string, unknown>,
            signal,
            toolCallId
          );
          const normalizedResult = normalizeMcpToolResultForModel(result);
          const isError =
            typeof result === 'object' &&
            result !== null &&
            'isError' in result &&
            result.isError === true;
          return {
            content: [{ type: 'text' as const, text: normalizedResult.text }],
            isError,
            ...(result &&
            typeof result === 'object' &&
            'structuredContent' in result &&
            result.structuredContent
              ? { structuredContent: result.structuredContent as JsonObject }
              : {}),
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
  const byServer = new Map<string, AgentToolPack>();
  for (const tool of mcpManager.getTools()) {
    const key = `mcp.${encodeURIComponent(tool.serverId)}`;
    const pack = byServer.get(key) ?? {
      description: `MCP tools from connected server ${JSON.stringify(tool.serverName)}`,
      tools: [],
    };
    pack.tools.push(tool.name);
    byServer.set(key, pack);
  }
  return Object.fromEntries(byServer);
}

/** Recompute exposure every turn; previous discovery never implies a new intent. */
export function selectActiveToolsForTurn(
  current: string[],
  registered: Set<string>,
  scopedCatalog: Set<string>,
  requested: Iterable<string>
): string[] {
  return [...new Set([...current.filter((name) => !scopedCatalog.has(name)), ...requested])].filter(
    (name) => registered.has(name)
  );
}

export function activateSessionTools(session: AgentSession, names: string[]): string[] {
  session.setActiveToolsByName([...new Set(names)]);
  return session.getActiveToolNames();
}

/** Pi 1.5 exposes activation publicly; changing the registered definitions still requires its registry hook. */
export function replaceSessionToolRegistry(
  session: AgentSession,
  definitions: ToolDefinition[]
): void {
  const registry = session as unknown as {
    _customTools: ToolDefinition[];
    _refreshToolRegistry: () => void;
  };
  registry._customTools = definitions;
  registry._refreshToolRegistry();
}
