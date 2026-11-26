import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CircleOff,
  Edit3,
  KeyRound,
  Link2,
  Loader2,
  Plug,
  Search,
  Trash2,
  Wrench,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Switch } from '../../ui';
import type { MCPServerConfig, MCPServerStatus, MCPToolInfo } from '../shared';

export type ResolvedMcpStatus =
  'connected' | 'connecting' | 'authorizing' | 'needs_auth' | 'failed' | 'disabled';

export function resolveMcpServerStatus(
  server: MCPServerConfig,
  status?: MCPServerStatus
): ResolvedMcpStatus {
  return (status?.status ?? (server.enabled ? 'connecting' : 'disabled')) as ResolvedMcpStatus;
}

export function formatMcpTypeLabel(type: MCPServerConfig['type']): string {
  if (type === 'streamable-http') return 'HTTP';
  return type.toUpperCase();
}

export function getMcpStatusDotClass(serverStatus: ResolvedMcpStatus): string {
  switch (serverStatus) {
    case 'connected':
      return 'bg-success';
    case 'failed':
      return 'bg-error';
    case 'connecting':
    case 'authorizing':
    case 'needs_auth':
      return 'bg-warning';
    default:
      return 'bg-text-muted/50';
  }
}

export function McpServerDetail({
  server,
  status,
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
  tools: MCPToolInfo[];
  onEdit: () => void;
  onDelete: () => void;
  onToggleEnabled: () => void;
  onReauthorize: () => void;
  onCancelAuth: () => void;
  isLoading: boolean;
}) {
  const { t } = useTranslation();
  const serverStatus = resolveMcpServerStatus(server, status);
  const [toolQuery, setToolQuery] = useState('');

  useEffect(() => {
    setToolQuery('');
  }, [server.id]);

  const filteredTools = useMemo(() => {
    const query = toolQuery.trim().toLowerCase();
    if (!query) return tools;
    return tools.filter((tool) => {
      const parts = tool.name.split('__');
      const shortName = parts.length > 1 ? parts[parts.length - 1] : tool.name;
      return (
        shortName.toLowerCase().includes(query) ||
        (tool.description?.toLowerCase().includes(query) ?? false)
      );
    });
  }, [toolQuery, tools]);

  const secretKeys =
    server.type === 'stdio' ? Object.keys(server.env || {}) : Object.keys(server.headers || {});
  const needsAuthAction =
    serverStatus === 'authorizing' ||
    serverStatus === 'needs_auth' ||
    (serverStatus === 'failed' && (server.type === 'sse' || server.type === 'streamable-http'));

  const renderStatusText = () => {
    switch (serverStatus) {
      case 'connected':
        return (
          <span className="ui-flush-text gap-1.5 font-medium !text-success">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            {t('mcp.connected')}
          </span>
        );
      case 'failed':
        return (
          <span className="ui-flush-text gap-1.5 font-medium !text-error">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {t('mcp.failed')}
          </span>
        );
      case 'authorizing':
        return (
          <span className="ui-flush-text gap-1.5 font-medium !text-warning">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            {t('mcp.authorizing')}
          </span>
        );
      case 'needs_auth':
        return (
          <span className="ui-flush-text gap-1.5 font-medium !text-warning">
            <KeyRound className="h-3.5 w-3.5 shrink-0" />
            {t('mcp.needsAuth')}
          </span>
        );
      case 'connecting':
        return (
          <span className="ui-flush-text gap-1.5 font-medium !text-warning">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            {t('mcp.connecting')}
          </span>
        );
      default:
        return (
          <span className="ui-flush-text gap-1.5 font-medium">
            <CircleOff className="h-3.5 w-3.5 shrink-0" />
            {t('mcp.disabled')}
          </span>
        );
    }
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface">
      {/* Flush header bar aligned with left rail */}
      <div className="flex h-9 shrink-0 items-stretch border-b border-border-subtle bg-surface-muted">
        <div className="flex min-w-0 flex-1 items-center gap-2 px-3">
          <span className={`h-2 w-2 shrink-0 rounded-full ${getMcpStatusDotClass(serverStatus)}`} />
          <h2 className="truncate text-[12.5px] font-semibold text-text-primary">{server.name}</h2>
          <span className="shrink-0 font-mono text-[10.5px] font-medium text-text-muted">
            {formatMcpTypeLabel(server.type)}
          </span>
        </div>

        <div className="flex shrink-0 items-stretch">
          <div className="flex items-center border-l border-border-subtle px-3">
            <Switch
              size="sm"
              checked={server.enabled}
              onCheckedChange={onToggleEnabled}
              disabled={isLoading}
              aria-label={server.enabled ? t('common.disable') : t('common.enable')}
            />
          </div>
          <button
            type="button"
            onClick={onEdit}
            disabled={isLoading}
            className="ui-accent-cell shrink-0 border-l border-border-subtle"
          >
            <Edit3 className="h-3.5 w-3.5" />
            {t('common.edit')}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={isLoading}
            className="inline-flex w-9 shrink-0 items-center justify-center border-l border-border-subtle text-text-muted transition-colors hover:bg-error/10 hover:text-error disabled:cursor-not-allowed disabled:opacity-50"
            title={t('common.delete')}
            aria-label={t('common.delete')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Flush body */}
      <div className="scrollbar-hover ui-form-flush min-h-0 flex-1 overflow-y-auto">
        <section className="border-b border-border-subtle">
          <h3 className="ui-group-title gap-1.5">
            <Link2 className="h-3.5 w-3.5 text-text-muted" />
            {t('mcp.connectionSection')}
          </h3>

          <div className="ui-form-row">
            <span className="ui-form-label items-center">{t('mcp.status')}</span>
            <div className="ui-form-value !flex-row items-stretch">
              {renderStatusText()}
              {needsAuthAction &&
                (serverStatus === 'authorizing' ? (
                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={onCancelAuth}
                    className="inline-flex shrink-0 items-center justify-center border-l border-border-subtle px-3 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
                  >
                    {t('mcp.cancelAuthorization')}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={onReauthorize}
                    className="ui-accent-cell shrink-0 border-l border-border-subtle"
                  >
                    {t('mcp.reauthorize')}
                  </button>
                ))}
            </div>
          </div>

          <div className="ui-form-row">
            <span className="ui-form-label items-center">
              {server.type === 'stdio' ? t('mcp.command') : t('mcp.url')}
            </span>
            <div className="ui-form-value">
              <span className="ui-flush-text break-all py-1.5 font-mono !text-[12.5px] !text-text-primary">
                {server.type === 'stdio'
                  ? `${server.command || ''} ${server.args?.join(' ') || ''}`.trim()
                  : server.url || '-'}
              </span>
            </div>
          </div>

          {secretKeys.length > 0 && (
            <div className="ui-form-row">
              <span className="ui-form-label items-center">
                {server.type === 'stdio' ? t('credentials.envVars') : t('mcp.headers')}
              </span>
              <div className="ui-form-value">
                <div className="flex min-h-[35px] flex-wrap items-center gap-1.5 px-[10px] py-1.5">
                  {secretKeys.map((key) => (
                    <span
                      key={key}
                      className="rounded border border-border-subtle bg-surface-muted px-2 py-0.5 font-mono text-[11px] text-text-secondary"
                    >
                      {key}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>

        <section>
          <div className="flex h-[30px] items-stretch border-b border-border-subtle bg-surface-muted">
            <h3 className="flex min-w-0 flex-1 items-center gap-1.5 px-3 text-[12px] font-semibold text-text-primary">
              <Wrench className="h-3.5 w-3.5 text-text-muted" />
              {t('mcp.toolsSection')}
              <span className="font-normal tabular-nums text-text-muted">{tools.length}</span>
            </h3>
            {tools.length > 6 && (
              <div className="flex w-48 shrink-0 items-center gap-1.5 border-l border-border-subtle bg-surface px-2.5">
                <Search className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                <input
                  type="text"
                  value={toolQuery}
                  onChange={(event) => setToolQuery(event.target.value)}
                  placeholder={t('mcp.searchToolsPlaceholder')}
                  className="h-full min-w-0 flex-1 bg-transparent text-[12px] text-text-primary outline-none placeholder:text-text-muted"
                />
              </div>
            )}
          </div>

          {tools.length === 0 ? (
            <div className="flex items-center gap-2 px-3 py-5 text-[12px] text-text-muted">
              <Plug className="h-3.5 w-3.5 opacity-60" />
              <span>{t('mcp.notConnected')}</span>
            </div>
          ) : filteredTools.length === 0 ? (
            <div className="px-3 py-5 text-[12px] text-text-muted">{t('mcp.noMatchingTools')}</div>
          ) : (
            <div className="divide-y divide-border-subtle">
              {filteredTools.map((tool) => {
                const parts = tool.name.split('__');
                const displayName = parts.length > 1 ? parts[parts.length - 1] : tool.name;
                return (
                  <div
                    key={tool.name}
                    className="px-3 py-2 transition-colors hover:bg-surface-hover/50"
                  >
                    <div className="break-all font-mono text-[12.5px] font-medium text-accent">
                      {displayName}
                    </div>
                    {tool.description && (
                      <p className="mt-0.5 break-words text-[12px] leading-5 text-text-muted">
                        {tool.description}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
