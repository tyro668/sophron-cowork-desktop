import { resolveRunModel } from './agent-runner-model';
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
  beginSkillUsageRun,
  recordSkillInvocation,
  skillNameFromToolInput,
} from '../skills/skill-usage';
import { bindAgentRunCancellation } from './agent-run-cancellation';
import {
  createAgentSession,
  getAgentDir,
  SessionManager as PiSessionManager,
  SettingsManager as PiSettingsManager,
  createCodingTools,
  type BashToolOptions,
  type AgentSession as PiAgentSession,
  type ToolDefinition,
  type Skill as PiSkill,
  type ResourceDiagnostic,
} from '@earendil-works/pi-coding-agent';
import type {
  AssistantMessage as PiAssistantMessage,
  Message as PiMessage,
} from '@earendil-works/pi-ai';
import type { SessionTurnOutcome } from '../session/session-turn';
import { harnessMessage } from '../utils/harness-messages';
import { createSessionModelRuntime } from './shared-auth';
import type {
  Session,
  Message,
  TraceStep,
  ServerEvent,
  AgentRuntimeConfig,
  TraceEvaluationMetrics,
} from '../../shared/contracts';
import { v4 as uuidv4 } from 'uuid';
import { evaluatePermission, rememberAlwaysAllow } from '../config/permission-rules-store';
import { completePermissionReview } from '../config/permission-model-review';
import { runPiAiOneShot } from './pi-ai-one-shot';
import {
  resolveConfiguredThinkingLevel,
  resolveEffectiveThinkingLevel,
} from './pi-model-resolution';
import { PathResolver } from '../sandbox/path-resolver';
import { MCPManager } from '../mcp/mcp-manager';
import { log, logWarn, logError, logCtx, logCtxError, logTiming } from '../utils/logger';
import { spawn } from 'child_process';
import { setMaxListeners } from 'node:events';
import { PluginRuntimeService } from '../skills/plugin-runtime-service';
import type { SkillsAdapter } from '../skills/skills-adapter';
import { AgentRuntimeExtensionManager } from '../extensions/agent-runtime-extension-manager';
import { configStore } from '../config/config-store';
import { toUserFacingErrorText } from './agent-runner-message-end';
import { AGENT_TURN_RETRY_SETTINGS } from './agent-runner-retry';
import { buildPiSessionRuntimeSignature } from './pi-session-runtime';
import { buildColdStartAgentHistory, toPiImageContent } from './agent-protocol-safety';
import { ensureCodexCredentials } from '../config/codex-auth';
import { createWindowsBashOperations } from './windows-bash-operations';
import { createSandboxCodingTools } from './sandbox-tool-operations';
import { buildTraceError, sanitizeTraceInput } from './trace-utils';
import { buildMainAgentSystemPrompt } from '../prompts/main-agent';
import {
  VIRTUAL_WORKSPACE_PATH,
  estimateCharsPerToken,
  enrichProcessPathForBuild,
} from './agent-runner-env';
import { initSandboxSyncForRun, syncRunWorkspaceToHost } from './agent-runner-sandbox-sync';
import { AgentRunEventBridge } from './agent-runner-event-bridge';
import { safeStringify, toErrorText } from './agent-runner-log-utils';
import {
  activateSessionTools,
  expandToolsToPacks,
  replaceSessionToolRegistry,
  buildMcpCustomTools,
  buildMcpToolPacks,
  selectActiveToolsForTurn,
} from './agent-runner-tools';
import { AgentRunnerSkills } from './agent-runner-skills';
import { createCapabilitiesSearchTool } from './agent-capabilities-tool';
import type { AgentToolPack, ToolActivationResult } from '../extensions/agent-runtime-extension';
import { AgentRequestContext } from './agent-request-context';
import { installAgentPermissionGate } from './agent-permission-hook';
import { checkAppDataAccess, resolveAppUserDataDir } from './app-data-guard';
import { getDatabase, type DatabaseInstance } from '../db/database';
import { APP_TURN_ENTRY, HistorySummaryRepository, historyUserText } from './history-summary';
import { SessionResultRepository } from '../session/session-result-repository';
import { ModelResultStore, RESULT_READ_TOOL } from './model-result-store';

