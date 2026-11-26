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
import { Button, Input, Switch } from '../../ui';
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

  const renderStatusBadge = () => {
    switch (serverStatus) {
      case 'connected':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-success/10 px-2 py-0.5 text-[12px] font-medium text-success">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t('mcp.connected')}
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-error/10 px-2 py-0.5 text-[12px] font-medium text-error">
            <AlertCircle className="h-3.5 w-3.5" />
            {t('mcp.failed')}
          </span>
        );
      case 'authorizing':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-warning/10 px-2 py-0.5 text-[12px] font-medium text-warning">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t('mcp.authorizing')}
          </span>
        );
      case 'needs_auth':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-warning/10 px-2 py-0.5 text-[12px] font-medium text-warning">
            <KeyRound className="h-3.5 w-3.5" />
            {t('mcp.needsAuth')}
          </span>
        );
      case 'connecting':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-warning/10 px-2 py-0.5 text-[12px] font-medium text-warning">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t('mcp.connecting')}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-muted px-2 py-0.5 text-[12px] font-medium text-text-muted">
            <CircleOff className="h-3.5 w-3.5" />
            {t('mcp.disabled')}
          </span>
        );
    }
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface">
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border-subtle px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${getMcpStatusDotClass(serverStatus)}`} />
          <h2 className="truncate text-[13px] font-semibold text-text-primary">{server.name}</h2>
          <span className="shrink-0 rounded border border-border-subtle bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] font-medium leading-none text-text-muted">
            {formatMcpTypeLabel(server.type)}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Switch
            size="sm"
            checked={server.enabled}
            onCheckedChange={onToggleEnabled}
            disabled={isLoading}
            aria-label={server.enabled ? t('common.disable') : t('common.enable')}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={onEdit}
            disabled={isLoading}
            className="h-7 px-2.5 text-[12px]"
          >
            <Edit3 className="h-3.5 w-3.5" />
            {t('common.edit')}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onDelete}
            disabled={isLoading}
            className="h-7 w-7 text-text-muted hover:bg-error/10 hover:text-error"
            title={t('common.delete')}
            aria-label={t('common.delete')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="scrollbar-hover min-h-0 flex-1 overflow-y-auto">
        <section>
          <h3 className="flex h-8 items-center gap-1.5 border-b border-border-subtle bg-surface-muted/80 px-3 text-[11.5px] font-semibold text-text-secondary">
            <Link2 className="h-3.5 w-3.5 text-text-muted" />
            {t('mcp.connectionSection')}
          </h3>

          <div className="grid min-h-[40px] grid-cols-[116px_minmax(0,1fr)] border-b border-border-subtle">
            <span className="flex items-center whitespace-nowrap border-r border-border-subtle bg-surface-muted/45 px-3 text-[12px] font-medium text-text-secondary">
              {t('mcp.status')}
            </span>
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-3 py-1.5">
              {renderStatusBadge()}
              {needsAuthAction && (
                <div>
                  {serverStatus === 'authorizing' ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={isLoading}
                      onClick={onCancelAuth}
                    >
                      {t('mcp.cancelAuthorization')}
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={isLoading}
                      onClick={onReauthorize}
                    >
                      {t('mcp.reauthorize')}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="grid min-h-[40px] grid-cols-[116px_minmax(0,1fr)] border-b border-border-subtle">
            <span className="flex items-center whitespace-nowrap border-r border-border-subtle bg-surface-muted/45 px-3 text-[12px] font-medium text-text-secondary">
              {server.type === 'stdio' ? t('mcp.command') : t('mcp.url')}
            </span>
            <div className="flex min-w-0 items-center px-3 py-2">
              <span className="break-all font-mono text-[12.5px] text-text-primary">
                {server.type === 'stdio'
                  ? `${server.command || ''} ${server.args?.join(' ') || ''}`.trim()
                  : server.url || '-'}
              </span>
            </div>
          </div>

          {secretKeys.length > 0 && (
            <div className="grid min-h-[40px] grid-cols-[116px_minmax(0,1fr)] border-b border-border-subtle">
              <span className="flex items-center whitespace-nowrap border-r border-border-subtle bg-surface-muted/45 px-3 text-[12px] font-medium text-text-secondary">
                {server.type === 'stdio' ? t('credentials.envVars') : t('mcp.headers')}
              </span>
              <div className="flex min-w-0 flex-wrap items-center gap-1.5 px-3 py-2">
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
          )}
        </section>

        <section>
          <div className="flex h-8 items-center justify-between gap-2 border-b border-border-subtle bg-surface-muted/80 px-3">
            <h3 className="flex items-center gap-1.5 text-[11.5px] font-semibold text-text-secondary">
              <Wrench className="h-3.5 w-3.5 text-text-muted" />
              {t('mcp.toolsSection')}
              <span className="font-normal tabular-nums text-text-muted">{tools.length}</span>
            </h3>
            {tools.length > 6 && (
              <div className="relative w-44">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-text-muted" />
                <Input
                  type="text"
                  value={toolQuery}
                  onChange={(event) => setToolQuery(event.target.value)}
                  placeholder={t('mcp.searchToolsPlaceholder')}
                  className="h-6 rounded-md border-border-subtle bg-surface pl-6 pr-2 text-[11.5px]"
                />
              </div>
            )}
          </div>

          {tools.length === 0 ? (
            <div className="flex items-center gap-2 px-4 py-6 text-[12.5px] text-text-muted">
              <Plug className="h-3.5 w-3.5 opacity-60" />
              <span>{t('mcp.notConnected')}</span>
            </div>
          ) : filteredTools.length === 0 ? (
            <div className="px-4 py-6 text-[12.5px] text-text-muted">
              {t('mcp.noMatchingTools')}
            </div>
          ) : (
            <div className="divide-y divide-border-subtle">
              {filteredTools.map((tool) => {
                const parts = tool.name.split('__');
                const displayName = parts.length > 1 ? parts[parts.length - 1] : tool.name;
                return (
                  <div
                    key={tool.name}
                    className="px-4 py-2.5 transition-colors hover:bg-surface-hover/50"
                  >
                    <div className="font-mono text-[12.5px] font-medium text-accent break-all">
                      {displayName}
                    </div>
                    {tool.description && (
                      <p className="mt-0.5 text-[12px] leading-5 text-text-muted break-words">
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
