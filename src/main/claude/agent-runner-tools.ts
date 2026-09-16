/**
 * MCP tool bridging for the agent runner: wraps MCPManager tools as pi
 * ToolDefinition[] custom tools whose execute() delegates to callTool and
 * normalizes results for the model.
 */
import { Type, type TSchema } from '@sinclair/typebox';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import type { MCPManager } from '../mcp/mcp-manager';
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
          logError(`[ClaudeAgentRunner] MCP tool ${mcpTool.name} failed:`, err);
          throw err instanceof Error ? err : new Error(String(err));
        }
      },
    };
    return toolDef;
  });
}

/**
 * Get shell environment with proper PATH (including node, npm, etc.)
 * GUI apps on macOS don't inherit shell PATH, so we need to extract it
 */
