import { useState, useEffect, useMemo } from 'react';
import { DATA_OBJECT_ICONS, extractDataObjects } from './message/DataObjectCards';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import { resolveArtifactPath } from '../utils/artifact-path';
import {
  extractFilePathFromToolInput,
  extractFilePathFromToolOutput,
} from '../utils/tool-output-path';
import {
  getArtifactLabel,
  getArtifactIconComponent,
  getArtifactSteps,
} from '../utils/artifact-steps';
import { useIPC } from '../hooks/useIPC';
import { isHtmlReportPath } from '../../shared/report-path';
import {
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  FileText,
  FileSpreadsheet,
  FilePieChart,
  FileCode2,
  FileArchive,
  FileAudio2,
  FileVideo,
  Image as ImageIcon,
  ExternalLink,
  FolderOpen,
  FolderSync,
  File,
  Loader2,
  Plug,
  Wrench,
  MessageSquare,
  Cpu,
  Layers,
} from 'lucide-react';
import type { TraceStep, MCPServerInfo, ContentBlock, ToolUseContent } from '../types';
import { getMcpToolDisplayName } from './message/toolHelpers';

const EMPTY_STEPS: TraceStep[] = [];

export function ContextPanel() {
  const { t } = useTranslation();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const sessionStates = useAppStore((s) => s.sessionStates);
  const appConfig = useAppStore((s) => s.appConfig);
  const contextPanelCollapsed = useAppStore((s) => s.contextPanelCollapsed);
  const toggleContextPanel = useAppStore((s) => s.toggleContextPanel);
  const workingDir = useAppStore((s) => s.workingDir);
  const setGlobalNotice = useAppStore((s) => s.setGlobalNotice);
  const { getMCPServers, changeWorkingDir } = useIPC();
  const [artifactsOpen, setArtifactsOpen] = useState(true);
  const [expandedConnector, setExpandedConnector] = useState<string | null>(null);
  const [mcpServers, setMcpServers] = useState<MCPServerInfo[]>([]);
  const [isChangingDir, setIsChangingDir] = useState(false);
  const [recentWorkspaceFiles, setRecentWorkspaceFiles] = useState<
    Array<{
      path: string;
      modifiedAt: number;
      size: number;
    }>
  >([]);

  const ss = activeSessionId ? sessionStates[activeSessionId] : undefined;
  const steps = ss?.traceSteps ?? EMPTY_STEPS;
  const activeSession = activeSessionId ? sessions.find((s) => s.id === activeSessionId) : null;
  const currentWorkingDir = activeSession?.cwd || workingDir;
  const { displayArtifactSteps } = getArtifactSteps(steps);
  const canShowItemInFolder =
    typeof window !== 'undefined' && !!window.electronAPI?.showItemInFolder;
  const canOpenGeneratedReport =
    typeof window !== 'undefined' && !!window.electronAPI?.openGeneratedReport;
  const canOpenPath = typeof window !== 'undefined' && !!window.electronAPI?.openPath;

  // Session info computations
  const messages = useMemo(
    () => (activeSessionId ? sessionStates[activeSessionId]?.messages || [] : []),
    [activeSessionId, sessionStates]
  );
  const messageCount = messages.length;
  const navigateToDataElement = useAppStore((state) => state.navigateToDataElement);
  const sessionDataObjects = useMemo(
    () =>
      extractDataObjects(
        messages
          .filter((message) => message.role === 'assistant' && Array.isArray(message.content))
          .flatMap((message) =>
            (message.content as Array<{ type: string; text?: string }>)
              .filter((block) => block.type === 'text' && typeof block.text === 'string')
              .map((block) => block.text as string)
          )
      ),
    [messages]
  );
  const toolCallCount = steps.filter((s) => s.type === 'tool_call').length;
  const modelName = activeSession?.model || appConfig?.model || '—';

  // Token usage aggregation
  const tokenUsage = useMemo(() => {
    let input = 0;
    let output = 0;
    for (const msg of messages) {
      if (msg.tokenUsage) {
        input += msg.tokenUsage.input || 0;
        output += msg.tokenUsage.output || 0;
      }
    }
    return { input, output, total: input + output };
  }, [messages]);

  // Latest completed model call: full prompt + generated output. This is a
  // snapshot, not cumulative billing usage; compaction can legitimately lower it.
  const contextUsage = useMemo(() => {
    const contextWindow = activeSessionId
      ? sessionStates[activeSessionId]?.contextWindow
      : undefined;
    if (!contextWindow) return null;

    let used = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      const usage = messages[i].tokenUsage;
      if (messages[i].role === 'assistant' && usage && usage.input > 0) {
        used = usage.input + usage.output;
        break;
      }
    }
    if (used === 0) return null;

    const percentage = Math.min((used / contextWindow) * 100, 100);
    return { used, total: contextWindow, percentage };
  }, [activeSessionId, sessionStates, messages]);

  const completedStepCount = useMemo(
    () => steps.reduce((n, s) => n + (s.status === 'completed' ? 1 : 0), 0),
    [steps]
  );

  const mcpToolDisplayNames = useMemo(() => {
    const displayNames = new Map<string, string>();

    for (const msg of messages) {
      if (!Array.isArray(msg.content)) {
        continue;
      }

      for (const block of msg.content as ContentBlock[]) {
        if (block.type !== 'tool_use') {
          continue;
        }

        const toolUse = block as ToolUseContent;
        if (!toolUse.name.startsWith('mcp__')) {
          continue;
        }

        displayNames.set(toolUse.name, getMcpToolDisplayName(toolUse.name, toolUse.displayName));
      }
    }

    for (const step of steps) {
      if (step.type !== 'tool_call' || !step.toolName?.startsWith('mcp__')) {
        continue;
      }

      if (!displayNames.has(step.toolName)) {
        displayNames.set(step.toolName, getMcpToolDisplayName(step.toolName, step.title));
      }
    }

    return displayNames;
  }, [messages, steps]);

  useEffect(() => {
    if (contextPanelCollapsed) {
      return;
    }
    if (
      typeof window === 'undefined' ||
      !window.electronAPI?.artifacts?.listRecentFiles ||
      !currentWorkingDir ||
      !activeSession?.createdAt
    ) {
      setRecentWorkspaceFiles([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const files = await window.electronAPI.artifacts.listRecentFiles(
          currentWorkingDir,
          activeSession.createdAt,
          50
        );
        if (!cancelled) {
          setRecentWorkspaceFiles(files || []);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load recent workspace files:', error);
          setRecentWorkspaceFiles([]);
        }
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    activeSession?.createdAt,
    activeSessionId,
    steps.length,
    completedStepCount,
    contextPanelCollapsed,
    currentWorkingDir,
  ]);

  const displayArtifacts = useMemo(() => {
    const seenPaths = new Set<string>();
    const items: Array<{ label: string; path: string }> = [];

    for (const step of displayArtifactSteps) {
      const fallbackPath =
        extractFilePathFromToolOutput(step.toolOutput) ||
        extractFilePathFromToolInput(step.toolInput);
      if (!fallbackPath) {
        continue;
      }

      const resolvedPath = resolveArtifactPath(fallbackPath, currentWorkingDir);
      const key = resolvedPath.trim();
      if (!key || seenPaths.has(key)) {
        continue;
      }

      seenPaths.add(key);
      items.push({
        label: getArtifactLabel(fallbackPath),
        path: resolvedPath,
      });
    }

    for (const file of recentWorkspaceFiles) {
      const resolvedPath = resolveArtifactPath(file.path, currentWorkingDir);
      const key = resolvedPath.trim();
      if (!key || seenPaths.has(key)) {
        continue;
      }

      seenPaths.add(key);
      items.push({
        label: getArtifactLabel(file.path),
        path: resolvedPath,
      });
    }

    return items;
  }, [currentWorkingDir, displayArtifactSteps, recentWorkspaceFiles]);

  useEffect(() => {
    if (contextPanelCollapsed) {
      return;
    }
    const loadMCPServers = async () => {
      try {
        const servers = await getMCPServers();
        setMcpServers(servers || []);
      } catch (error) {
        console.error('Failed to load MCP servers:', error);
      }
    };
    loadMCPServers();
    const interval = setInterval(loadMCPServers, 30000);
    return () => clearInterval(interval);
  }, [contextPanelCollapsed, getMCPServers]);

  if (contextPanelCollapsed) {
    return (
      <div className="w-10 border-l border-border-subtle bg-surface flex items-start justify-center pt-3">
        <button
          onClick={toggleContextPanel}
          className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
          title={t('context.expandPanel')}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex w-80 shrink-0 flex-col overflow-hidden border-l border-border-subtle bg-surface text-sm">
      {/* Header */}
      <div className="titlebar-drag px-3 h-12 flex items-center gap-2 border-b border-border-subtle shrink-0 bg-surface">
        <button
          onClick={toggleContextPanel}
          className="titlebar-no-drag w-6 h-6 rounded-md flex items-center justify-center hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
          title={t('context.collapsePanel')}
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
        <span className="text-xs font-medium text-text-secondary">{t('context.context')}</span>
      </div>

      {/* Session Stats */}
      {activeSession && (
        <div className="m-2 rounded-xl border border-border-subtle bg-surface px-3 py-3 shadow-soft space-y-1.5">
          <div className="flex items-center gap-1.5 text-text-primary font-medium">
            <Cpu className="w-3.5 h-3.5 text-text-muted shrink-0" />
            <span className="truncate">{modelName}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-text-muted pl-5">
            <span className="flex items-center gap-1">
              <MessageSquare className="w-3 h-3" />
              {messageCount}
            </span>
            <span className="flex items-center gap-1">
              <Wrench className="w-3 h-3" />
              {toolCallCount}
            </span>
            {tokenUsage.total > 0 && (
              <span className="ml-auto text-text-muted/70">
                {t('context.inputTokens')} {formatTokenCount(tokenUsage.input)} ·{' '}
                {t('context.outputTokens')} {formatTokenCount(tokenUsage.output)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Context Usage */}
      {activeSession && contextUsage && (
        <div className="mx-2 mb-2 rounded-xl border border-border-subtle bg-surface px-3 py-2.5 shadow-soft space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
              {t('context.contextUsage')}
            </span>
            <span
              className={`text-xs font-medium ${
                contextUsage.percentage > 95
                  ? 'text-error'
                  : contextUsage.percentage > 80
                    ? 'text-warning'
                    : 'text-text-primary'
              }`}
            >
              {Math.round(contextUsage.percentage)}%
            </span>
          </div>
          <div className="h-1.5 bg-surface-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ease-out ${
                contextUsage.percentage > 95
                  ? 'bg-error'
                  : contextUsage.percentage > 80
                    ? 'bg-warning'
                    : 'bg-accent'
              }`}
              style={{ width: `${contextUsage.percentage}%` }}
            />
          </div>
          <p className="text-xs text-text-muted">
            {t('context.contextUsageLabel', {
              used: formatTokenCount(contextUsage.used),
              total: formatTokenCount(contextUsage.total),
            })}
          </p>
        </div>
      )}

      {/* Artifacts Section */}
      <div className="mx-2 mb-2 overflow-hidden rounded-xl border border-border-subtle bg-surface shadow-soft">
        <button
          onClick={() => setArtifactsOpen(!artifactsOpen)}
          className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-surface-hover transition-colors"
        >
          <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
            {t('context.artifacts')}
          </span>
          {artifactsOpen ? (
            <ChevronUp className="w-3.5 h-3.5 text-text-muted" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
          )}
        </button>

        {artifactsOpen && sessionDataObjects.length > 0 && (
          <div className="border-b border-border-subtle pb-1.5">
            <div className="px-4 pb-1 text-[11px] text-text-muted">
              {t('context.dataObjects', { count: sessionDataObjects.length })}
            </div>
            {sessionDataObjects.map((object) => {
              const Icon = DATA_OBJECT_ICONS[object.kind];
              return (
                <button
                  key={`${object.kind}:${object.id}`}
                  type="button"
                  onClick={() => navigateToDataElement({ kind: object.kind, id: object.id })}
                  className="flex w-full items-center gap-2 px-4 py-1.5 text-left text-xs text-text-secondary transition-colors hover:bg-surface-hover"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1 truncate">{object.name}</span>
                  <span className="shrink-0 text-[11px] text-text-muted">
                    {t(`messageCard.dataObjectKind.${object.kind}`)}
                  </span>
                </button>
              );
            })}
            <div className="px-4 pt-1 text-[11px] text-text-muted">{t('context.files')}</div>
          </div>
        )}
        {artifactsOpen && (
          <div className="pb-2 max-h-64 overflow-y-auto">
            {displayArtifacts.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-2 text-xs text-text-muted">
                <Layers className="w-3.5 h-3.5 shrink-0" />
                <span>{t('context.noArtifactsYet')}</span>
              </div>
            ) : (
              <div>
                {displayArtifacts.map((artifact, index) => {
                  const label = artifact.label || t('context.fileCreated');
                  const artifactPath = artifact.path;
                  const isReport = isHtmlReportPath(artifactPath || label);
                  const canClick = Boolean(
                    artifactPath &&
                    (canOpenPath || canShowItemInFolder || (isReport && canOpenGeneratedReport))
                  );
                  const iconComponent = getArtifactIconComponent(label);
                  const IconComponent =
                    iconComponent === 'presentation'
                      ? FilePieChart
                      : iconComponent === 'table'
                        ? FileSpreadsheet
                        : iconComponent === 'document'
                          ? FileText
                          : iconComponent === 'code'
                            ? FileCode2
                            : iconComponent === 'image'
                              ? ImageIcon
                              : iconComponent === 'audio'
                                ? FileAudio2
                                : iconComponent === 'video'
                                  ? FileVideo
                                  : iconComponent === 'archive'
                                    ? FileArchive
                                    : iconComponent === 'text'
                                      ? File
                                      : File;

                  return (
                    <div
                      key={artifact.path || artifact.label || `artifact-${index}`}
                      className={`flex items-center gap-2 px-4 py-1.5 transition-colors ${canClick ? 'cursor-pointer hover:bg-surface-hover' : ''}`}
                      onClick={async () => {
                        if (!canClick) return;
                        const api = window.electronAPI;
                        const cwd = currentWorkingDir ?? undefined;
                        // Open the file itself with the default app; only fall
                        // back to revealing it when opening is unavailable/failed.
                        const handled =
                          (api.openPath
                            ? await api.openPath(artifactPath, cwd)
                            : isReport && api.openGeneratedReport
                              ? await api.openGeneratedReport(artifactPath, cwd)
                              : false) ||
                          (api.showItemInFolder
                            ? await api.showItemInFolder(artifactPath, cwd)
                            : false);
                        if (!handled) {
                          setGlobalNotice({
                            id: `artifact-reveal-failed-${Date.now()}`,
                            type: 'warning',
                            message: t('context.revealFailed'),
                          });
                        }
                      }}
                      title={artifactPath || undefined}
                    >
                      <IconComponent className="w-3.5 h-3.5 text-text-muted shrink-0" />
                      <span className="text-xs text-text-primary truncate">{label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Working Directory */}
      <div className="mx-2 mb-2 rounded-xl border border-border-subtle bg-surface shadow-soft">
        <div className="px-3 py-2.5">
          <p className="text-xs font-medium text-text-muted mb-2">
            {t('context.workingDirectory')}
          </p>
          <div className="flex items-center gap-1.5 min-w-0">
            <FolderOpen className="w-3.5 h-3.5 text-text-muted shrink-0" />
            <span
              className={`text-xs truncate flex-1 ${currentWorkingDir ? 'text-text-primary cursor-pointer hover:text-accent-primary transition-colors' : 'text-text-muted'}`}
              title={currentWorkingDir ? t('context.openInFileManager') : ''}
              onClick={() =>
                currentWorkingDir && window.electronAPI?.showItemInFolder(currentWorkingDir)
              }
            >
              {currentWorkingDir ? formatPath(currentWorkingDir) : t('context.noFolderSelected')}
            </span>
            {currentWorkingDir && (
              <button
                onClick={() => window.electronAPI?.showItemInFolder(currentWorkingDir)}
                className="text-text-muted hover:text-text-primary transition-colors shrink-0 ml-1"
                title={t('context.openInFileManager')}
              >
                <ExternalLink className="w-3 h-3" />
              </button>
            )}
            <button
              onClick={async () => {
                setIsChangingDir(true);
                try {
                  const result = await changeWorkingDir(
                    activeSessionId || undefined,
                    currentWorkingDir || undefined
                  );
                  if (!result.success && result.error && result.error !== 'User cancelled') {
                    setGlobalNotice({
                      id: `change-dir-failed-${Date.now()}`,
                      type: 'warning',
                      message: `${t('context.changeDirFailed')}: ${result.error}`,
                    });
                  }
                } catch (error) {
                  setGlobalNotice({
                    id: `change-dir-failed-${Date.now()}`,
                    type: 'error',
                    message:
                      error instanceof Error && error.message
                        ? `${t('context.changeDirFailed')}: ${error.message}`
                        : t('context.changeDirFailed'),
                  });
                } finally {
                  setIsChangingDir(false);
                }
              }}
              disabled={isChangingDir}
              className="text-text-muted hover:text-text-primary disabled:opacity-50 transition-colors shrink-0"
              title={t('context.changeDir')}
            >
              {isChangingDir ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <FolderSync className="w-3 h-3" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* MCP Connectors */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-3 py-2.5">
          <p className="text-xs font-medium text-text-muted mb-2">{t('context.mcpConnectors')}</p>
          {mcpServers.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-text-muted py-1">
              <Plug className="w-3.5 h-3.5 shrink-0" />
              <span>{t('mcp.noConnectors')}</span>
            </div>
          ) : (
            <div className="space-y-0.5">
              {mcpServers.map((server) => (
                <ConnectorItem
                  key={server.id}
                  server={server}
                  steps={steps}
                  mcpToolDisplayNames={mcpToolDisplayNames}
                  expanded={expandedConnector === server.id}
                  onToggle={() =>
                    setExpandedConnector(expandedConnector === server.id ? null : server.id)
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ConnectorItem({
  server,
  steps,
  mcpToolDisplayNames,
  expanded,
  onToggle,
}: {
  server: MCPServerInfo;
  steps: TraceStep[];
  mcpToolDisplayNames: Map<string, string>;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  // Get MCP tools used from this server
  // Tool names are in format: mcp__ServerName__toolname (with double underscores)
  // Server name preserves original case and spaces are replaced with underscores
  const serverNamePattern = server.name.replace(/\s+/g, '_');

  const mcpToolsUsed = steps
    .filter((s) => s.toolName?.startsWith('mcp__'))
    .map((s) => s.toolName!)
    .filter((name, index, self) => self.indexOf(name) === index)
    .filter((name) => {
      // Check if this tool belongs to this server
      // Format: mcp__ServerName__toolname
      const match = name.match(/^mcp__(.+?)__(.+)$/);
      if (match) {
        const toolServerName = match[1];
        return toolServerName === serverNamePattern;
      }
      return false;
    });

  const usageCount = steps.filter(
    (s) => s.toolName?.startsWith('mcp__') && mcpToolsUsed.includes(s.toolName)
  ).length;

  return (
    <div className="rounded-lg border border-border-subtle bg-surface overflow-hidden shadow-soft">
      <button
        onClick={onToggle}
        className={`w-full px-3 py-2 flex items-center gap-2 transition-colors ${
          server.connected ? 'bg-mcp/10 hover:bg-mcp/20' : 'bg-surface-muted hover:bg-surface-hover'
        }`}
      >
        <div
          className={`w-6 h-6 rounded flex items-center justify-center ${
            server.connected ? 'bg-mcp/20' : 'bg-surface-muted'
          }`}
        >
          <Plug className={`w-3.5 h-3.5 ${server.connected ? 'text-mcp' : 'text-text-muted'}`} />
        </div>
        <div className="flex-1 text-left min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary truncate">{server.name}</span>
            {!server.connected && (
              <span className="text-xs text-text-muted">({t('mcp.notConnected')})</span>
            )}
          </div>
          {server.connected && (
            <p className="text-xs text-text-muted">
              {t('mcp.toolCount', { count: server.toolCount })}
              {usageCount > 0 && ` • ${t('mcp.callCount', { count: usageCount })}`}
            </p>
          )}
        </div>
        {server.connected &&
          (expanded ? (
            <ChevronDown className="w-4 h-4 text-text-muted" />
          ) : (
            <ChevronRight className="w-4 h-4 text-text-muted" />
          ))}
      </button>

      {expanded && server.connected && (
        <div className="px-3 pb-2 space-y-1 bg-surface">
          {mcpToolsUsed.length > 0 ? (
            <>
              <p className="text-xs text-text-muted px-2 py-1">{t('context.toolsUsedLabel')}</p>
              {mcpToolsUsed.map((toolName, index) => {
                const count = steps.filter((s) => s.toolName === toolName).length;
                const readableName =
                  mcpToolDisplayNames.get(toolName) || getMcpToolDisplayName(toolName);

                return (
                  <div
                    key={index}
                    className="flex items-center gap-2 px-2 py-1.5 rounded bg-mcp/5 hover:bg-mcp/10 transition-colors"
                  >
                    <Wrench className="w-3.5 h-3.5 text-mcp" />
                    <span className="text-xs text-text-primary flex-1">{readableName}</span>
                    <span className="text-xs text-text-muted">{count}x</span>
                  </div>
                );
              })}
            </>
          ) : (
            <p className="text-xs text-text-muted px-2 py-1">{t('context.noToolsUsedYet')}</p>
          )}
        </div>
      )}
    </div>
  );
}

// Format long paths to show abbreviated version
function formatPath(path: string): string {
  if (!path) return '';

  // Windows: Replace C:\Users\username with ~
  const winHome = /^[A-Z]:\\Users\\[^\\]+/i;
  const winMatch = path.match(winHome);
  if (winMatch) {
    return '~' + path.slice(winMatch[0].length).replace(/\\/g, '/');
  }

  // macOS/Linux: Replace /Users/username or /home/username with ~
  const unixHome = /^\/(?:Users|home)\/[^/]+/;
  const unixMatch = path.match(unixHome);
  if (unixMatch) {
    return '~' + path.slice(unixMatch[0].length);
  }

  return path;
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
