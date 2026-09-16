/**
 * Cross-process mcp contracts. Shared by main, preload, and renderer.
 * Must not import from main/, renderer/, or preload/.
 */
// MCP
// ---------------------------------------------------------------------------

/** Configuration for a single MCP server (mirrors MCPServerConfig in mcp-manager.ts). */
export interface McpServerConfig {
  id: string;
  name: string;
  type: 'stdio' | 'sse' | 'streamable-http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
}

/** Tool exposed by an MCP server (mirrors MCPTool in mcp-manager.ts). */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
  serverId: string;
  serverName: string;
}

/** Runtime status of a single MCP server. */
export interface McpServerStatus {
  id: string;
  name: string;
  connected: boolean;
  status: 'connecting' | 'connected' | 'failed' | 'disabled';
  toolCount: number;
}

/**
 * Preset MCP server configs returned by `mcp.getPresets`.
 * Each value is a partial MCPServerConfig (without `id` and `enabled`).
 */
export type McpPresetsMap = Record<
  string,
  Omit<McpServerConfig, 'id' | 'enabled'> & {
    requiresEnv?: string[];
    envDescription?: Record<string, string>;
  }
>;

// ---------------------------------------------------------------------------

// Legacy MCP info types used by diagnostics/IPC.
export interface MCPServerInfo {
  id: string;
  name: string;
  connected: boolean;
  toolCount: number;
  tools?: MCPToolInfo[];
}

export interface MCPToolInfo {
  name: string;
  description: string;
  serverId: string;
  serverName: string;
}
