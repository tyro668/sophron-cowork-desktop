import { useState } from 'react';
import { ChevronDown, ChevronRight, Edit3, Plug, Power, PowerOff, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/button';
import type { MCPServerConfig, MCPServerStatus, MCPToolInfo } from '../shared';

export function McpServerCard({
  server,
  status,
  toolCount,
  tools,
  onEdit,
  onDelete,
  onToggleEnabled,
  onReauthorize,
  onCancelAuth,
  isLoading,
}: {
  server: MCPServerConfig;
  status?: MCPServerStatus;
  toolCount: number;
  tools: MCPToolInfo[];
  onEdit: () => void;
  onDelete: () => void;
  onToggleEnabled: () => void;
  onReauthorize: () => void;
  onCancelAuth: () => void;
  isLoading: boolean;
}) {
  const { t } = useTranslation();
  // Fall back to 'connecting' for enabled servers when status poll hasn't returned yet
  const serverStatus = status?.status ?? (server.enabled ? 'connecting' : 'disabled');
  const [showTools, setShowTools] = useState(false);

  return (
    <div className="ui-group bg-surface">
      <div className="p-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <div
                className={`w-3 h-3 rounded-full ${
                  serverStatus === 'connected'
                    ? 'bg-success'
                    : serverStatus === 'failed'
                      ? 'bg-error'
                      : serverStatus === 'connecting' ||
                          serverStatus === 'authorizing' ||
                          serverStatus === 'needs_auth'
                        ? 'bg-warning'
                        : 'bg-text-muted'
                }`}
              />
              <h3 className="font-medium text-text-primary">{server.name}</h3>
              <span className="px-2 py-0.5 text-xs rounded bg-surface-muted text-text-muted">
                {server.type.toUpperCase()}
              </span>
            </div>
            <div className="text-sm text-text-muted space-y-1 ml-6 min-w-0">
              {server.type === 'stdio' && (
                <div
                  className="font-mono text-xs truncate"
                  title={`${server.command} ${server.args?.join(' ') || ''}`}
                >
                  {server.command} {server.args?.join(' ') || ''}
                </div>
              )}
              {(server.type === 'sse' || server.type === 'streamable-http') && (
                <div className="font-mono text-xs truncate" title={server.url}>
                  {server.url}
                </div>
              )}
              <div
                className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md w-fit ${
                  serverStatus === 'connected'
                    ? 'bg-success/10 text-success'
                    : serverStatus === 'failed'
                      ? 'bg-error/10 text-error'
                      : serverStatus === 'connecting' ||
                          serverStatus === 'authorizing' ||
                          serverStatus === 'needs_auth'
                        ? 'bg-warning/10 text-warning'
                        : 'bg-accent-muted text-accent'
                }`}
              >
                {serverStatus === 'connected'
                  ? `✓ ${t('mcp.connected')}`
                  : serverStatus === 'failed'
                    ? t('mcp.failed', { defaultValue: 'Connection failed' })
                    : serverStatus === 'authorizing'
                      ? `⏳ ${t('mcp.authorizing')}`
                      : serverStatus === 'needs_auth'
                        ? t('mcp.needsAuth')
                        : serverStatus === 'connecting'
                          ? `⏳ ${t('mcp.connecting')}`
                          : t('mcp.disabled')}
              </div>
              {(serverStatus === 'authorizing' ||
                serverStatus === 'needs_auth' ||
                (serverStatus === 'failed' &&
                  (server.type === 'sse' || server.type === 'streamable-http'))) && (
                <div className="flex items-center gap-2 mt-1">
                  {serverStatus === 'authorizing' ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-7 px-2.5 text-xs"
                      disabled={isLoading}
                      onClick={onCancelAuth}
                    >
                      {t('mcp.cancelAuthorization')}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-7 px-2.5 text-xs"
                      disabled={isLoading}
                      onClick={onReauthorize}
                    >
                      {t('mcp.reauthorize')}
                    </Button>
                  )}
                </div>
              )}
              <div className="flex items-center gap-4 mt-2">
                <button
                  onClick={() => setShowTools(!showTools)}
                  className="flex items-center gap-1 hover:text-accent transition-colors"
                >
                  <Plug className="w-3 h-3" />
                  <span>{t('mcp.toolsAvailable', { count: toolCount })}</span>
                  {showTools ? (
                    <ChevronDown className="w-3 h-3" />
                  ) : (
                    <ChevronRight className="w-3 h-3" />
                  )}
                </button>
              </div>

              {showTools && tools.length > 0 && (
                <div className="mt-3 p-3 rounded-lg bg-surface-muted border border-border">
                  <div className="text-xs font-medium text-text-primary mb-2">
                    {t('mcp.toolsAvailable', { count: tools.length }).split(' ').slice(1).join(' ')}
                    :
                  </div>
                  <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto">
                    {tools.map((tool, idx) => {
                      // Extract only the part after the last double underscore
                      const parts = tool.name.split('__');
                      const displayName = parts.length > 1 ? parts[parts.length - 1] : tool.name;
                      return (
                        <div
                          key={idx}
                          className="px-2 py-1.5 rounded bg-surface border border-border-muted text-xs text-text-secondary"
                          title={tool.description || tool.name}
                        >
                          <div className="font-mono text-accent break-words whitespace-normal">
                            {displayName}
                          </div>
                          {tool.description && (
                            <div className="text-text-muted mt-0.5 break-words whitespace-normal">
                              {tool.description}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {showTools && tools.length === 0 && (
                <div className="mt-3 p-3 rounded-lg bg-surface-muted text-xs text-text-muted">
                  {t('mcp.notConnected')}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleEnabled}
              disabled={isLoading}
              className={
                server.enabled
                  ? 'bg-success/10 text-success hover:bg-success/20 hover:text-success'
                  : 'bg-surface-muted text-text-muted hover:bg-surface-active'
              }
              title={server.enabled ? t('common.disable') : t('common.enable')}
              aria-label={server.enabled ? t('common.disable') : t('common.enable')}
            >
              {server.enabled ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onEdit}
              disabled={isLoading}
              className="bg-surface-muted hover:bg-surface-active"
              title={t('common.edit')}
              aria-label={t('common.edit')}
            >
              <Edit3 className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onDelete}
              disabled={isLoading}
              className="bg-error/10 text-error hover:bg-error/20 hover:text-error"
              title={t('common.delete')}
              aria-label={t('common.delete')}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
