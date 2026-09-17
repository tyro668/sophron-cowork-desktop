/**
 * @module main/agent/agent-runner
 *
 * AI query execution engine.
 *
 * Responsibilities:
 * - Runs AI conversations via the sophron agent SDK (createAgentSession)
 * - Routes providers via pi-ai SDK for model resolution
 * - Bridges MCP tools into SDK ToolDefinition format
 * - Streams responses back as ServerEvents (stream.message, stream.partial, trace.step)
 * - Skills injection, system prompt assembly, permission handling
 *
 * Extracted siblings: agent-runner-env (bundled paths), agent-runner-log-utils
 * (serialization/usage), agent-runner-tools (MCP tool bridge), agent-runner-skills
 * (skill path sync), agent-runner-sandbox-sync (WSL/Lima init),
 * agent-runner-event-bridge (per-run SDK→ServerEvent streaming state).
 *
 * Dependencies: session-manager, mcp-manager, config-store, skills-manager
 */
import {
  createAgentSession,
  SessionManager as PiSessionManager,
  SettingsManager as PiSettingsManager,
  createCodingTools,
  type BashToolOptions,
  type AgentSession as PiAgentSession,
  type ToolDefinition,
  type Skill as PiSkill,
  type ResourceDiagnostic,
} from '@mariozechner/pi-coding-agent';
import type {
  AssistantMessage as PiAssistantMessage,
  Message as PiMessage,
} from '@mariozechner/pi-ai';
import { getSharedAuthStorage, ModelRegistry } from './shared-auth';
import type {
  Session,
  Message,
  TraceStep,
  ServerEvent,
  AgentRuntimeConfig,
  TraceEvaluationMetrics,
} from '../../shared/contracts';
import { v4 as uuidv4 } from 'uuid';
import { decidePermission, rememberAlwaysAllow } from '../config/permission-rules-store';
import { PathResolver } from '../sandbox/path-resolver';
import { MCPManager } from '../mcp/mcp-manager';
import { mcpConfigStore } from '../mcp/mcp-config-store';
import {
  log,
  logWarn,
  logError,
  logCtx,
  logCtxWarn,
  logCtxError,
  logTiming,
} from '../utils/logger';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { setMaxListeners } from 'node:events';
import { getSandboxAdapter } from '../sandbox/sandbox-adapter';
import { SandboxSync } from '../sandbox/sandbox-sync';
import { PluginRuntimeService } from '../skills/plugin-runtime-service';
import type { SkillsAdapter } from '../skills/skills-adapter';
import { AgentRuntimeExtensionManager } from '../extensions/agent-runtime-extension-manager';
import { configStore } from '../config/config-store';
import { normalizeOpenAICompatibleBaseUrl } from '../config/auth-utils';
import { toUserFacingErrorText } from './agent-runner-message-end';
import {
  applyPiModelRuntimeOverrides,
  buildSyntheticPiModel,
  resolvePiRegistryModel,
  resolvePiRouteProtocol,
  resolveSyntheticPiModelFallback,
} from './pi-model-resolution';
import { buildPiSessionRuntimeSignature } from './pi-session-runtime';
import { buildColdStartAgentHistory } from './agent-protocol-safety';
import { fetchOllamaModelInfo } from '../config/ollama-api';
import { ensureCodexCredentials } from '../config/codex-auth';
import { createWindowsBashOperations } from './windows-bash-operations';
import { createSandboxCodingTools } from './sandbox-tool-operations';
import { buildTraceError, sanitizeTraceInput } from './trace-utils';
import { buildMainAgentSystemPrompt } from '../prompts/main-agent';
import {
  VIRTUAL_WORKSPACE_PATH,
  estimateCharsPerToken,
  getBundledNodePaths,
  enrichProcessPathForBuild,
} from './agent-runner-env';
import { initSandboxSyncForRun } from './agent-runner-sandbox-sync';
import { AgentRunEventBridge } from './agent-runner-event-bridge';
import { safeStringify, toErrorText } from './agent-runner-log-utils';
import { buildMcpCustomTools } from './agent-runner-tools';
import { AgentRunnerSkills } from './agent-runner-skills';

// Virtual workspace path shown to the model (hides real sandbox path)
interface AgentRunnerOptions {
  sendToRenderer: (event: ServerEvent) => void;
  saveMessage?: (message: Message) => void;
  requestSudoPassword?: (
    sessionId: string,
    toolUseId: string,
    command: string
  ) => Promise<string | null>;
  requestPermission?: (
    sessionId: string,
    toolUseId: string,
    toolName: string,
    input: Record<string, unknown>
  ) => Promise<'allow' | 'deny' | 'allow_always'>;
}

interface CachedPiSession {
  session: PiAgentSession;
  modelId: string;
  thinkingLevel: string;
  runtimeSignature: string;
  skillsSignature?: string;
  ollamaNumCtx?: { value: number };
}

interface AgentRunOptions {
  selectedSkillNames?: string[];
}

/**
 * AgentRunner - Uses @mariozechner/pi-coding-agent SDK
 *
 * Environment variables should be set before running:
 *   ANTHROPIC_BASE_URL=https://openrouter.ai/api
 *   ANTHROPIC_AUTH_TOKEN=your_openrouter_api_key
 *   ANTHROPIC_API_KEY="" (must be empty)
 */
export class AgentRunner {
  private sendToRenderer: (event: ServerEvent) => void;
  private saveMessage?: (message: Message) => void;
  private requestSudoPassword?: (
    sessionId: string,
    toolUseId: string,
    command: string
  ) => Promise<string | null>;
  private requestPermission?: (
    sessionId: string,
    toolUseId: string,
    toolName: string,
    input: Record<string, unknown>
  ) => Promise<'allow' | 'deny' | 'allow_always'>;
  private pathResolver: PathResolver;
  private mcpManager?: MCPManager;
  private extensionManager?: AgentRuntimeExtensionManager;
  private activeControllers: Map<string, AbortController> = new Map();
  private activeTurnIds: Map<string, string> = new Map();
  private activeEvaluationMetrics: Map<string, TraceEvaluationMetrics> = new Map();
  private toolStartedAt: Map<string, number> = new Map();
  private piSessions: Map<string, CachedPiSession> = new Map();
  private toolDisplayNameCache: Map<string, string> = new Map();
  private static readonly MAX_CACHED_SESSIONS = 50;

  // Per-instance caches — invalidated when the underlying config changes.
  private _mcpServersCache: { fingerprint: string; servers: Record<string, unknown> } | null = null;
  private _skillsSetupDone = false;
  private readonly skills: AgentRunnerSkills;

  /**
   * Clear SDK session cache for a session
   * Called when session's cwd changes - SDK sessions are bound to cwd
   */
  clearSdkSession(sessionId: string): void {
    const cached = this.piSessions.get(sessionId);
    if (cached) {
      try {
        cached.session.dispose();
      } catch (e) {
        logWarn('[AgentRunner] dispose error:', e);
      }
      this.piSessions.delete(sessionId);
      log('[AgentRunner] Disposed pi session for:', sessionId);
    }
  }

  clearAllSdkSessions(): void {
    for (const sessionId of Array.from(this.piSessions.keys())) {
      this.clearSdkSession(sessionId);
    }
  }

  /** Call after the user installs / removes a skill so the next query re-links everything. */
  invalidateSkillsSetup(): void {
    this._skillsSetupDone = false;
  }

  /** Call after the user changes MCP server config so the next query rebuilds mcpServers. */
  invalidateMcpServersCache(): void {
    this._mcpServersCache = null;
    // Sessions stay alive — MCP tools are rebuilt each query via buildMcpCustomTools()
    log('[AgentRunner] MCP servers cache invalidated — tools will rebuild on next query');
  }

  // TODO: Credentials should be served via a secure MCP tool or IPC channel,
  // not injected as plaintext into the system prompt. The getCredentialsPrompt()
  // method was removed to eliminate credential leakage risk.

  /**
   * Generate bundled executable path hints for production mode system prompt.
   * In dev mode returns empty string (user PATH already works).
   * This is a defense-in-depth layer — even if PATH enrichment works, explicit
   * paths help the model avoid ambiguity when Skills reference bare commands.
   */

  constructor(
    options: AgentRunnerOptions,
    pathResolver: PathResolver,
    mcpManager?: MCPManager,
    pluginRuntimeService?: PluginRuntimeService,
    skillsAdapter?: SkillsAdapter,
    extensionManager?: AgentRuntimeExtensionManager
  ) {
    this.sendToRenderer = options.sendToRenderer;
    this.saveMessage = options.saveMessage;
    this.requestSudoPassword = options.requestSudoPassword;
    this.requestPermission = options.requestPermission;
    this.pathResolver = pathResolver;
    this.mcpManager = mcpManager;
    this.extensionManager = extensionManager;
    this.skills = new AgentRunnerSkills({
      skillsAdapter,
      pluginRuntimeService,
      sendToRenderer: this.sendToRenderer,
    });

    log('[AgentRunner] Initialized with sophron agent SDK');
    log('[AgentRunner] Skills enabled: settingSources=[user, project], Skill tool enabled');
    if (mcpManager) {
      log('[AgentRunner] MCP support enabled');
    }
  }