function installBaseTools(session: PiAgentSession, tools: Array<{ name: string }>): void {
  // createAgentSession() does not expose baseToolsOverride. Sandbox, sudo, and
  // default-timeout wrappers still have to replace the built-in tool implementations.
  const internal = session as unknown as {
    _baseToolsOverride?: Record<string, unknown>;
    _buildRuntime: (options?: {
      activeToolNames?: string[];
      includeAllExtensionTools?: boolean;
    }) => void;
  };
  internal._baseToolsOverride = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
  internal._buildRuntime({
    activeToolNames: tools.map((tool) => tool.name),
    includeAllExtensionTools: true,
  });
}

// Virtual workspace path shown to the model (hides real sandbox path)
interface AgentRunnerOptions {
  database?: DatabaseInstance;
  sendToRenderer: (event: ServerEvent) => void;
  saveMessage?: (message: Message) => void;
  sessionExists?: (sessionId: string) => boolean;
  requestSudoPassword?: (
    sessionId: string,
    toolUseId: string,
    command: string
  ) => Promise<string | null>;
  requestPermission?: (
    sessionId: string,
    toolUseId: string,
    toolName: string,
    input: Record<string, unknown>,
    signal?: AbortSignal
  ) => Promise<'allow' | 'deny' | 'allow_always'>;
}

interface CachedPiSession {
  session: PiAgentSession;
  modelId: string;
  thinkingLevel: string;
  runtimeSignature: string;
  skillsSignature?: string;
  ollamaNumCtx?: { value: number };
  requestContext: AgentRequestContext;
  resultStore: ModelResultStore;
}

interface AgentRunOptions {
  turnId?: string;
  selectedSkillNames?: string[];
}

/**
 * AgentRunner - Uses @earendil-works/pi-coding-agent SDK
 *
 * Environment variables should be set before running:
 *   ANTHROPIC_BASE_URL=https://openrouter.ai/api
 *   ANTHROPIC_AUTH_TOKEN=your_openrouter_api_key
 *   ANTHROPIC_API_KEY="" (must be empty)
 */
