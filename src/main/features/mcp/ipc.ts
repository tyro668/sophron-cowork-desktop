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
    // Persist first so a required OAuth login does not lose the connector.
    mcpConfigStore.saveServer(config);
    if (appContext.sessionManager) {
      const mcpManager = appContext.sessionManager.getMCPManager();
      try {
        const result = await mcpManager.updateServer(config, { interactiveAuth: true });
        appContext.sessionManager.invalidateMcpServersCache();
        if (result.authorizing) {
          log(`[MCP] Server ${config.name} saved; waiting for browser authorization`);
          return { success: true, authorizing: true };
        }
        if (result.needsAuth) {
          log(`[MCP] Server ${config.name} saved; authorization is required`);
          return { success: true, needsAuth: true };
        }
        log(`[MCP] Server ${config.name} updated successfully`);
      } catch (err) {
        logError('[MCP] Failed to update server:', err);
        // Roll back enabled=false only for non-auth connection failures so a
        // broken connector is not retried on next app startup.
        if (config.enabled) {
          mcpConfigStore.saveServer({ ...config, enabled: false });
        }
        const errorMessage = err instanceof Error ? err.message : String(err);
        return { success: false, error: errorMessage };
      }
    }
    return { success: true };
  });

  handleIpc('mcp.cancelAuthorization', async (_event, serverId: string) => {
    if (!appContext.sessionManager) return { success: true };
    try {
      await appContext.sessionManager.getMCPManager().cancelAuthorization(serverId);
      return { success: true };
    } catch (err) {
      logError('[MCP] Failed to cancel authorization:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  handleIpc('mcp.reauthorize', async (_event, serverId: string) => {
    if (!appContext.sessionManager) {
      return { success: false, error: 'Session manager is not ready' };
    }
    try {
      const result = await appContext.sessionManager.getMCPManager().reauthorizeServer(serverId);
      appContext.sessionManager.invalidateMcpServersCache();
      if (result.authorizing) return { success: true, authorizing: true };
      if (result.needsAuth) return { success: true, needsAuth: true };
      return { success: true };
    } catch (err) {
      logError('[MCP] Failed to reauthorize server:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
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