  /**
   * Install a permission-gating hook on the pi-coding-agent session via
   * `agent.setBeforeToolCall`. This is the only interception point that
   * fires for built-in tools (read, bash, edit, write) — the SDK ignores
   * wrapped `execute` functions on built-in tools passed via `options.tools`.
   *
   * The hook consults `decidePermission` from the main-process rules cache:
   *  - 'allow' → delegate to SDK's original hook (proceeds normally)
   *  - 'deny'  → return { block: true, reason } (SDK treats as tool error)
   *  - 'ask'   → await requestPermission() IPC round-trip to PermissionDialog
   *
   * Known limitation: the async requestPermission wait (user dialog) causes
   * the renderer to miss UI update events. The tool executes correctly on
   * the backend, but the renderer's loading spinner may not clear. This is
   * a renderer-side issue tracked as a follow-up.
   */
  private installPermissionHook(piSession: PiAgentSession, sessionId: string): void {
    if (!this.requestPermission) {
      log('[AgentRunner] No requestPermission callback — skipping permission hook');
      return;
    }

    // Access the Agent instance (public readonly property on AgentSession)
    // and wrap its beforeToolCall hook with our permission gate.
    //
    // We must chain to the SDK's original beforeToolCall hook because it
    // fires extension tool_call events and manages the _agentEventQueue.
    // Without chaining, the renderer misses completion events.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const agent = (piSession as any).agent;
    if (!agent || typeof agent.setBeforeToolCall !== 'function') {
      logWarn('[AgentRunner] Cannot access agent.setBeforeToolCall — skipping permission hook');
      return;
    }

    // Capture the SDK's hook before we overwrite it
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sdkBeforeToolCall: ((ctx: any, signal?: AbortSignal) => Promise<any>) | undefined =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (agent as any)._beforeToolCall;

    const requestPermission = this.requestPermission;
    const getDisplayName = (name: string): string => this.getToolDisplayName(name);

    agent.setBeforeToolCall(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (ctx: any, signal?: AbortSignal): Promise<any> => {
        const toolName: string = ctx.toolCall?.name ?? '';
        const input: Record<string, unknown> = ctx.args ?? {};

        const decision = decidePermission(sessionId, toolName, input);
        // Human-readable name for prompts/messages (e.g. MCP sanitized
        // 'mcp__chrome__chrome_screenshot__ab12' → 'chrome_screenshot').
        // Rule matching and rememberAlwaysAllow still use the canonical
        // `toolName` so allow-once decisions stay stable across calls.
        const displayName = getDisplayName(toolName);
        const parentId: string = ctx.toolCall?.id ?? uuidv4();
        const turnId = this.activeTurnIds.get(sessionId);
        const sanitizedInput = sanitizeTraceInput(input);

        if (decision === 'deny') {
          log(`[AgentRunner] Tool '${toolName}' denied by rule`);
          const now = Date.now();
          this.sendTraceStep(sessionId, {
            id: `${parentId}-permission-${uuidv4().slice(0, 8)}`,
            turnId,
            parentId,
            type: 'permission',
            status: 'error',
            title: `Permission denied: ${displayName}`,
            toolName,
            toolInput: sanitizedInput,
            permission: { decision: 'rule_deny', source: 'rule' },
            error: buildTraceError(
              `Tool '${displayName}' is denied by your permission rules.`,
              'permission'
            ),
            outcome: 'permission_denied',
            isError: true,
            timestamp: now,
            endedAt: now,
            duration: 0,
          });
          return {
            block: true,
            reason: `Tool '${displayName}' is denied by your permission rules.`,
          };
        }

        if (decision === 'ask') {
          const toolUseId = `${ctx.toolCall?.id ?? 'unknown'}-perm-${uuidv4().slice(0, 8)}`;
          const permissionStepId = `${parentId}-permission-${uuidv4().slice(0, 8)}`;
          const permissionStartedAt = Date.now();
          const evaluationMetrics = this.activeEvaluationMetrics.get(sessionId);
          if (evaluationMetrics) evaluationMetrics.permissionPromptCount += 1;
          this.sendTraceStep(sessionId, {
            id: permissionStepId,
            turnId,
            parentId,
            type: 'permission',
            status: 'running',
            title: `Permission requested: ${displayName}`,
            toolName,
            toolInput: sanitizedInput,
            timestamp: permissionStartedAt,
          });
          let result: 'allow' | 'deny' | 'allow_always';
          try {
            // Send the display name to the renderer so the dialog shows a
            // human-readable tool name; canonical `toolName` is still used
            // for rule matching above and "always allow" memory below.
            result = await requestPermission(sessionId, toolUseId, displayName, input);
          } catch (permErr) {
            const endedAt = Date.now();
            if (evaluationMetrics) {
              evaluationMetrics.permissionWaitMs += endedAt - permissionStartedAt;
            }
            const errorText = toErrorText(permErr);
            this.sendTraceUpdate(sessionId, permissionStepId, {
              status: 'error',
              title: `Permission request failed: ${displayName}`,
              permission: { decision: 'request_failed', source: 'system' },
              error: buildTraceError(errorText, 'permission'),
              outcome: 'permission_denied',
              isError: true,
              endedAt,
              duration: endedAt - permissionStartedAt,
            });
            logError(
              `[AgentRunner] Permission request failed for '${toolName}' — failing closed`,
              permErr
            );
            return {
              block: true,
              reason: `Permission request failed for '${displayName}'; tool not executed.`,
            };
          }

          if (evaluationMetrics) {
            evaluationMetrics.permissionWaitMs += Date.now() - permissionStartedAt;
          }

          if (result === 'deny') {
            const endedAt = Date.now();
            this.sendTraceUpdate(sessionId, permissionStepId, {
              status: 'error',
              title: `Permission denied: ${displayName}`,
              permission: { decision: 'user_deny', source: 'user' },
              error: buildTraceError(`User denied permission for '${displayName}'.`, 'permission'),
              outcome: 'permission_denied',
              isError: true,
              endedAt,
              duration: endedAt - permissionStartedAt,
            });
            log(`[AgentRunner] Tool '${toolName}' denied by user`);
            return { block: true, reason: `User denied permission for '${displayName}'.` };
          }

          if (result === 'allow_always') {
            rememberAlwaysAllow(sessionId, toolName);
          }
          const endedAt = Date.now();
          this.sendTraceUpdate(sessionId, permissionStepId, {
            status: 'completed',
            title: `Permission granted: ${displayName}`,
            permission: {
              decision: result === 'allow_always' ? 'allow_always' : 'user_allow',
              source: 'user',
              remembered: result === 'allow_always',
            },
            endedAt,
            duration: endedAt - permissionStartedAt,
          });
        } else {
          const now = Date.now();
          this.sendTraceStep(sessionId, {
            id: `${parentId}-permission-${uuidv4().slice(0, 8)}`,
            turnId,
            parentId,
            type: 'permission',
            status: 'completed',
            title: `Permission allowed by rule: ${displayName}`,
            toolName,
            toolInput: sanitizedInput,
            permission: { decision: 'rule_allow', source: 'rule' },
            timestamp: now,
            endedAt: now,
            duration: 0,
          });
        }

        // Allowed — delegate to SDK's original hook for event pipeline
        return sdkBeforeToolCall ? sdkBeforeToolCall(ctx, signal) : undefined;
      }
    );

    log(
      `[AgentRunner] Permission hook installed on session ${sessionId} via agent.setBeforeToolCall`
    );
  }

  /**
   * Check if a command contains sudo
   */
  private static isSudoCommand(command: string): boolean {
    return /\bsudo\b/.test(command);
  }

  private getToolDisplayName(toolName: string): string {
    const cached = this.toolDisplayNameCache.get(toolName);
    if (cached) {
      return cached;
    }

    let displayName = toolName;
    if (!toolName.startsWith('mcp__')) {
      this.toolDisplayNameCache.set(toolName, displayName);
      return displayName;
    }

    const mcpTool = this.mcpManager?.getTool(toolName);
    if (mcpTool?.originalName) {
      displayName = mcpTool.originalName;
    } else {
      const match = toolName.match(/^mcp__(.+?)__(.+)$/);
      displayName = match?.[2] || toolName;
    }

    this.toolDisplayNameCache.set(toolName, displayName);
    return displayName;
  }