export class AgentRunner {
  private readonly database?: DatabaseInstance;
  private sendToRenderer: (event: ServerEvent) => void;
  private saveMessage?: (message: Message) => void;
  private readonly sessionExists?: (sessionId: string) => boolean;
  private requestSudoPassword?: (
    sessionId: string,
    toolUseId: string,
    command: string
  ) => Promise<string | null>;
  private requestPermission?: (
    sessionId: string,
    toolUseId: string,
    toolName: string,
    input: Record<string, unknown>,
    signal?: AbortSignal
  ) => Promise<'allow' | 'deny' | 'allow_always'>;
  private pathResolver: PathResolver;
  private mcpManager?: MCPManager;
  private extensionManager?: AgentRuntimeExtensionManager;
  private activeControllers: Map<string, AbortController> = new Map();
  private activeTurnIds: Map<string, string> = new Map();
  private activeEvaluationMetrics: Map<string, TraceEvaluationMetrics> = new Map();
  private activeEventBridges = new Map<string, AgentRunEventBridge>();
  private activePermissionContexts = new Map<
    string,
    { cwd: string; config: AgentRuntimeConfig; task: string }
  >();
  private toolStartedAt: Map<string, number> = new Map();
  private piSessions: Map<string, CachedPiSession> = new Map();
  private toolDisplayNameCache: Map<string, string> = new Map();
  private static readonly MAX_CACHED_SESSIONS = 50;

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
    this.skills.invalidateSetup();
  }

  constructor(
    options: AgentRunnerOptions,
    pathResolver: PathResolver,
    mcpManager?: MCPManager,
    pluginRuntimeService?: PluginRuntimeService,
    skillsAdapter?: SkillsAdapter,
    extensionManager?: AgentRuntimeExtensionManager
  ) {
    this.sendToRenderer = options.sendToRenderer;
    this.database = options.database;
    this.saveMessage = options.saveMessage;
    this.sessionExists = options.sessionExists;
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
   * Install a permission gate before the SDK's tool-call hook. This covers
   * built-in tools and custom/MCP tools, preserving extension interception
   * after permission is granted.
   *
   * Human confirmation pauses the activity watchdog and remains pending until
   * answered or explicitly cancelled with the task.
   */
  private installPermissionHook(piSession: PiAgentSession, sessionId: string): void {
    if (!this.requestPermission) {
      throw new Error('Permission hook unavailable: no requestPermission callback');
    }

    const requestPermission = this.requestPermission;
    const getDisplayName = (name: string): string => this.getToolDisplayName(name);

    installAgentPermissionGate(piSession.agent, async (ctx, signal) => {
      const toolName: string = ctx.toolCall?.name ?? '';
      const input = (ctx.args ?? {}) as Record<string, unknown>;
      const loadedSkill = skillNameFromToolInput(toolName, input);
      if (loadedSkill) recordSkillInvocation(loadedSkill, sessionId, 'loaded');

      const reviewContext = this.activePermissionContexts.get(sessionId);
      const userDataDir = resolveAppUserDataDir();
      const guardReason = userDataDir
        ? checkAppDataAccess(toolName, input, { userDataDir, cwd: reviewContext?.cwd })
        : null;
      if (guardReason) {
        log(`[AgentRunner] Tool '${toolName}' blocked: targets app internal data store`);
        const now = Date.now();
        const parentId: string = ctx.toolCall?.id ?? uuidv4();
        this.sendTraceStep(sessionId, {
          id: `${parentId}-permission-${uuidv4().slice(0, 8)}`,
          turnId: this.activeTurnIds.get(sessionId),
          parentId,
          type: 'permission',
          status: 'error',
          title: `Permission denied: ${getDisplayName(toolName)}`,
          toolName,
          toolInput: sanitizeTraceInput(input),
          permission: { decision: 'rule_deny', source: 'rule' },
          error: buildTraceError(guardReason, 'permission'),
          outcome: 'permission_denied',
          isError: true,
          timestamp: now,
          endedAt: now,
          duration: 0,
        });
        return { block: true, reason: guardReason };
      }
      const mcpTool = this.mcpManager?.getTool(toolName);
      const permissionSignal = signal ?? this.activeControllers.get(sessionId)?.signal;
      let evaluation = evaluatePermission(
        sessionId,
        toolName,
        input,
        mcpTool?.originalName ?? toolName,
        reviewContext?.cwd
      );
      if (reviewContext) {
        evaluation = await completePermissionReview(evaluation, {
          toolName: mcpTool?.originalName ?? toolName,
          toolDescription: mcpTool?.description,
          input,
          cwd: reviewContext.cwd,
          task: reviewContext.task,
          signal: permissionSignal,
          complete: (prompt, systemPrompt, reviewSignal) =>
            runPiAiOneShot(prompt, systemPrompt, reviewContext.config, {
              temperature: 0,
              maxTokens: 128,
              signal: reviewSignal,
            }),
        });
      }
      if (permissionSignal?.aborted) return { block: true, reason: 'Task cancelled.' };
      const { decision } = evaluation;
      const reviewReason = evaluation.source === 'auto_review' ? evaluation.reason : undefined;
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
          permission: reviewReason
            ? { decision: 'auto_review_ask', source: 'auto_review', reason: reviewReason }
            : undefined,
          timestamp: permissionStartedAt,
        });
        let result: 'allow' | 'deny' | 'allow_always';
        const resumeActivity = this.activeEventBridges.get(sessionId)?.pauseForPermission();
        try {
          // Send the display name to the renderer so the dialog shows a
          // human-readable tool name; canonical `toolName` is still used
          // for rule matching above and "always allow" memory below.
          result = await requestPermission(
            sessionId,
            toolUseId,
            displayName,
            input,
            permissionSignal
          );
        } catch (permErr) {
          const endedAt = Date.now();
          if (evaluationMetrics) {
            evaluationMetrics.permissionWaitMs += endedAt - permissionStartedAt;
          }
          const errorText = toErrorText(permErr);
          this.sendTraceUpdate(sessionId, permissionStepId, {
            status: 'error',
            title: `Permission request failed: ${displayName}`,
            permission: { decision: 'request_failed', source: 'system', reason: reviewReason },
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
        } finally {
          resumeActivity?.();
        }

        if (evaluationMetrics) {
          evaluationMetrics.permissionWaitMs += Date.now() - permissionStartedAt;
        }

        if (result === 'deny' || permissionSignal?.aborted) {
          const endedAt = Date.now();
          this.sendTraceUpdate(sessionId, permissionStepId, {
            status: 'error',
            title: `Permission denied: ${displayName}`,
            permission: { decision: 'user_deny', source: 'user', reason: reviewReason },
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
            reason: reviewReason,
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
          title:
            evaluation.source === 'auto_review'
              ? `Permission auto-reviewed: ${displayName}`
              : `Permission allowed by rule: ${displayName}`,
          toolName,
          toolInput: sanitizedInput,
          permission:
            evaluation.source === 'auto_review'
              ? { decision: 'auto_review_allow', source: 'auto_review', reason: reviewReason }
              : evaluation.source === 'remembered'
                ? { decision: 'allow_always', source: 'user', remembered: true }
                : { decision: 'rule_allow', source: 'rule' },
          timestamp: now,
          endedAt: now,
          duration: 0,
        });
      }

      return undefined;
    });

    log(`[AgentRunner] Permission hook installed on session ${sessionId} via agent.beforeToolCall`);
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
    const model = routeModel || configuredModel || 'anthropic/claude-sonnet-5';
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
  ): Promise<SessionTurnOutcome> {
    const runStartTime = Date.now();
    const turnId = options?.turnId ?? uuidv4();
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
      controller.signal.throwIfAborted();

      logCtx('[AgentRunner] Total messages:', existingMessages.length);

      const currentUser = existingMessages.at(-1);
      const images =
        currentUser?.role === 'user'
          ? currentUser.content.filter((block) => block.type === 'image').map(toPiImageContent)
          : [];
      if (images.length) {
        log('[AgentRunner] User message contains images');
      }

      logTiming('before pi-ai model resolution', runStartTime);

      // Resolve model via pi-ai
      const runtimeConfig = runtimeConfigOverride ?? configStore.getAll();
      const modelString = this.getCurrentModelString(runtimeConfig.model);
      const { piModel, provider, usedSyntheticModel, apiKey, capabilities } = await resolveRunModel(
        runtimeConfig,
        modelString
      );

      controller.signal.throwIfAborted();

      const supportsTools = capabilities?.includes('tools') ?? true;
      const supportsImages = piModel.input.includes('image');
      if (capabilities && images.length && !supportsImages) {
        throw new Error(harnessMessage('lmbpVisionRequired'));
      }

      // Send context window info to renderer for UI display
      this.sendToRenderer({
        type: 'session.contextInfo',
        payload: {
          sessionId: session.id,
          contextWindow: piModel.contextWindow || 128000,
        },
      });

      if (provider === 'openai-codex') {
        if (!(await ensureCodexCredentials())) {
          throw new Error(
            'OpenAI Codex（ChatGPT 订阅）未连接。请在 设置 → API 中选择 OpenAI Codex，连接本地 codex CLI 登录态或完成浏览器登录。'
          );
        }
        log('[AgentRunner] Using OAuth credentials for openai-codex');
      } else if (!apiKey) {
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
      const effectiveCwd =
        useSandboxIsolation && sandboxPath ? sandboxPath : workingDir || process.cwd();
      this.activePermissionContexts.set(session.id, {
        cwd: effectiveCwd,
        config: runtimeConfig,
        task: prompt,
      });

      const appAgentDir = this.skills.prepareRuntimeDirectory();
      log('[AgentRunner] App agent dir:', appAgentDir);
      log('[AgentRunner] User working directory:', workingDir);

      logTiming('before building conversation context', runStartTime);

      // pi-ai handles auth and model routing natively — no proxy, no env overrides needed.
      logCtx('[AgentRunner] Using pi-ai native routing for:', piModel.provider, piModel.id);

      // Resolve thinking level early — needed for session reuse check below
      const enableThinking =
        runtimeConfigOverride?.enableThinking ?? configStore.get('enableThinking') ?? false;
      const configuredThinkingLevel = resolveConfiguredThinkingLevel({
        enableThinking,
        thinkingLevel:
          runtimeConfigOverride?.thinkingLevel ?? configStore.get('thinkingLevel') ?? 'medium',
      });
      const thinkingLevel = resolveEffectiveThinkingLevel(piModel, configuredThinkingLevel);
      logCtx(
        '[AgentRunner] Enable thinking mode:',
        enableThinking,
        configuredThinkingLevel,
        '→',
        thinkingLevel
      );
      const sessionRuntimeSignature = buildPiSessionRuntimeSignature({
        modelCapabilities: capabilities,
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
      beginSkillUsageRun(session.id);
      for (const name of selectedSkillNames) recordSkillInvocation(name, session.id, 'selected');
      const skillPaths = await this.skills.resolveSkillPaths(session.id);
      const skillsSignature = JSON.stringify({
        paths: skillPaths,
        selected: selectedSkillNames,
      });
      log('[AgentRunner] Skill paths for pi ResourceLoader:', skillPaths);

      // Build contextual prompt — if reusing an existing SDK session, the SDK
      // already has conversation history so we only pass the new prompt.
      // A cold session starts with persisted conversation history within the model budget.
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

      // Mid-run tool activation: capabilities_search and future domain tools
      // call back through this to expose registered-but-hidden packs. Calls
      // made before the session resolves (none today — tools execute inside
      // the loop) are queued and applied right after resolution.
      const requestContext = cachedSession?.requestContext ?? new AgentRequestContext();
      const resultStore =
        cachedSession?.resultStore ??
        new ModelResultStore(
          new SessionResultRepository((this.database ?? getDatabase()).raw, session.id)
        );
      const runSessionRef: { current?: PiAgentSession } = {};
      const queuedToolActivations = new Set<string>();
      const activateToolsForRun = (toolNames: string[]): ToolActivationResult => {
        if (!supportsTools) return { activated: [], unknown: toolNames };
        const target = runSessionRef.current;
        if (!target) {
          toolNames.forEach((name) => queuedToolActivations.add(name));
          return { activated: [...toolNames], unknown: [] };
        }
        const registered = new Set(target.getAllTools().map((tool) => tool.name));
        const valid = toolNames.filter((name) => registered.has(name));
        if (valid.length > 0) {
          activateSessionTools(target, [...new Set([...target.getActiveToolNames(), ...valid])]);
          requestContext.setActiveTools(target.getActiveToolNames());
        }
        const active = new Set(target.getActiveToolNames());
        return {
          activated: toolNames.filter((name) => active.has(name)),
          unknown: toolNames.filter((name) => !active.has(name)),
        };
      };

      const extensionResult = this.extensionManager
        ? await this.extensionManager.beforeSessionRun({
            session,
            prompt,
            existingMessages,
            isColdStart: !cachedSession,
            isModelSwitch: Boolean(cachedSession && cachedSession.modelId !== piModel.id),
            runtimeConfig,
            signal: controller.signal,
            activateTools: activateToolsForRun,
          })
        : { customTools: [] };

      requestContext.update(extensionResult);
      let coldStartHistory: PiMessage[] = [];
      const restoredUserIds = new Map<PiMessage, string>();
      const historyMessages = existingMessages.slice(0, -1);
      const summaries = new HistorySummaryRepository(
        (this.database ?? getDatabase()).raw,
        session.id
      );
      if (!cachedSession) {
        if (historyMessages.length > 0) {
          // Content-aware chars-per-token estimation (CJK text uses ~1.5 chars/token vs ~4 for English)
          const contextWindow = piModel.contextWindow || 128000;
          const historyBudgetRatio = provider === 'ollama' && contextWindow < 16384 ? 0.15 : 0.3;
          const historyTokenBudget = Math.floor(contextWindow * historyBudgetRatio);

          const sampleText = historyMessages
            .slice(-3)
            .flatMap((message) => message.content.map(historyUserText))
            .join(' ');
          const charsPerToken = estimateCharsPerToken(sampleText);
          const historyCharBudget = Math.floor(historyTokenBudget * charsPerToken);
          coldStartHistory = buildColdStartAgentHistory(historyMessages, {
            api: piModel.api,
            provider: piModel.provider,
            model: piModel.id,
            maxChars: historyCharBudget,
            charsPerToken,
            supportsImages,
            summaries,
            restoredUserIds,
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

      const additionalProjectFolders = (session.mountedPaths ?? [])
        .map((entry) => entry.real?.trim())
        .filter((dir): dir is string => Boolean(dir) && dir !== workingDir);
      const additionalFoldersNote =
        additionalProjectFolders.length > 0
          ? `\nAdditional project source folders:\n${additionalProjectFolders.map((dir) => `- ${dir}`).join('\n')}`
          : '';
      const workspaceInfoPrompt =
        useSandboxIsolation && sandboxPath
          ? `<workspace_info>
Your current workspace is located at: ${VIRTUAL_WORKSPACE_PATH}
This is an isolated sandbox environment. Use ${VIRTUAL_WORKSPACE_PATH} as the root path for file operations.${additionalFoldersNote}
</workspace_info>`
          : workingDir
            ? `<workspace_info>Your current workspace is: ${workingDir}${additionalFoldersNote}</workspace_info>`
            : '';

      const coworkAppendPrompt = buildMainAgentSystemPrompt({
        workspaceInfo: workspaceInfoPrompt,
        bundledPathHints: this.skills.getBundledPathHints(),
      });

      logTiming('before agent session creation', runStartTime);

      // Create or reuse agent session
      // Bridge MCP tools as customTools for the agent SDK.
      // Re-read every query so newly added/removed MCP servers take effect immediately.
      let catalog = this.mcpManager?.getTools() ?? [];
      let mcpCustomTools = this.mcpManager ? buildMcpCustomTools(this.mcpManager) : [];
      let mcpToolPacks = this.mcpManager ? buildMcpToolPacks(this.mcpManager) : {};
      const extensionCustomTools = extensionResult.customTools || [];
      const getCapabilityPacks = (): Record<string, AgentToolPack> => ({
        ...mcpToolPacks,
        ...(extensionResult.toolPacks ?? {}),
        'results.read': {
          description:
            'Read complete stored tool results by resultRef, with text search and pagination',
          tools: [RESULT_READ_TOOL],
        },
      });
      const capabilitiesTool = createCapabilitiesSearchTool({
        getTools: () => [...mcpCustomTools, ...extensionCustomTools],
        refresh: () => refreshMcpCatalog(),
        getPacks: getCapabilityPacks,
        activateTools: activateToolsForRun,
      });
      // The model may call a registered-but-hidden tool it learned from prompts or
      // earlier results. Load it with its pack for the rest of the session instead
      // of failing with "Tool not found".
      requestContext.onMissingToolCalls = (toolNames) => {
        const { activated } = activateToolsForRun(
          expandToolsToPacks(toolNames, getCapabilityPacks())
        );
        if (activated.length === 0) return;
        requestContext.rememberStickyTools(activated);
        log(
          `[AgentRunner] Auto-activated tools called before exposure (${toolNames.join(', ')}):`,
          activated.join(', ')
        );
      };
      const buildCustomTools = () => [
        ...resultStore.wrap([...mcpCustomTools, ...extensionCustomTools, capabilitiesTool], () => {
          activateToolsForRun([RESULT_READ_TOOL]);
        }),
        resultStore.createReadTool(),
      ];
      const customTools = buildCustomTools();
      const refreshMcpCatalog = () => {
        const manager = this.mcpManager;
        const target = runSessionRef.current;
        if (!target || !manager) return false;
        const latest = manager.getTools();
        if (
          latest.length === catalog.length &&
          latest.every((tool, index) => tool === catalog[index])
        )
          return false;
        const active = target.getActiveToolNames();
        catalog = latest;
        mcpCustomTools = buildMcpCustomTools(manager);
        mcpToolPacks = buildMcpToolPacks(manager);
        replaceSessionToolRegistry(target, buildCustomTools());
        requestContext.setActiveTools(activateSessionTools(target, active));
        return true;
      };
      requestContext.beforeRequest = refreshMcpCatalog;
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
        const { DefaultResourceLoader } = await import('@earendil-works/pi-coding-agent');
        const resourceLoader = new DefaultResourceLoader({
          cwd: effectiveCwd,
          agentDir: getAgentDir(),
          additionalSkillPaths: skillPaths,
          appendSystemPrompt: coworkAppendPrompt ? [coworkAppendPrompt] : [],
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
          const userId = restoredUserIds.get(historyMessage);
          if (userId) piSessionManager.appendCustomEntry(APP_TURN_ENTRY, userId);
          piSessionManager.appendMessage(historyMessage);
        }

        const { session: newPiSession } = await createAgentSession({
          model: piModel,
          thinkingLevel,
          modelRuntime: await createSessionModelRuntime(piModel.provider, apiKey),
          customTools,
          sessionManager: piSessionManager,
          settingsManager: PiSettingsManager.inMemory({
            compaction: compactionSettings,
            retry: { ...AGENT_TURN_RETRY_SETTINGS },
          }),
          resourceLoader,
          cwd: effectiveCwd,
        });
        installBaseTools(newPiSession, wrappedTools);
        piSession = newPiSession;
        requestContext.install(piSession.agent);

        if (coldStartHistory.length > 0) {
          log(
            '[AgentRunner] Seeded structured cold-start history into SDK session:',
            coldStartHistory.length,
            'messages'
          );
        }

        // Install the permission gate before the SDK's tool-call hook.
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
          requestContext,
          resultStore,
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

      runSessionRef.current = piSession;
      // SDK sessions capture customTools at creation — sync the registry on
      // warm starts so tools connected after the first turn (new MCP servers,
      // rebuilt extension defs) actually register.
      if (cachedSession) {
        replaceSessionToolRegistry(piSession, customTools);
      }
      // Registration != exposure: only this turn's activated subset is
      // serialized for the model. Extension packs and MCP tools stay
      // registered and can be pulled in mid-run via capabilities_search;
      // mid-run discovery applies only to this run.
      const extensionCatalogNames = new Set(extensionCustomTools.map((tool) => tool.name));
      const mcpCatalogNames = new Set(mcpCustomTools.map((tool) => tool.name));
      const allowedExtensionTools = new Set(
        extensionResult.activateTools ?? [...extensionCatalogNames]
      );
      const hiddenCatalogs = new Set([
        ...extensionCatalogNames,
        ...mcpCatalogNames,
        RESULT_READ_TOOL,
      ]);
      if (/resultRef|tool_result_read|result_[a-f0-9-]+/i.test(prompt))
        allowedExtensionTools.add(RESULT_READ_TOOL);
      const registeredNames = new Set(piSession.getAllTools().map((tool) => tool.name));
      const nextActiveTools = supportsTools
        ? selectActiveToolsForTurn(
            piSession.getActiveToolNames(),
            registeredNames,
            hiddenCatalogs,
            [...allowedExtensionTools, ...queuedToolActivations, ...requestContext.getStickyTools()]
          )
        : [];
      queuedToolActivations.clear();
      activateSessionTools(piSession, nextActiveTools);
      requestContext.setActiveTools(nextActiveTools);
      log(
        `[AgentRunner] Active tools this turn (${nextActiveTools.length}):`,
        nextActiveTools.join(', ')
      );

      evaluationMetrics.provider = piModel.provider || provider;
      evaluationMetrics.model = piModel.id;

      // Set up event handler to bridge agent SDK events → our ServerEvent protocol
      const eventBridge = new AgentRunEventBridge({
        sessionExists: this.sessionExists,
        saveCompactedHistory: (result) =>
          summaries.saveCompaction(existingMessages, piSession.sessionManager.getBranch(), result),
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
      this.activeEventBridges.set(session.id, eventBridge);
      const unbindCancellation = bindAgentRunCancellation(piSession, controller.signal);

      // Execute the prompt — unsubscribe in finally to prevent event listener leak
      try {
        controller.signal.throwIfAborted();
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
        if (currentUser?.role === 'user')
          piSession.sessionManager.appendCustomEntry(APP_TURN_ENTRY, currentUser.id);
        const promptResult = await piSession.prompt(prompt, { images });
        controller.signal.throwIfAborted();
        // Backstop: surface a held-back attempt error if no agent_end flushed it.
        eventBridge.flushPendingError();
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
          controller.signal.throwIfAborted();
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
            piSession.agent.state.messages = [
              ...piSession.agent.state.messages,
              protocolErrorMessage,
            ];
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
        unbindCancellation();
        this.activeEventBridges.delete(session.id);
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
        return { status: 'timed_out' };
      }
      // If the SDK swallowed the AbortError after a loop-guard abort, preserve
      // the 'error' trace status that eventBridge.handleLoopGuardDecision already published.
      // The user-facing message and trace step are already set; do not overwrite
      // them with the default "Task completed" below.
      if (controller.signal.aborted && abortedByLoopGuard) {
        logCtx('[AgentRunner] Aborted by loop guard (detected after prompt returned)');
        return { status: 'failed', error: harnessMessage('loopGuard') };
      }
      controller.signal.throwIfAborted();
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
      return eventBridge.terminalErrorText
        ? { status: 'failed', error: eventBridge.terminalErrorText }
        : { status: 'succeeded' };
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
          return { status: 'timed_out' };
        } else if (abortedByLoopGuard) {
          // Loop guard already published the user-facing assistant message and
          // an 'error' trace step with the loop-detected title. Do NOT overwrite
          // them here with a 'completed/Cancelled' state.
          logCtx('[AgentRunner] Aborted by loop guard');
          return { status: 'failed', error: harnessMessage('loopGuard') };
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
          return { status: 'cancelled' };
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

        return { status: 'failed', error: errorText };
      }
    } finally {
      this.activeControllers.delete(session.id);
      this.activePermissionContexts.delete(session.id);
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
          const failure = await syncRunWorkspaceToHost(session.id);
          if (failure) recordSandboxSyncFailure(failure);
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
