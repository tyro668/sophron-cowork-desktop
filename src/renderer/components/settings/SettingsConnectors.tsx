import { mcpClient } from '../../features/mcp/api/mcp-client';
import { formatIpcError } from '../../utils/ipc-error';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Plug, Plus } from 'lucide-react';
import type { MCPServerConfig, MCPServerStatus, MCPToolInfo } from './shared';
import { showToast } from '../../utils/toast';
import { useConfirmDialog } from '../ConfirmDialog';
import {
  formatMcpTypeLabel,
  getMcpStatusDotClass,
  McpServerDetail,
  resolveMcpServerStatus,
} from './connectors/McpServerDetail';
import { McpServerForm } from './connectors/McpServerForm';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

export function SettingsConnectors({ isActive }: { isActive: boolean }) {
  const { t } = useTranslation();
  const { confirmDelete } = useConfirmDialog();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const [servers, setServers] = useState<MCPServerConfig[]>([]);
  const [statuses, setStatuses] = useState<MCPServerStatus[]>([]);
  const [tools, setTools] = useState<MCPToolInfo[]>([]);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [editingServer, setEditingServer] = useState<MCPServerConfig | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const loadServers = useCallback(async () => {
    try {
      const loaded = (await mcpClient.getServers()) as MCPServerConfig[];
      setServers(loaded || []);
      setError('');
    } catch (err) {
      console.error('Failed to load servers:', err);
      setError(tRef.current('mcp.loadServersFailed'));
    }
  }, []);

  const loadStatuses = useCallback(async () => {
    try {
      const loaded = (await mcpClient.getServerStatus()) as MCPServerStatus[];
      setStatuses(loaded || []);
    } catch (err) {
      console.error('Failed to load statuses:', err);
    }
  }, []);

  const loadTools = useCallback(async () => {
    try {
      const loaded = (await mcpClient.getTools()) as MCPToolInfo[];
      setTools(loaded || []);
    } catch (err) {
      console.error('Failed to load tools:', err);
    }
  }, []);

  const loadAll = useCallback(async () => {
    await Promise.all([loadServers(), loadStatuses(), loadTools()]);
  }, [loadServers, loadStatuses, loadTools]);

  useEffect(() => {
    if (!isElectron || !isActive) {
      return;
    }
    void loadAll();
    const interval = setInterval(() => {
      void loadTools();
      void loadStatuses();
    }, 3000);
    return () => clearInterval(interval);
  }, [isActive, loadAll, loadStatuses, loadTools]);

  useEffect(() => {
    if (error) {
      showToast('error', error);
      setError('');
    }
  }, [error]);

  // Keep a valid connector selected whenever the list changes.
  useEffect(() => {
    if (servers.length === 0) {
      setSelectedServerId(null);
      return;
    }
    if (!selectedServerId || !servers.some((item) => item.id === selectedServerId)) {
      setSelectedServerId(servers[0].id);
    }
  }, [selectedServerId, servers]);

  async function handleSaveServer(server: MCPServerConfig) {
    setIsLoading(true);
    setError('');
    try {
      const result = await mcpClient.saveServer(server);
      if (result && !result.success && result.error) {
        setError(result.error);
        return;
      }
      if (result?.authorizing) {
        showToast('success', t('mcp.authorizationOpened'));
      }
      await loadAll();
      setSelectedServerId(server.id);
      setEditingServer(null);
      setShowAddForm(false);
    } catch (err) {
      setError(formatIpcError(err, t('mcp.saveServerFailed')));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDeleteServer(serverId: string) {
    const confirmed = await confirmDelete({
      message: t('mcp.deleteConnectorConfirm'),
    });
    if (!confirmed) return;
    setIsLoading(true);
    try {
      await mcpClient.deleteServer(serverId);
      if (editingServer?.id === serverId) {
        setEditingServer(null);
      }
      await loadAll();
    } catch (err) {
      setError(formatIpcError(err, t('mcp.deleteServerFailed')));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleToggleEnabled(server: MCPServerConfig) {
    await handleSaveServer({ ...server, enabled: !server.enabled });
  }

  async function handleReauthorize(serverId: string) {
    setIsLoading(true);
    try {
      const result = await mcpClient.reauthorize(serverId);
      if (result && !result.success && result.error) {
        setError(result.error);
        return;
      }
      if (result?.authorizing) {
        showToast('success', t('mcp.authorizationOpened'));
      }
      await loadAll();
    } catch (err) {
      setError(formatIpcError(err, t('mcp.authorizationFailed')));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCancelAuth(serverId: string) {
    setIsLoading(true);
    try {
      await mcpClient.cancelAuthorization(serverId);
      showToast('success', t('mcp.authorizationCancelled'));
      await loadAll();
    } catch (err) {
      setError(formatIpcError(err, t('mcp.authorizationFailed')));
    } finally {
      setIsLoading(false);
    }
  }

  function getServerStatus(serverId: string) {
    return statuses.find((item) => item.id === serverId);
  }

  function getServerTools(serverId: string) {
    return tools.filter((item) => item.serverId === serverId);
  }

  function getStatusLabel(server: MCPServerConfig) {
    const serverStatus = resolveMcpServerStatus(server, getServerStatus(server.id));
    switch (serverStatus) {
      case 'connected':
        return t('mcp.connected');
      case 'failed':
        return t('mcp.failed');
      case 'authorizing':
        return t('mcp.authorizing');
      case 'needs_auth':
        return t('mcp.needsAuth');
      case 'connecting':
        return t('mcp.connecting');
      default:
        return t('mcp.disabled');
    }
  }

  const selectedServer = servers.find((item) => item.id === selectedServerId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[6px] border border-border-subtle bg-surface md:flex-row">
      {/* Left rail: flush, gapless connector list */}
      <aside className="flex w-full shrink-0 flex-col border-b border-border-subtle bg-background-secondary md:w-[232px] md:border-b-0 md:border-r lg:w-[248px]">
        <div className="flex h-9 shrink-0 items-stretch border-b border-border-subtle bg-surface-muted">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 px-3">
            <Plug className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            <h2 className="truncate text-[12px] font-semibold text-text-primary">
              {t('settings.connectors')}
            </h2>
            <span className="text-[11px] tabular-nums text-text-muted">{servers.length}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditingServer(null);
              setShowAddForm(true);
            }}
            disabled={isLoading}
            className="ui-accent-cell shrink-0 border-l border-border-subtle !px-2.5"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('common.add')}
          </button>
        </div>

        <div className="scrollbar-hover max-h-48 flex-1 overflow-y-auto md:max-h-none">
          {servers.length === 0 ? (
            <p className="px-3 py-6 text-center text-[12px] text-text-muted">
              {t('mcp.noConnectors')}
            </p>
          ) : (
            servers.map((server) => {
              const status = getServerStatus(server.id);
              const resolvedStatus = resolveMcpServerStatus(server, status);
              const serverTools = getServerTools(server.id);
              const isSelected = !showAddForm && selectedServerId === server.id;
              return (
                <button
                  key={server.id}
                  type="button"
                  onClick={() => {
                    setShowAddForm(false);
                    setEditingServer(null);
                    setSelectedServerId(server.id);
                  }}
                  aria-pressed={isSelected}
                  className={`flex w-full min-w-0 flex-col gap-0.5 border-b border-border-subtle px-3 py-2 text-left transition-colors ${
                    isSelected
                      ? 'bg-accent-muted text-text-primary shadow-[inset_3px_0_0_var(--color-accent)]'
                      : 'bg-surface text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${getMcpStatusDotClass(resolvedStatus)}`}
                    />
                    <span
                      className={`min-w-0 flex-1 truncate text-[12.5px] leading-4 ${
                        isSelected ? 'font-semibold text-accent' : 'font-medium text-text-primary'
                      }`}
                    >
                      {server.name}
                    </span>
                    {serverTools.length > 0 && (
                      <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-text-muted">
                        {serverTools.length}
                      </span>
                    )}
                  </div>
                  <div className="flex min-w-0 items-center gap-1.5 pl-4 text-[11px] leading-3.5 text-text-muted">
                    <span className="shrink-0 font-mono text-[10px]">
                      {formatMcpTypeLabel(server.type)}
                    </span>
                    <span>·</span>
                    <span className="truncate">{getStatusLabel(server)}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="flex h-9 shrink-0 items-center border-t border-border-subtle bg-surface px-3 text-[11.5px] text-text-muted">
          {t('mcp.toolsAvailable', { count: tools.length })}
        </div>
      </aside>

      {/* Right pane: add/edit form, selected connector detail, or empty state */}
      {showAddForm || editingServer ? (
        <McpServerForm
          key={editingServer?.id || 'new'}
          server={editingServer || undefined}
          onSave={handleSaveServer}
          onCancel={() => {
            setShowAddForm(false);
            setEditingServer(null);
          }}
          isLoading={isLoading}
        />
      ) : selectedServer ? (
        <McpServerDetail
          server={selectedServer}
          status={getServerStatus(selectedServer.id)}
          tools={getServerTools(selectedServer.id)}
          onEdit={() => setEditingServer(selectedServer)}
          onDelete={() => void handleDeleteServer(selectedServer.id)}
          onToggleEnabled={() => void handleToggleEnabled(selectedServer)}
          onReauthorize={() => void handleReauthorize(selectedServer.id)}
          onCancelAuth={() => void handleCancelAuth(selectedServer.id)}
          isLoading={isLoading}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-8 text-center">
          <Plug className="mb-2.5 h-5 w-5 text-text-muted" />
          <p className="text-[12.5px] font-medium text-text-secondary">{t('mcp.noConnectors')}</p>
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            className="ui-accent-cell mt-3 h-8 border border-border-subtle"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('mcp.addCustomConnector')}
          </button>
        </div>
      )}
    </div>
  );
}