  /**
   * Wrap the bash tool in the coding tools array to intercept sudo commands.
   * When a sudo command is detected, prompts the user for a password,
   * then rewrites the command to pipe the password into sudo -S.
   */
  private wrapBashToolForSudo(
    tools: ToolDefinition[],
    sessionId: string,
    effectiveCwd: string
  ): ToolDefinition[] {
    if (!this.requestSudoPassword) return tools;

    const requestSudoPassword = this.requestSudoPassword;

    return tools.map((tool) => {
      if (tool.name !== 'bash') return tool;

      const originalExecute = tool.execute;
      return {
        ...tool,
        execute: async (
          toolCallId: string,
          params: { command: string; timeout?: number },
          signal: AbortSignal | undefined,
          onUpdate: ((update: unknown) => void) | undefined,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ctx: any
        ) => {
          const command = params.command;

          if (AgentRunner.isSudoCommand(command)) {
            log('[AgentRunner] Sudo command detected, requesting password');
            const password = await requestSudoPassword(sessionId, toolCallId, command);

            if (!password) {
              log('[AgentRunner] Sudo password cancelled by user');
              return {
                content: [
                  { type: 'text' as const, text: 'Command cancelled: user denied sudo password.' },
                ],
                details: undefined as unknown,
              };
            }

            // Add -S flag to sudo invocations that don't already have it
            const rewrittenCommand = command.replace(/\bsudo\b(?!\s+-S)/g, 'sudo -S');

            // Pass password via stdin pipe so it never appears in process args
            // or environment variables. Uses async spawn with stdio: 'pipe'.
            log('[AgentRunner] Executing sudo command with password injection (via stdin pipe)');
            try {
              const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
              const shellArgs =
                process.platform === 'win32' ? ['/c', rewrittenCommand] : ['-c', rewrittenCommand];
              const timeoutMs = (params.timeout ?? 120) * 1000;
              const output = await new Promise<string>((resolve, reject) => {
                const child = spawn(shell, shellArgs, {
                  stdio: ['pipe', 'pipe', 'pipe'],
                  cwd: effectiveCwd,
                });
                let stdout = '';
                let stderr = '';
                const timer = setTimeout(() => {
                  child.kill('SIGKILL');
                  reject(new Error(`Sudo command timed out after ${timeoutMs}ms`));
                }, timeoutMs);
                child.stdout.on('data', (chunk: Buffer) => {
                  stdout += chunk.toString();
                });
                child.stderr.on('data', (chunk: Buffer) => {
                  stderr += chunk.toString();
                });
                child.on('error', (err) => {
                  clearTimeout(timer);
                  reject(err);
                });
                child.on('close', () => {
                  clearTimeout(timer);
                  resolve(stdout + stderr);
                });
                child.stdin.write(password + '\n');
                child.stdin.end();
              });
              return {
                content: [{ type: 'text' as const, text: output || '(no output)' }],
                details: undefined as unknown,
              };
            } catch (sudoErr) {
              logError('[AgentRunner] Sudo command failed:', sudoErr);
              throw sudoErr instanceof Error ? sudoErr : new Error(String(sudoErr));
            }
          }

          return originalExecute(toolCallId, params, signal, onUpdate, ctx);
        },
      } as ToolDefinition;
    });
  }

  /**
   * Wrap the bash tool to inject a default timeout when the model omits one.
   * The agent SDK's bash tool has no default timeout, which means
   * commands can run indefinitely if the model doesn't specify a timeout.
   */
  private static wrapBashToolWithDefaultTimeout(tools: ToolDefinition[]): ToolDefinition[] {
    const DEFAULT_BASH_TIMEOUT_SECONDS = 120;

    return tools.map((tool) => {
      if (tool.name !== 'bash') return tool;

      const originalExecute = tool.execute;
      return {
        ...tool,
        execute: async (
          toolCallId: string,
          params: { command: string; timeout?: number },
          signal: AbortSignal | undefined,
          onUpdate: ((update: unknown) => void) | undefined,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ctx: any
        ) => {
          const effectiveParams =
            params.timeout != null ? params : { ...params, timeout: DEFAULT_BASH_TIMEOUT_SECONDS };
          return originalExecute(toolCallId, effectiveParams, signal, onUpdate, ctx);
        },
      } as ToolDefinition;
    });
  }

  /**
   * Resolve current model string from runtime config.
   */
  private getCurrentModelString(preferredModel?: string): string {
    const routeModel = preferredModel?.trim();
    const configuredModel = configStore.get('model')?.trim();
    const model = routeModel || configuredModel || 'anthropic/claude-sonnet-4-6';
    logCtx('[AgentRunner] Current model:', model);
    logCtx(
      '[AgentRunner] Model source:',
      routeModel ? 'runtimeRoute.model' : configuredModel ? 'configStore.model' : 'default'
    );
    return model;
  }

  async run(
    session: Session,
    prompt: string,
    existingMessages: Message[],
    runtimeConfigOverride?: AgentRuntimeConfig,
    options?: AgentRunOptions
  ): Promise<void> {
    const runStartTime = Date.now();
    const turnId = uuidv4();
    const modelClock: { startedAt?: number } = {};
    const evaluationMetrics: TraceEvaluationMetrics = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      costTotal: 0,
      modelCallCount: 0,
      toolCallCount: 0,
      toolErrorCount: 0,
      permissionPromptCount: 0,
      totalDurationMs: 0,
      modelDurationMs: 0,
      toolDurationMs: 0,
      permissionWaitMs: 0,
    };
    const snapshotEvaluationMetrics = (): TraceEvaluationMetrics => ({
      ...evaluationMetrics,
      totalDurationMs: Date.now() - runStartTime,
      modelDurationMs:
        evaluationMetrics.modelDurationMs +
        (modelClock.startedAt ? Date.now() - modelClock.startedAt : 0),
    });
    this.activeTurnIds.set(session.id, turnId);
    this.activeEvaluationMetrics.set(session.id, evaluationMetrics);
    logCtx('[AgentRunner] run() started');

    const controller = new AbortController();
    try {
      // SDK 会在同一 AbortSignal 上挂载较多监听器，放开上限避免无意义告警干扰排错。
      setMaxListeners(0, controller.signal);
    } catch {
      // 旧运行时不支持 EventTarget 调整监听上限时忽略即可。
    }
    this.activeControllers.set(session.id, controller);

    // Sandbox isolation state (defined outside try for finally access)
    let sandboxPath: string | null = null;
    let useSandboxIsolation = false;

