import { mcpClient } from '../../features/mcp/api/mcp-client';
import { formatIpcError } from '../../utils/ipc-error';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Plug, CheckCircle, Plus, ChevronDown, X } from 'lucide-react';
import type { MCPServerConfig, MCPServerStatus, MCPToolInfo, MCPPreset } from './shared';
import { showToast } from '../../utils/toast';
import { useConfirmDialog } from '../ConfirmDialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { McpServerCard } from './connectors/McpServerCard';
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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [editingServer, setEditingServer] = useState<MCPServerConfig | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [presets, setPresets] = useState<Record<string, MCPPreset>>({});
  const [showPresets, setShowPresets] = useState(true);
  const [configuringPreset, setConfiguringPreset] = useState<{
    key: string;
    preset: MCPPreset;
  } | null>(null);
  const [presetEnvValues, setPresetEnvValues] = useState<Record<string, string>>({});

  // Auto-refresh
  const loadPresets = useCallback(async () => {
    try {
      const loaded = (await mcpClient.getPresets()) as Record<string, MCPPreset>;
      setPresets(loaded || {});
    } catch (err) {
      console.error('Failed to load presets:', err);
    }
  }, []);

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
    await Promise.all([loadServers(), loadStatuses(), loadTools(), loadPresets()]);
  }, [loadPresets, loadServers, loadStatuses, loadTools]);

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

  async function handleAddPreset(presetKey: string) {
    const preset = presets[presetKey];
    if (!preset) return;

    const existing = servers.find((s) => s.name === preset.name && s.command === preset.command);
    if (existing) {
      setError(t('mcp.presetAlreadyConfigured', { name: preset.name }));
      return;
    }

    // Check if preset requires environment variables
    if (preset.requiresEnv && preset.requiresEnv.length > 0) {
      // Initialize env values from preset defaults
      const initialEnv: Record<string, string> = {};
      preset.requiresEnv.forEach((key: string) => {
        initialEnv[key] = preset.env?.[key] || '';
      });
      setPresetEnvValues(initialEnv);
      setConfiguringPreset({ key: presetKey, preset });
      return;
    }

    // No env required, add directly
    await addPresetServer(presetKey, preset, {});
  }

  async function addPresetServer(
    presetKey: string,
    preset: MCPPreset,
    envOverrides: Record<string, string>
  ) {
    const serverConfig: MCPServerConfig = {
      id: `mcp-${presetKey}-${Date.now()}`,
      name: preset.name,
      type: preset.type,
      // STDIO fields
      command: preset.command,
      args: preset.args,
      env: { ...preset.env, ...envOverrides },
      // SSE fields
      url: preset.url,
      headers: preset.headers,
      enabled: false,
    };

    await handleSaveServer(serverConfig);
    setShowPresets(false);
    setConfiguringPreset(null);
    setPresetEnvValues({});
  }

  async function handleSaveServer(server: MCPServerConfig) {
    setIsLoading(true);
    setError('');
    try {
      const result = await mcpClient.saveServer(server);
      if (result && !result.success && result.error) {
        setError(result.error);
        // Keep form open so the user can see and act on the error
        return;
      }
      if (result?.authorizing) {
        showToast('success', t('mcp.authorizationOpened'));
      }
      await loadAll();
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
    return statuses.find((s) => s.id === serverId);
  }

  function getServerTools(serverId: string) {
    return tools.filter((t) => t.serverId === serverId);
  }

  return (
    <div className="space-y-4">
      {/* Add/Edit Form */}
      {(showAddForm || editingServer) && (
        <McpServerForm
          server={editingServer || undefined}
          onSave={handleSaveServer}
          onCancel={() => {
            setShowAddForm(false);
            setEditingServer(null);
          }}
          isLoading={isLoading}
        />
      )}

      {/* Server List */}
      {!showAddForm && !editingServer && (
        <div className="space-y-3">
          {servers.length === 0 ? (
            <div className="ui-group bg-surface text-center py-8 text-text-muted">
              <Plug className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p>{t('mcp.noConnectors')}</p>
              <p className="text-sm mt-1">{t('mcp.addConnector')}</p>
            </div>
          ) : (
            servers.map((server) => {
              const status = getServerStatus(server.id);
              const serverTools = getServerTools(server.id);

              return (
                <McpServerCard
                  key={server.id}
                  server={server}
                  status={status}
                  toolCount={serverTools.length}
                  tools={serverTools}
                  onEdit={() => setEditingServer(server)}
                  onDelete={() => handleDeleteServer(server.id)}
                  onToggleEnabled={() => handleToggleEnabled(server)}
                  onReauthorize={() => handleReauthorize(server.id)}
                  onCancelAuth={() => handleCancelAuth(server.id)}
                  isLoading={isLoading}
                />
              );
            })
          )}
        </div>
      )}

      {/* Preset Environment Configuration Modal */}
      {configuringPreset && (
        <div className="p-4 rounded-lg border border-accent/30 bg-accent-muted space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-text-primary">
              {t('mcp.configure')} {configuringPreset.preset.name}
            </h3>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setConfiguringPreset(null);
                setPresetEnvValues({});
              }}
              className="h-7 w-7 text-text-muted"
              aria-label={t('common.close')}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-xs text-text-muted">
            This connector requires configuration before it can be added.
          </p>
          <div className="space-y-3">
            {configuringPreset.preset.requiresEnv?.map((envKey: string) => (
              <div key={envKey}>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  {configuringPreset.preset.envDescription?.[envKey] || envKey}
                </label>
                <Input
                  type="password"
                  value={presetEnvValues[envKey] || ''}
                  onChange={(e) =>
                    setPresetEnvValues((prev) => ({ ...prev, [envKey]: e.target.value }))
                  }
                  placeholder={`Enter ${envKey}`}
                  className="h-auto border-border px-3 py-2 text-sm"
                />
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setConfiguringPreset(null);
                setPresetEnvValues({});
              }}
              className="text-sm"
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() =>
                void addPresetServer(
                  configuringPreset.key,
                  configuringPreset.preset,
                  presetEnvValues
                )
              }
              disabled={
                isLoading ||
                configuringPreset.preset.requiresEnv?.some(
                  (key: string) => !presetEnvValues[key]?.trim()
                )
              }
              className="px-4 text-sm"
            >
              {t('common.add')}
            </Button>
          </div>
        </div>
      )}

      {/* Preset Servers */}
      {!showAddForm && !editingServer && !configuringPreset && Object.keys(presets).length > 0 && (
        <div className="ui-group bg-surface">
          <button
            onClick={() => setShowPresets(!showPresets)}
            className="ui-group-title w-full justify-between hover:bg-surface-hover"
          >
            <h3 className="text-[12px] font-semibold text-text-primary">
              {t('mcp.quickAddPresets')}
            </h3>
            <div className="flex items-center gap-1.5 text-text-muted">
              <span className="text-xs">{showPresets ? t('mcp.hide') : t('mcp.show')}</span>
              <ChevronDown
                className={`w-4 h-4 transition-transform ${showPresets ? 'rotate-180' : ''}`}
              />
            </div>
          </button>
          {showPresets && (
            <div>
              {Object.entries(presets).map(([key, preset]) => {
                const isAdded = servers.some(
                  (s) => s.name === preset.name && s.command === preset.command
                );
                const requiresConfig = preset.requiresEnv && preset.requiresEnv.length > 0;
                return (
                  <div
                    key={key}
                    className={`flex items-center gap-3 border-b border-border-subtle px-3 py-2 last:border-b-0 ${
                      isAdded ? 'bg-surface-muted opacity-60' : ''
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-text-primary">{preset.name}</span>
                        {requiresConfig && !isAdded && (
                          <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-warning/10 text-warning border border-warning/20">
                            {t('mcp.requiresToken')}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-text-muted mt-0.5 truncate">
                        {preset.type === 'stdio'
                          ? `${preset.command} ${preset.args?.join(' ') || ''}`
                          : preset.url || 'Remote server'}
                      </div>
                    </div>
                    {isAdded ? (
                      <div className="flex items-center gap-1 text-success text-xs whitespace-nowrap">
                        <CheckCircle className="w-4 h-4" />
                        <span>{t('mcp.added')}</span>
                      </div>
                    ) : (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => handleAddPreset(key)}
                        disabled={isLoading}
                        className="gap-1 whitespace-nowrap text-xs"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        {requiresConfig ? t('mcp.configure') : t('common.add')}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Add Custom Button */}
      {!showAddForm && !editingServer && (
        <Button
          variant="secondary"
          onClick={() => setShowAddForm(true)}
          className="h-9 w-full gap-2 rounded-md border border-dashed border-border px-4 hover:border-accent hover:bg-accent-muted hover:text-accent"
        >
          <Plus className="w-4 h-4" />
          {t('mcp.addCustomConnector')}
        </Button>
      )}

      {/* Footer info */}
      <div className="text-sm text-text-muted text-center pt-2">
        {t('mcp.toolsAvailable', { count: tools.length })}
      </div>
    </div>
  );
}
