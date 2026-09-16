import { appContext } from '../../app/context';
import { handleIpc } from '../../ipc-handle';
import { mcpConfigStore } from '../../mcp/mcp-config-store';
import type { MCPServerConfig } from '../../mcp/mcp-manager';
import { log, logError } from '../../utils/logger';

export function registerMcpIpc(): void {
  // MCP Server IPC handlers
  handleIpc('mcp.getServers', () => {
    try {
      return mcpConfigStore.getServers();
    } catch (error) {
      logError('[MCP] Error getting servers:', error);
      return [];
    }
  });

  handleIpc('mcp.getServer', (_event, serverId: string) => {
    try {
      return mcpConfigStore.getServer(serverId);
    } catch (error) {
      logError('[MCP] Error getting server:', error);
      return null;
    }
  });

  handleIpc('mcp.saveServer', async (_event, config: MCPServerConfig) => {
    mcpConfigStore.saveServer(config);
    // Update only this specific server, not all servers
    if (appContext.sessionManager) {
      const mcpManager = appContext.sessionManager.getMCPManager();
      try {
        await mcpManager.updateServer(config);
        appContext.sessionManager.invalidateMcpServersCache();
        log(`[MCP] Server ${config.name} updated successfully`);
      } catch (err) {
        logError('[MCP] Failed to update server:', err);
        // Roll back: save the config with enabled=false so a broken connector
        // is not retried on next app startup
        if (config.enabled) {
          mcpConfigStore.saveServer({ ...config, enabled: false });
        }
        const errorMessage = err instanceof Error ? err.message : String(err);
        return { success: false, error: errorMessage };
      }
    }
    return { success: true };
  });

  handleIpc('mcp.deleteServer', async (_event, serverId: string) => {
    mcpConfigStore.deleteServer(serverId);
    // Remove and disconnect only this specific server
    if (appContext.sessionManager) {
      const mcpManager = appContext.sessionManager.getMCPManager();
      try {
        await mcpManager.removeServer(serverId);
        appContext.sessionManager.invalidateMcpServersCache();
        log(`[MCP] Server ${serverId} removed successfully`);
      } catch (err) {
        logError('[MCP] Failed to remove server:', err);
      }
    }
    return { success: true };
  });

  handleIpc('mcp.getTools', () => {
    try {
      if (!appContext.sessionManager) {
        return [];
      }
      const mcpManager = appContext.sessionManager.getMCPManager();
      return mcpManager.getTools();
    } catch (error) {
      logError('[MCP] Error getting tools:', error);
      return [];
    }
  });

  handleIpc('mcp.getServerStatus', () => {
    try {
      if (!appContext.sessionManager) {
        return [];
      }
      const mcpManager = appContext.sessionManager.getMCPManager();
      return mcpManager.getServerStatus();
    } catch (error) {
      logError('[MCP] Error getting server status:', error);
      return [];
    }
  });

  handleIpc('mcp.getPresets', () => {
    try {
      return mcpConfigStore.getPresets();
    } catch (error) {
      logError('[MCP] Error getting presets:', error);
      return {};
    }
  });
}