    // Helper to convert real sandbox paths back to virtual workspace paths in output
    // Cache the compiled regex to avoid recompilation on every call
    let sandboxPathRegex: RegExp | null = null;
    const sanitizeOutputPaths = (content: string): string => {
      if (!sandboxPath || !useSandboxIsolation) return content;
      if (!sandboxPathRegex) {
        sandboxPathRegex = new RegExp(sandboxPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      }
      // Replace real sandbox path with virtual workspace path
      return content.replace(sandboxPathRegex, VIRTUAL_WORKSPACE_PATH);
    };

    const thinkingStepId = uuidv4();
    let abortedByTimeout = false;
    // Set to true when the loop-guard unilaterally aborts (hash_abort / freq_abort).
    // The catch block consults this flag to avoid overwriting the 'error' trace
    // status that handleLoopGuardDecision has already published.
    let abortedByLoopGuard = false;
    const seenToolCallIds = new Set<string>();

    try {
      this.pathResolver.registerSession(session.id, session.mountedPaths);
      logTiming('pathResolver.registerSession', runStartTime);

      // Note: User message is now added by the frontend immediately for better UX
      // No need to send it again from backend

      // Send initial thinking trace
      this.sendTraceStep(session.id, {
        id: thinkingStepId,
        turnId,
        type: 'thinking',
        status: 'running',
        title: 'Processing request...',
        timestamp: Date.now(),
      });
      logTiming('sendTraceStep (thinking)', runStartTime);

      // Use session's cwd - each session has its own working directory
      const workingDir = session.cwd || undefined;
      logCtx('[AgentRunner] Working directory:', workingDir || '(none)');

      const syncState = await initSandboxSyncForRun({
        session,
        workingDir,
        sendToRenderer: this.sendToRenderer,
        skills: this.skills,
      });
      sandboxPath = syncState.sandboxPath;
      useSandboxIsolation = syncState.useSandboxIsolation;
      const sandbox = syncState.sandbox;

      // Check if current user message includes images
      const lastUserMessage =
        existingMessages.length > 0 ? existingMessages[existingMessages.length - 1] : null;

      logCtx('[AgentRunner] Total messages:', existingMessages.length);

      const hasImages =
        lastUserMessage?.content.some((c) => (c as { type?: string }).type === 'image') || false;
      if (hasImages) {
        log('[AgentRunner] User message contains images');
      }

      logTiming('before pi-ai model resolution', runStartTime);

      // Resolve model via pi-ai
      const runtimeConfig = runtimeConfigOverride ?? configStore.getAll();
      const modelString = this.getCurrentModelString(runtimeConfig.model);
      const configProtocol = resolvePiRouteProtocol(
        runtimeConfig.provider,
        runtimeConfig.customProtocol
      );

      // Normalize base URL for OpenAI-compatible providers (strips copy-pasted endpoint suffixes)
      const rawBaseUrl = runtimeConfig.baseUrl?.trim() || undefined;
      const effectiveBaseUrl =
        configProtocol === 'openai' && runtimeConfig.provider !== 'ollama'
          ? normalizeOpenAICompatibleBaseUrl(rawBaseUrl) || rawBaseUrl
          : rawBaseUrl;

      let usedSyntheticModel = false;
      let piModel = resolvePiRegistryModel(modelString, {
        configProvider: configProtocol,
        customBaseUrl: effectiveBaseUrl,
        rawProvider: runtimeConfig.provider,
        customProtocol: runtimeConfig.customProtocol,
      });

      if (!piModel) {
        usedSyntheticModel = true;
        // Synthetic fallback: construct a Model for unknown/custom models
        const synthetic = resolveSyntheticPiModelFallback({
          rawModel: runtimeConfig.model,
          resolvedModelString: modelString,
          rawProvider: runtimeConfig.provider,
          routeProtocol: configProtocol,
          baseUrl: effectiveBaseUrl,
        });
        piModel = buildSyntheticPiModel(
          synthetic.modelId,
          synthetic.provider,
          configProtocol,
          effectiveBaseUrl,
          undefined,
          undefined,
          runtimeConfig.contextWindow,
          runtimeConfig.maxTokens
        );
        // Apply the same runtime overrides (developer role compat, base URL, API downgrade)
        // that resolvePiRegistryModel applies to registry models
        piModel = applyPiModelRuntimeOverrides(piModel, {
          configProvider: configProtocol,
          customBaseUrl: effectiveBaseUrl,
          rawProvider: runtimeConfig.provider,
          customProtocol: runtimeConfig.customProtocol,
        });
        logCtxWarn(
          '[AgentRunner] Model not in pi-ai registry, using synthetic model:',
          modelString,
          '→',
          piModel.api
        );
      }
      logCtx('[AgentRunner] Resolved pi-ai model:', piModel.provider, piModel.id);

      // For Ollama: query actual context window from /api/show if user hasn't configured one
      const provider = runtimeConfig.provider || 'anthropic';
      if (provider === 'ollama' && !runtimeConfig.contextWindow) {
        const ollamaBaseUrl =
          piModel.baseUrl || runtimeConfig.baseUrl || 'http://localhost:11434/v1';
        const ollamaInfo = await fetchOllamaModelInfo({
          baseUrl: ollamaBaseUrl,
          model: piModel.id,
          apiKey: runtimeConfig.apiKey,
        });
        if (ollamaInfo.contextWindow) {
          log(
            '[AgentRunner] Ollama /api/show reported contextWindow:',
            ollamaInfo.contextWindow,
            '(was:',
            piModel.contextWindow,
            ')'
          );
          piModel = { ...piModel, contextWindow: ollamaInfo.contextWindow };
        }
      }

      // Send context window info to renderer for UI display
      this.sendToRenderer({
        type: 'session.contextInfo',
        payload: {
          sessionId: session.id,
          contextWindow: piModel.contextWindow || 128000,
        },
      });

      // Set up API keys via AuthStorage
      const authStorage = getSharedAuthStorage();
      const apiKey = runtimeConfig.apiKey?.trim();
      if (provider === 'openai-codex' && !apiKey) {
        // ChatGPT subscription auth: credentials live in AuthStorage as OAuth
        // (imported from the local codex CLI or acquired via in-app login) and
        // are refreshed automatically by AuthStorage.getApiKey().
        if (!ensureCodexCredentials()) {
          throw new Error(
            'OpenAI Codex（ChatGPT 订阅）未连接。请在 设置 → API 中选择 OpenAI Codex，连接本地 codex CLI 登录态或完成浏览器登录。'
          );
        }
        log('[AgentRunner] Using OAuth credentials for openai-codex');
      } else if (apiKey) {
        // Map our config provider to pi-ai provider name
        const piProvider =
          provider === 'custom' ? runtimeConfig.customProtocol || 'anthropic' : provider;
        authStorage.setRuntimeApiKey(piProvider, apiKey);
        // Also set the key for the model's native provider (e.g., when using
        // google/gemini via openrouter, pi-ai looks up "google" not "openrouter")
        if (piModel.provider !== piProvider) {
          authStorage.setRuntimeApiKey(piModel.provider, apiKey);
          log('[AgentRunner] Set runtime API key for model provider:', piModel.provider);
        }
        log('[AgentRunner] Set runtime API key for config provider:', piProvider);
      } else {
        if (provider === 'ollama') {
          log(
            '[AgentRunner] Ollama configured without explicit API key; relying on OpenAI-compatible placeholder/env auth path',
            safeStringify({
              provider,
              modelProvider: piModel.provider,
              modelId: piModel.id,
              baseUrl: piModel.baseUrl || runtimeConfig.baseUrl || '',
            })
          );
        } else {
          logWarn('[AgentRunner] No API key configured for provider:', provider);
        }
      }

      // baseUrl is now embedded in the model object via resolvePiModel()
      logCtx('[AgentRunner] Model baseUrl:', piModel.baseUrl, 'api:', piModel.api);

      logTiming('after pi-ai model resolution', runStartTime);

      // the agent SDK handles path sandboxing via its own tools
      const imageCapable = true; // pi-ai models generally support images; let the model handle unsupported cases
      const effectiveCwd =
        useSandboxIsolation && sandboxPath ? sandboxPath : workingDir || process.cwd();

      // Use app-specific agent config directory to avoid conflicts with user settings
      // SDK uses CLAUDE_CONFIG_DIR to locate skills
      const appAgentDir = this.skills.getAppAgentDir();

      // Skills directory setup: only run on the first query per runner instance.
      // Symlinks and directories are stable across queries; re-running every time
      // wastes ~10-30 syscalls per query for no benefit. Call invalidateSkillsSetup()
      // to force a re-run after the user installs or removes a skill.
      if (!this._skillsSetupDone) {
        // Set flag at start to prevent re-entrant calls from concurrent queries
        this._skillsSetupDone = true;

        // Ensure app agent config directory exists
        if (!fs.existsSync(appAgentDir)) {
          fs.mkdirSync(appAgentDir, { recursive: true });
        }

        // Ensure app agent skills directory exists
        const appSkillsDir = this.skills.getRuntimeSkillsDir();
        if (!fs.existsSync(appSkillsDir)) {
          fs.mkdirSync(appSkillsDir, { recursive: true });
        }

        // Copy built-in skills to app agent skills directory if they don't exist
        const builtinSkillsPath = this.skills.getBuiltinSkillsPath();
        if (builtinSkillsPath && fs.existsSync(builtinSkillsPath)) {
          // Symlinks into .asar archives don't work at the OS level (ENOTDIR),
          // so always copy when the source is inside an asar archive.
          // Use regex to match .asar/ but NOT .asar.unpacked/ (which is a real directory).
          const sourceInsideAsar = /\.asar[/\\]/.test(builtinSkillsPath);
          const builtinSkills = fs.readdirSync(builtinSkillsPath);
          for (const skillName of builtinSkills) {
            const builtinSkillPath = path.join(builtinSkillsPath, skillName);
            const userSkillPath = path.join(appSkillsDir, skillName);

            // Clean up broken symlinks pointing into .asar from previous versions
            try {
              const lstat = fs.lstatSync(userSkillPath);
              if (lstat.isSymbolicLink()) {
                const linkTarget = fs.readlinkSync(userSkillPath);
                if (/\.asar[/\\]/.test(linkTarget)) {
                  fs.unlinkSync(userSkillPath);
                  log(`[AgentRunner] Removed broken asar symlink: ${userSkillPath}`);
                }
              }
            } catch {
              // Path doesn't exist — fine, we'll create it below
            }

            // Only set up if it's a directory and doesn't exist in app directory
            if (fs.statSync(builtinSkillPath).isDirectory() && !fs.existsSync(userSkillPath)) {
              if (sourceInsideAsar) {
                // Source is inside .asar — must copy (symlinks to asar paths fail at OS level)
                this.skills.copyDirectorySync(builtinSkillPath, userSkillPath);
                log(`[AgentRunner] Copied built-in skill from asar: ${skillName}`);
              } else {
                // Source is a real directory — symlink for space efficiency
                try {
                  fs.symlinkSync(builtinSkillPath, userSkillPath, 'dir');
                  log(`[AgentRunner] Linked built-in skill: ${skillName}`);
                } catch (err) {
                  logWarn(`[AgentRunner] Failed to symlink ${skillName}, copying instead:`, err);
                  this.skills.copyDirectorySync(builtinSkillPath, userSkillPath);
                }
              }
            }
          }
        }

        this.skills.syncUserSkillsToAppDir(appSkillsDir);
        this.skills.syncConfiguredSkillsToRuntimeDir(appSkillsDir);
      }

      // Build available skills section dynamically — now handled by pi's DefaultResourceLoader
      // via additionalSkillPaths. No custom prompt building needed.

      log('[AgentRunner] App agent dir:', appAgentDir);
      log('[AgentRunner] User working directory:', workingDir);

      logTiming('before building conversation context', runStartTime);

      // pi-ai handles auth and model routing natively — no proxy, no env overrides needed.
      logCtx('[AgentRunner] Using pi-ai native routing for:', piModel.provider, piModel.id);

      // Resolve thinking level early — needed for session reuse check below
      const enableThinking =
        runtimeConfigOverride?.enableThinking ?? configStore.get('enableThinking') ?? false;
      logCtx('[AgentRunner] Enable thinking mode:', enableThinking);
      type PiThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
      const thinkingLevel: PiThinkingLevel = enableThinking ? 'medium' : 'off';
      const sessionRuntimeSignature = buildPiSessionRuntimeSignature({
        configProvider: runtimeConfig.provider,
        customProtocol: runtimeConfig.customProtocol,
        modelProvider: piModel.provider,
        modelApi: piModel.api,
        modelBaseUrl: piModel.baseUrl,
        effectiveCwd,
        apiKey,
      });
      const selectedSkillNames = Array.from(
        new Set((options?.selectedSkillNames || []).map((name) => name.trim()).filter(Boolean))
      );
      const selectedSkillNameSet = new Set(
        selectedSkillNames.map((name) => name.toLocaleLowerCase())
      );
      const skillPaths = await this.skills.resolveSkillPaths(session.id);
      const skillsSignature = JSON.stringify({
        paths: skillPaths,
        selected: selectedSkillNames,
      });
      log('[AgentRunner] Skill paths for pi ResourceLoader:', skillPaths);

      // Build contextual prompt — if reusing an existing SDK session, the SDK
      // already has conversation history so we only pass the new prompt.
      // For cold starts (new SDK session with existing DB history), we inject
      // a token-budgeted summary of recent history as a preamble.
      let cachedSession = this.piSessions.get(session.id);
      if (cachedSession && cachedSession.runtimeSignature !== sessionRuntimeSignature) {
        logCtx('[AgentRunner] Runtime changed, recreating cached pi session:', session.id);
        try {
          cachedSession.session.dispose();
        } catch (disposeError) {
          logWarn('[AgentRunner] dispose error while recreating pi session:', disposeError);
        }
        this.piSessions.delete(session.id);
        cachedSession = undefined;
      }
      if (cachedSession && cachedSession.skillsSignature !== skillsSignature) {
        logCtx('[AgentRunner] Skills changed, recreating cached pi session:', session.id);
        try {
          cachedSession.session.dispose();
        } catch (disposeError) {
          logWarn(
            '[AgentRunner] dispose error while recreating pi session for skills:',
            disposeError
          );
        }
        this.piSessions.delete(session.id);
        cachedSession = undefined;
      }

      const extensionResult = this.extensionManager
        ? await this.extensionManager.beforeSessionRun({
            session,
            prompt,
            existingMessages,
            isColdStart: !cachedSession,
            runtimeConfig,
          })
        : { promptPrefix: undefined, customTools: [] };

      let contextualPrompt = prompt;
      let coldStartHistory: PiMessage[] = [];
      if (!cachedSession) {
        // Cold start: rebuild recent history using the SDK's native structured
        // messages. Never embed tool protocol markup into the current user prompt.
        const conversationMessages = existingMessages.filter(
          (msg) => msg.role === 'user' || msg.role === 'assistant'
        );
        // Historical binary images are intentionally omitted to avoid injecting
        // large base64 payloads into a newly-created SDK session.
        const textOnlyMessages = conversationMessages.filter(
          (msg) => !msg.content.some((c) => (c as { type?: string }).type === 'image')
        );
        const historyMessages =
          textOnlyMessages.length > 0 &&
          textOnlyMessages[textOnlyMessages.length - 1]?.role === 'user'
            ? textOnlyMessages.slice(0, -1)
            : textOnlyMessages;

        if (historyMessages.length > 0) {
          // Content-aware chars-per-token estimation (CJK text uses ~1.5 chars/token vs ~4 for English)
          const contextWindow = piModel.contextWindow || 128000;
          const historyBudgetRatio = provider === 'ollama' && contextWindow < 16384 ? 0.15 : 0.3;
          const historyTokenBudget = Math.floor(contextWindow * historyBudgetRatio);

          const sampleText = JSON.stringify(historyMessages.slice(-3).map((m) => m.content));
          const charsPerToken = estimateCharsPerToken(sampleText);
          const historyCharBudget = Math.floor(historyTokenBudget * charsPerToken);
          coldStartHistory = buildColdStartAgentHistory(historyMessages, {
            api: piModel.api,
            provider: piModel.provider,
            model: piModel.id,
            maxChars: historyCharBudget,
          });

          if (coldStartHistory.length > 0) {
            log(
              '[AgentRunner] Cold start: restoring',
              coldStartHistory.length,
              'structured SDK messages from',
              historyMessages.length,
              'persisted messages (budget:',
              historyCharBudget,
              ', charsPerToken:',
              charsPerToken.toFixed(2),
              ')'
            );
          }
        }
      } else {
        // Reusing session — SDK already has the full conversation context
        logCtx('[AgentRunner] Reusing existing SDK session for:', session.id);
      }
      if (extensionResult.promptPrefix?.trim()) {
        contextualPrompt = `${extensionResult.promptPrefix.trim()}\n\n${contextualPrompt}`;
      }

      logTiming('before building MCP servers config', runStartTime);

      // Build MCP servers configuration for SDK
      // IMPORTANT: SDK uses tool names in format: mcp__<ServerKey>__<toolName>
      const mcpServers: Record<string, unknown> = {};
      if (this.mcpManager) {
        const serverStatuses = this.mcpManager.getServerStatus();
        const connectedServers = serverStatuses.filter((s) => s.connected);
        log('[AgentRunner] MCP server statuses:', safeStringify(serverStatuses));
        log('[AgentRunner] Connected MCP servers:', connectedServers.length);

        let allConfigs: ReturnType<typeof mcpConfigStore.getEnabledServers> = [];
        try {
          allConfigs = mcpConfigStore.getEnabledServers();
          log(
            '[AgentRunner] Enabled MCP configs:',
            allConfigs.map((c) => c.name)
          );
        } catch (error) {
          logWarn(
            '[AgentRunner] Failed to read enabled MCP configs; MCP tools will be unavailable this query',
            error
          );
          allConfigs = [];
        }

        // Cache key: serialized config list + imageCapable flag.  The bundled node
        // paths are stable for the lifetime of the process so they don't need to be
        // part of the fingerprint.
        const mcpFingerprint = JSON.stringify(allConfigs) + String(imageCapable);
        if (this._mcpServersCache?.fingerprint === mcpFingerprint) {
          Object.assign(mcpServers, this._mcpServersCache.servers);
          log('[AgentRunner] MCP servers config reused from cache');
        } else {
          // Use the module-level memoized helper — no more per-query fs.existsSync calls.
          const bundledNodePaths = getBundledNodePaths();
          const bundledNpx = bundledNodePaths?.npx ?? null;

          for (const config of allConfigs) {
            try {
              // Use a simpler key without spaces to avoid issues
              const serverKey = config.name;

              if (config.type === 'stdio') {
                // 当命令是 npx 或 node 时优先使用内置路径
                const command =
                  config.command === 'npx' && bundledNpx
                    ? bundledNpx
                    : config.command === 'node' && bundledNodePaths
                      ? bundledNodePaths.node
                      : config.command;

                // 使用内置 npx/node 时，将内置 node bin 注入 PATH
                const serverEnv = { ...config.env };
                if (bundledNodePaths && (config.command === 'npx' || config.command === 'node')) {
                  const nodeBinDir = path.dirname(bundledNodePaths.node);
                  const currentPath = process.env.PATH || '';
                  // Prepend bundled node bin to PATH so npx can find node
                  serverEnv.PATH = `${nodeBinDir}${path.delimiter}${currentPath}`;
                  log(`[AgentRunner]   Added bundled node bin to PATH: ${nodeBinDir}`);
                }

                if (!imageCapable) {
                  serverEnv.SOPHRON_DISABLE_IMAGE_TOOL_OUTPUT = '1';
                }

                // Resolve path placeholders for presets
                let resolvedArgs = config.args || [];

                // Check if any args contain placeholders that need resolving
                const hasPlaceholders = resolvedArgs.some(
                  (arg) =>
                    arg.includes('{SOFTWARE_DEV_SERVER_PATH}') ||
                    arg.includes('{GUI_OPERATE_SERVER_PATH}')
                );

                if (hasPlaceholders) {
                  // Get the appropriate preset based on config name
                  let presetKey: string | null = null;
                  if (
                    config.name === 'Software_Development' ||
                    config.name === 'Software Development'
                  ) {
                    presetKey = 'software-development';
                  } else if (config.name === 'GUI_Operate' || config.name === 'GUI Operate') {
                    presetKey = 'gui-operate';
                  }

                  if (presetKey) {
                    const preset = mcpConfigStore.createFromPreset(presetKey, true);
                    if (preset && preset.args) {
                      resolvedArgs = preset.args;
                    }
                  }
                }

                mcpServers[serverKey] = {
                  type: 'stdio',
                  command,
                  args: resolvedArgs,
                  env: serverEnv,
                };
                log(`[AgentRunner] Added STDIO MCP server: ${serverKey}`);
                log(`[AgentRunner]   Command: ${command} ${resolvedArgs.join(' ')}`);
                log(`[AgentRunner]   Tools will be named: mcp__${serverKey}__<toolName>`);
              } else if (config.type === 'sse') {
                mcpServers[serverKey] = {
                  type: 'sse',
                  url: config.url,
                  headers: config.headers || {},
                };
                log(`[AgentRunner] Added SSE MCP server: ${serverKey}`);
              }
            } catch (error) {
              logError('[AgentRunner] Failed to prepare MCP server config, skipping server', {
                serverId: config.id,
                serverName: config.name,
                error: toErrorText(error),
              });
            }
          }

          // Store in cache for subsequent queries
          this._mcpServersCache = { fingerprint: mcpFingerprint, servers: { ...mcpServers } };
        }

        const mcpServersSummary = Object.entries(mcpServers).map(([name, serverConfig]) => {
          const typedServerConfig = serverConfig as {
            type?: string;
            command?: string;
            args?: unknown[];
            env?: Record<string, unknown>;
          };
          return {
            name,
            type: typedServerConfig.type ?? 'unknown',
            command: typedServerConfig.command ?? '',
            argsCount: Array.isArray(typedServerConfig.args) ? typedServerConfig.args.length : 0,
            envKeys: typedServerConfig.env ? Object.keys(typedServerConfig.env).length : 0,
          };
        });
        log('[AgentRunner] Final mcpServers summary:', safeStringify(mcpServersSummary, 2));
        if (process.env.COWORK_LOG_SDK_MESSAGES_FULL === '1') {
          log('[AgentRunner] Final mcpServers config:', safeStringify(mcpServers, 2));
        }
      }
      logTiming('after building MCP servers config', runStartTime);

      const workspaceInfoPrompt =
        useSandboxIsolation && sandboxPath
          ? `<workspace_info>
Your current workspace is located at: ${VIRTUAL_WORKSPACE_PATH}
This is an isolated sandbox environment. Use ${VIRTUAL_WORKSPACE_PATH} as the root path for file operations.
</workspace_info>`
          : workingDir
            ? `<workspace_info>Your current workspace is: ${workingDir}</workspace_info>`
            : '';

      const coworkAppendPrompt = buildMainAgentSystemPrompt({
        workspaceInfo: workspaceInfoPrompt,
        bundledPathHints: this.skills.getBundledPathHints(),
      });

      logTiming('before agent session creation', runStartTime);

      // Create or reuse agent session
      // Bridge MCP tools as customTools for the agent SDK.
      // Re-read every query so newly added/removed MCP servers take effect immediately.
      const mcpCustomTools = this.mcpManager ? buildMcpCustomTools(this.mcpManager) : [];
      const extensionCustomTools = extensionResult.customTools || [];
      const customTools = [...mcpCustomTools, ...extensionCustomTools];
      if (mcpCustomTools.length > 0) {
        log(
          `[AgentRunner] Registered ${mcpCustomTools.length} MCP tools as customTools:`,
          mcpCustomTools.map((t) => t.name).join(', ')
        );
      }
      if (extensionCustomTools.length > 0) {
        log(
          `[AgentRunner] Registered ${extensionCustomTools.length} extension tools as customTools:`,
          extensionCustomTools.map((t) => t.name).join(', ')
        );
      }

      // Enrich process.env.PATH for build mode — ensures Skill commands (python3, node)
      // executed via Pi SDK's Bash tool can find bundled and user-installed executables.
      await enrichProcessPathForBuild();

      let codingTools: ReturnType<typeof createCodingTools>;
      if (useSandboxIsolation && sandboxPath && sandbox.isWSL && sandbox.wslStatus?.distro) {
        codingTools = createSandboxCodingTools(effectiveCwd, {
          type: 'wsl',
          distro: sandbox.wslStatus.distro,
        });
      } else if (useSandboxIsolation && sandboxPath && sandbox.isLima) {
        codingTools = createSandboxCodingTools(effectiveCwd, {
          type: 'lima',
          instanceName: sandbox.limaStatus?.instanceName,
        });
      } else {
        const bashOptions: BashToolOptions | undefined =
          process.platform === 'win32' ? { operations: createWindowsBashOperations() } : undefined;
        codingTools = createCodingTools(
          effectiveCwd,
          bashOptions ? { bash: bashOptions } : undefined
        );
      }

      // Inject a default 120s timeout for bash commands when the model omits one
      const withTimeout = AgentRunner.wrapBashToolWithDefaultTimeout(
        codingTools as ToolDefinition[]
      );

      // Wrap the bash tool to intercept sudo commands and request passwords
      // Note: wrapBashToolForSudo returns ToolDefinition[] (5-param execute) but
      // createAgentSession.tools expects Tool[] (4-param execute). The extra ctx
      // parameter is simply not passed by the session runner — safe to cast.
      const wrappedTools = this.wrapBashToolForSudo(withTimeout, session.id, effectiveCwd);

      // Diagnostic: log tools being passed to SDK (helps debug Ollama tool use)
      logCtx(`[AgentRunner] Session reuse check: cached=${!!cachedSession}`);
      logCtx(`[AgentRunner] Model=${piModel.id}, thinkingLevel=${thinkingLevel}`);
      log(
        `[AgentRunner] Built-in tools (${wrappedTools.length}): ${wrappedTools.map((t: { name?: string; type?: string }) => t.name || t.type).join(', ')}`
      );
      log(
        `[AgentRunner] Custom tools (${customTools.length}): ${customTools.map((t) => t.name).join(', ')}`
      );

      let piSession: PiAgentSession;
      if (cachedSession) {
        // Reuse existing session — SDK retains full conversation history and handles compaction
        piSession = cachedSession.session;

        // Hot-swap model/thinking if changed — SDK supports this natively
        if (cachedSession.modelId !== piModel.id) {
          logCtx(
            '[AgentRunner] Model changed, hot-swapping:',
            cachedSession.modelId,
            '→',
            piModel.id
          );
          await piSession.setModel(piModel);
          cachedSession.modelId = piModel.id;
          // Update Ollama num_ctx ref if present
          if (cachedSession.ollamaNumCtx) {
            cachedSession.ollamaNumCtx.value = piModel.contextWindow || 128000;
            log(
              '[AgentRunner] Updated Ollama num_ctx on hot-swap:',
              cachedSession.ollamaNumCtx.value
            );
          }
        }
        if (cachedSession.thinkingLevel !== thinkingLevel) {
          logCtx(
            '[AgentRunner] Thinking level changed, hot-swapping:',
            cachedSession.thinkingLevel,
            '→',
            thinkingLevel
          );
          piSession.setThinkingLevel(thinkingLevel);
          cachedSession.thinkingLevel = thinkingLevel;
        }

        logCtx('[AgentRunner] Reusing cached pi session for:', session.id);
        logTiming('agent session reused', runStartTime);
      } else {
        // First query in this session — create new agent session
        // ResourceLoader + ModelRegistry only needed for session creation — skip on reuse
        const { DefaultResourceLoader } = await import('@mariozechner/pi-coding-agent');
        const resourceLoader = new DefaultResourceLoader({
          cwd: effectiveCwd,
          additionalSkillPaths: skillPaths,
          appendSystemPrompt: coworkAppendPrompt,
          skillsOverride:
            selectedSkillNameSet.size > 0
              ? (current: { skills: PiSkill[]; diagnostics: ResourceDiagnostic[] }) => ({
                  skills: current.skills.filter((skill) =>
                    selectedSkillNameSet.has(skill.name.toLocaleLowerCase())
                  ),
                  diagnostics: current.diagnostics,
                })
              : undefined,
        });
        await resourceLoader.reload();

        const modelRegistry = new ModelRegistry(authStorage);

        // Ollama-specific compaction tuning based on actual context window
        const contextWindow = piModel.contextWindow || 128000;
        let compactionSettings: {
          enabled: boolean;
          reserveTokens?: number;
          keepRecentTokens?: number;
        };
        if (provider === 'ollama' && contextWindow < 16384) {
          // Very small context: disable compaction (weak models produce unreliable summaries)
          compactionSettings = { enabled: false };
          log(
            '[AgentRunner] Ollama small context model, disabling auto-compaction (contextWindow:',
            contextWindow,
            ')'
          );
        } else if (provider === 'ollama' && contextWindow < 65536) {
          // Medium context: scale reserves proportionally
          compactionSettings = {
            enabled: true,
            reserveTokens: Math.floor(contextWindow * 0.15),
            keepRecentTokens: Math.floor(contextWindow * 0.25),
          };
          log(
            '[AgentRunner] Ollama medium context, scaled compaction:',
            JSON.stringify(compactionSettings)
          );
        } else {
          compactionSettings = { enabled: true };
        }

        const piSessionManager = PiSessionManager.inMemory();
        for (const historyMessage of coldStartHistory) {
          piSessionManager.appendMessage(historyMessage);
        }

        const { session: newPiSession } = await createAgentSession({
          model: piModel,
          thinkingLevel,
          authStorage,
          modelRegistry,
          tools: wrappedTools as unknown as ReturnType<typeof createCodingTools>,
          customTools,
          sessionManager: piSessionManager,
          settingsManager: PiSettingsManager.inMemory({
            compaction: compactionSettings,
            retry: { enabled: true, maxRetries: 2 },
          }),
          resourceLoader,
          cwd: effectiveCwd,
        });
        piSession = newPiSession;

        if (coldStartHistory.length > 0) {
          log(
            '[AgentRunner] Seeded structured cold-start history into SDK session:',
            coldStartHistory.length,
            'messages'
          );
        }

        // Install permission-gating hook via the SDK's tool_call extension event.
        // This must happen once per new session — the hook persists across reuses.
        this.installPermissionHook(piSession, session.id);

        // Store session for reuse — evict oldest if cache is full
        if (this.piSessions.size >= AgentRunner.MAX_CACHED_SESSIONS) {
          const oldestKey = this.piSessions.keys().next().value;
          if (oldestKey) {
            const oldest = this.piSessions.get(oldestKey);
            if (oldest) {
              try {
                oldest.session.dispose();
              } catch (e) {
                logWarn('[AgentRunner] dispose error on eviction:', e);
              }
            }
            this.piSessions.delete(oldestKey);
            log('[AgentRunner] Evicted oldest cached session:', oldestKey);
          }
        }
        this.piSessions.set(session.id, {
          session: piSession,
          modelId: piModel.id,
          thinkingLevel,
          runtimeSignature: sessionRuntimeSignature,
          skillsSignature,
        });

        // Ollama: wrap _onPayload to inject num_ctx into every request
        if (provider === 'ollama') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const agent = piSession.agent as any;
          // Guard: only patch if the SDK exposes _onPayload (private API)
          if (!('_onPayload' in agent)) {
            logWarn(
              '[AgentRunner] SDK agent does not expose _onPayload — skipping Ollama num_ctx patch'
            );
          } else {
            const originalOnPayload = agent._onPayload as
              | ((
                  payload: Record<string, unknown>,
                  modelArg: unknown
                ) => Promise<Record<string, unknown>>)
              | undefined;
            const ollamaNumCtx = {
              value: piModel.contextWindow || 128000,
            };
            agent._onPayload = async (payload: Record<string, unknown>, modelArg: unknown) => {
              let result = originalOnPayload
                ? await originalOnPayload.call(agent, payload, modelArg)
                : payload;
              if (result === undefined) result = payload;
              return { ...result, num_ctx: ollamaNumCtx.value };
            };
            this.piSessions.get(session.id)!.ollamaNumCtx = ollamaNumCtx;
            log('[AgentRunner] Ollama _onPayload wrapper installed, num_ctx:', ollamaNumCtx.value);
          } // end else (_onPayload exists)
        }

        logTiming('agent session created', runStartTime);
      }

      evaluationMetrics.provider = piModel.provider || provider;
      evaluationMetrics.model = piModel.id;

      // Set up event handler to bridge agent SDK events → our ServerEvent protocol
      const eventBridge = new AgentRunEventBridge({
        session,
        piSession,
        controller,
        thinkingStepId,
        turnId,
        runStartTime,
        provider,
        piModel,
        runtimeConfig,
        evaluationMetrics,
        snapshotEvaluationMetrics,
        sendToRenderer: this.sendToRenderer,
        sendMessage: this.sendMessage.bind(this),
        sendPartial: this.sendPartial.bind(this),
        sendTraceStep: this.sendTraceStep.bind(this),
        sendTraceUpdate: this.sendTraceUpdate.bind(this),
        getToolDisplayName: this.getToolDisplayName.bind(this),
        toolStartedAt: this.toolStartedAt,
        modelClock,
        sanitizeOutputPaths,
        seenToolCallIds,
        usedSyntheticModel,
        onLoopGuardAbort: () => {
          abortedByLoopGuard = true;
        },
        onTimeoutAbort: () => {
          abortedByTimeout = true;
        },
      });
      const unsubscribe = eventBridge.subscribe();

      // Execute the prompt — unsubscribe in finally to prevent event listener leak
      try {
        eventBridge.resetActivityTimeout();
        if (provider === 'ollama') {
          log(
            '[AgentRunner] Starting Ollama prompt',
            safeStringify({
              sessionId: session.id,
              modelId: piModel.id,
              modelProvider: piModel.provider,
              baseUrl: piModel.baseUrl || runtimeConfig.baseUrl || '',
              usedSyntheticModel,
              hasExplicitApiKey: Boolean(apiKey),
              thinkingLevel,
            })
          );
        }
        const promptResult = await piSession.prompt(contextualPrompt);
        log(
          '[AgentRunner] prompt() returned:',
          JSON.stringify(promptResult ?? 'void').substring(0, 1000)
        );

        if (
          eventBridge.retryableProtocolViolation &&
          eventBridge.attemptToolCallIds.size === 0 &&
          !controller.signal.aborted &&
          !eventBridge.terminalErrorText
        ) {
          eventBridge.discardLastMalformedAssistant();
          logWarn('[AgentRunner] Retrying once after pseudo tool-call protocol violation');
          this.sendTraceUpdate(session.id, thinkingStepId, {
            title: 'Retrying malformed tool call...',
          });
          eventBridge.resetProtocolRetryState();
          eventBridge.resetActivityTimeout();
          await piSession.agent.continue();
        }

        if (eventBridge.retryableProtocolViolation) {
          eventBridge.discardLastMalformedAssistant();
          eventBridge.terminalProtocolViolation = true;
          eventBridge.terminalErrorText =
            '模型未通过结构化工具通道发起调用。系统已拦截协议文本并完成一次安全重试，请重试当前请求或切换模型。';
          if (!eventBridge.hasEmittedError) {
            eventBridge.hasEmittedError = true;
            const protocolErrorMessage: PiAssistantMessage = {
              role: 'assistant',
              content: [{ type: 'text', text: eventBridge.terminalErrorText }],
              api: piModel.api,
              provider: piModel.provider,
              model: piModel.id,
              usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
              },
              stopReason: 'error',
              errorMessage: eventBridge.terminalErrorText,
              timestamp: Date.now(),
            };
            piSession.sessionManager.appendMessage(protocolErrorMessage);
            piSession.agent.appendMessage(protocolErrorMessage);
            this.sendMessage(session.id, {
              id: uuidv4(),
              sessionId: session.id,
              role: 'assistant',
              content: [
                { type: 'text', text: `**工具调用失败**：${eventBridge.terminalErrorText}` },
              ],
              timestamp: Date.now(),
            });
          }
        }
      } finally {
        if (modelClock.startedAt) {
          evaluationMetrics.modelDurationMs += Date.now() - modelClock.startedAt;
          modelClock.startedAt = undefined;
        }
        try {
          unsubscribe();
        } catch (e) {
          logWarn('[AgentRunner] unsubscribe error:', e);
        }
        if (eventBridge.activityTimeoutId) clearTimeout(eventBridge.activityTimeoutId);
        if (eventBridge.ollamaColdStartTimerId) clearTimeout(eventBridge.ollamaColdStartTimerId);
      }

      logTiming('agent prompt completed', runStartTime);

      // If the SDK swallowed the AbortError and returned void, detect timeout here
      if (controller.signal.aborted && abortedByTimeout) {
        logCtx('[AgentRunner] Aborted due to timeout (detected after prompt returned)');
        const errorMsg: Message = {
          id: uuidv4(),
          sessionId: session.id,
          role: 'assistant',
          content: [{ type: 'text', text: '**请求超时**：长时间未收到响应，操作已中止。' }],
          timestamp: Date.now(),
        };
        this.sendMessage(session.id, errorMsg);
        this.sendTraceUpdate(session.id, thinkingStepId, {
          status: 'error',
          title: 'Request timed out',
          error: buildTraceError('No activity was received before the request timeout.', 'timeout'),
          outcome: 'timed_out',
          isError: true,
          metrics: snapshotEvaluationMetrics(),
          endedAt: Date.now(),
          duration: Date.now() - runStartTime,
        });
        return;
      }
      // If the SDK swallowed the AbortError after a loop-guard abort, preserve
      // the 'error' trace status that eventBridge.handleLoopGuardDecision already published.
      // The user-facing message and trace step are already set; do not overwrite
      // them with the default "Task completed" below.
      if (controller.signal.aborted && abortedByLoopGuard) {
        logCtx('[AgentRunner] Aborted by loop guard (detected after prompt returned)');
        return;
      }
      // Complete - update the initial thinking step
      this.sendTraceUpdate(session.id, thinkingStepId, {
        status: eventBridge.terminalErrorText ? 'error' : 'completed',
        title: eventBridge.terminalErrorText ? 'Request failed' : 'Task completed',
        error: eventBridge.terminalErrorText
          ? buildTraceError(eventBridge.terminalErrorText, 'provider')
          : undefined,
        isError: Boolean(eventBridge.terminalErrorText),
        outcome: eventBridge.terminalErrorText
          ? eventBridge.terminalProtocolViolation
            ? 'protocol_violation'
            : 'provider_failed'
          : eventBridge.toolErrorCount > 0
            ? 'tool_failed'
            : eventBridge.toolCallCount > 0
              ? 'tool_completed'
              : 'responded_without_tool',
        metrics: snapshotEvaluationMetrics(),
        endedAt: Date.now(),
        duration: Date.now() - runStartTime,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        if (abortedByTimeout) {
          logCtx('[AgentRunner] Aborted due to timeout');
          const errorMsg: Message = {
            id: uuidv4(),
            sessionId: session.id,
            role: 'assistant',
            content: [{ type: 'text', text: '**请求超时**：长时间未收到响应，操作已中止。' }],
            timestamp: Date.now(),
          };
          this.sendMessage(session.id, errorMsg);
          this.sendTraceUpdate(session.id, thinkingStepId, {
            status: 'error',
            title: 'Request timed out',
            error: buildTraceError(
              'No activity was received before the request timeout.',
              'timeout'
            ),
            outcome: 'timed_out',
            isError: true,
            metrics: snapshotEvaluationMetrics(),
            endedAt: Date.now(),
            duration: Date.now() - runStartTime,
          });
        } else if (abortedByLoopGuard) {
          // Loop guard already published the user-facing assistant message and
          // an 'error' trace step with the loop-detected title. Do NOT overwrite
          // them here with a 'completed/Cancelled' state.
          logCtx('[AgentRunner] Aborted by loop guard');
        } else {
          logCtx('[AgentRunner] Aborted by user');
          this.sendTraceUpdate(session.id, thinkingStepId, {
            status: 'completed',
            title: 'Cancelled',
            outcome: 'cancelled',
            metrics: snapshotEvaluationMetrics(),
            endedAt: Date.now(),
            duration: Date.now() - runStartTime,
          });
        }
      } else {
        logCtxError('[AgentRunner] Error:', error);

        const errorText = toUserFacingErrorText(toErrorText(error));
        const errorMsg: Message = {
          id: uuidv4(),
          sessionId: session.id,
          role: 'assistant',
          content: [{ type: 'text', text: `**Error**: ${errorText}` }],
          timestamp: Date.now(),
        };
        this.sendMessage(session.id, errorMsg);

        this.sendTraceUpdate(session.id, thinkingStepId, {
          status: 'error',
          title: 'Request failed',
          error: buildTraceError(errorText, 'provider'),
          outcome: 'provider_failed',
          isError: true,
          metrics: snapshotEvaluationMetrics(),
          endedAt: Date.now(),
          duration: Date.now() - runStartTime,
        });

        // Mark so session-manager doesn't report again
        if (error instanceof Error) {
          (error as Error & { alreadyReportedToUser?: boolean }).alreadyReportedToUser = true;
        }
      }
    } finally {
      this.activeControllers.delete(session.id);
      this.pathResolver.unregisterSession(session.id);

      const recordSandboxSyncFailure = (message: string): void => {
        const endedAt = Date.now();
        this.sendTraceStep(session.id, {
          id: uuidv4(),
          turnId,
          parentId: thinkingStepId,
          type: 'thinking',
          status: 'error',
          title: 'Sandbox sync failed',
          error: buildTraceError(message, 'sandbox_sync'),
          isError: true,
          timestamp: endedAt,
          endedAt,
          duration: 0,
        });
      };

      // Sync changes from sandbox back to host OS (but don't cleanup - sandbox persists)
      if (useSandboxIsolation && sandboxPath) {
        try {
          const sandbox = getSandboxAdapter();

          if (sandbox.isWSL) {
            log('[AgentRunner] Syncing sandbox changes to Windows...');
            const syncResult = await SandboxSync.syncToWindows(session.id);
            if (syncResult.success) {
              log('[AgentRunner] Sync completed successfully');
            } else {
              logError('[AgentRunner] Sync failed:', syncResult.error);
              recordSandboxSyncFailure(syncResult.error || 'Windows sandbox sync failed.');
            }
          } else if (sandbox.isLima) {
            log('[AgentRunner] Syncing sandbox changes to macOS...');
            const { LimaSync } = await import('../sandbox/lima-sync');
            const syncResult = await LimaSync.syncToMac(session.id);
            if (syncResult.success) {
              log('[AgentRunner] Sync completed successfully');
            } else {
              logError('[AgentRunner] Sync failed:', syncResult.error);
              recordSandboxSyncFailure(syncResult.error || 'macOS sandbox sync failed.');
            }
          }
        } catch (syncErr) {
          logError('[AgentRunner] Sandbox sync error:', syncErr);
          const errorText = toErrorText(syncErr);
          recordSandboxSyncFailure(errorText);
          this.sendMessage(session.id, {
            id: uuidv4(),
            sessionId: session.id,
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: `**Warning**: Sandbox sync failed: ${syncErr instanceof Error ? syncErr.message : String(syncErr)}`,
              },
            ],
            timestamp: Date.now(),
          });
        }
      }

      const finalizedAt = Date.now();
      for (const toolCallId of seenToolCallIds) {
        const key = `${session.id}:${toolCallId}`;
        const startedAt = this.toolStartedAt.get(key);
        if (startedAt) evaluationMetrics.toolDurationMs += finalizedAt - startedAt;
        this.toolStartedAt.delete(key);
      }
      this.sendTraceUpdate(session.id, thinkingStepId, {
        turnId,
        type: 'thinking',
        metrics: snapshotEvaluationMetrics(),
        endedAt: finalizedAt,
        duration: finalizedAt - runStartTime,
      });
      if (this.activeTurnIds.get(session.id) === turnId) {
        this.activeTurnIds.delete(session.id);
      }
      if (this.activeEvaluationMetrics.get(session.id) === evaluationMetrics) {
        this.activeEvaluationMetrics.delete(session.id);
      }
    }
  }

  cancel(sessionId: string): void {
    const controller = this.activeControllers.get(sessionId);
    if (controller) controller.abort();
  }

  private sendTraceStep(sessionId: string, step: TraceStep): void {
    log(`[Trace] ${step.type}: ${step.title}`);
    this.sendToRenderer({ type: 'trace.step', payload: { sessionId, step } });
  }

  private sendTraceUpdate(sessionId: string, stepId: string, updates: Partial<TraceStep>): void {
    log(`[Trace] Update step ${stepId}:`, updates);
    this.sendToRenderer({ type: 'trace.update', payload: { sessionId, stepId, updates } });
  }

  private sendMessage(sessionId: string, message: Message): void {
    // Save message to database for persistence
    if (this.saveMessage) {
      this.saveMessage(message);
    }
    // Send to renderer for UI update
    this.sendToRenderer({ type: 'stream.message', payload: { sessionId, message } });
  }

  private sendPartial(sessionId: string, delta: string): void {
    this.sendToRenderer({ type: 'stream.partial', payload: { sessionId, delta } });
  }
}
