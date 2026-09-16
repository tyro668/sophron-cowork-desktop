/**
 * AgentRunEventBridge — bridges sophron agent SDK session events into the
 * application's ServerEvent protocol during a single ClaudeAgentRunner.run()
 * turn.
 *
 * Extracted from agent-runner.ts: the bridge owns all per-turn streaming state
 * (streamed text, think-tag parser, pseudo-tool-call guard, loop guard, stream
 * metrics, activity/cold-start timers, compaction step) and the subscribe()
 * callback. Runner-visible outcomes are exposed as public fields/methods; the
 * runner's services are injected through AgentRunBridgeDeps.
 */
import { v4 as uuidv4 } from 'uuid';
import type {
  AgentSession as PiAgentSession,
  AgentSessionEvent,
} from '@mariozechner/pi-coding-agent';
import type { Model, Api } from '@mariozechner/pi-ai';
import type {
  Session,
  Message,
  TraceStep,
  ServerEvent,
  ContentBlock,
  AgentRuntimeConfig,
  TraceEvaluationMetrics,
} from '../../shared/contracts';
import { log, logWarn, logError, logCtx, logCtxError } from '../utils/logger';
import { extractArtifactsFromText, buildArtifactTraceSteps } from '../utils/artifact-parser';
import { resolveMessageEndPayload, toUserFacingErrorText } from './agent-runner-message-end';
import { ThinkTagStreamParser } from './think-tag-parser';
import { containsPseudoToolCallMarkup, PseudoToolCallStreamGuard } from './agent-protocol-safety';
import {
  LoopGuard,
  buildAbortUserMessage,
  buildHaltSteerMessage,
  buildWarnSteerMessage,
  type LoopGuardDecision,
  type ToolCallDescriptor,
} from './agent-runner-loop-guard';
import { normalizeToolExecutionResultForUi } from './tool-result-utils';
import {
  buildTraceError,
  buildTraceOutputPreview,
  normalizeTraceUsage,
  sanitizeTraceInput,
} from './trace-utils';
import {
  safeStringify,
  summarizeMessageForLog,
  toErrorText,
  normalizeTokenUsage,
} from './agent-runner-log-utils';

export interface AgentRunBridgeDeps {
  session: Session;
  piSession: PiAgentSession;
  controller: AbortController;
  thinkingStepId: string;
  turnId: string;
  runStartTime: number;
  provider: string;
  piModel: Model<Api>;
  runtimeConfig: AgentRuntimeConfig;
  evaluationMetrics: TraceEvaluationMetrics;
  snapshotEvaluationMetrics: () => TraceEvaluationMetrics;
  sendToRenderer: (event: ServerEvent) => void;
  sendMessage: (sessionId: string, message: Message) => void;
  sendPartial: (sessionId: string, delta: string) => void;
  sendTraceStep: (sessionId: string, step: TraceStep) => void;
  sendTraceUpdate: (sessionId: string, stepId: string, updates: Partial<TraceStep>) => void;
  getToolDisplayName: (toolName: string) => string;
  toolStartedAt: Map<string, number>;
  modelClock: { startedAt?: number };
  sanitizeOutputPaths: (content: string) => string;
  seenToolCallIds: Set<string>;
  usedSyntheticModel: boolean;
  onLoopGuardAbort: () => void;
  onTimeoutAbort: () => void;
}

export class AgentRunEventBridge {
  // Accumulate streamed text deltas in case message_end.content is empty (pi SDK streaming behaviour)
  streamedText = '';
  compactionStepId: string | undefined;
  compactionStartedAt: number | undefined;
  hasEmittedError = false;
  terminalErrorText: string | undefined;
  terminalProtocolViolation = false;
  thinkParser = new ThinkTagStreamParser();
  protocolGuard = new PseudoToolCallStreamGuard();
  currentMessageProtocolViolation = false;
  retryableProtocolViolation = false;
  attemptToolCallIds = new Set<string>();
  promptStartedAt = Date.now();
  streamEventCounts = new Map<string, number>();
  loopGuard = new LoopGuard();
  ollamaColdStartTimerId: ReturnType<typeof setTimeout> | undefined;
  receivedFirstStreamEvent = false;
  firstStreamEventAt: number | undefined;
  toolCallCount = 0;
  toolErrorCount = 0;

  // ── Loop guard: protect against runaway tool-call loops ──
  // (e.g. gemini-3.1-pro with thinking=off has been observed producing hundreds
  //  of empty-text + single-tool-call responses in a single turn)
  // Two layers: hash of whole tool-call group (window=20, warn=3/halt=5/abort=8)
  //             + per-tool frequency (warn=30/halt=50/abort=80).

  constructor(private readonly ctx: AgentRunBridgeDeps) {
    if (this.ctx.provider === 'ollama') {
      this.ollamaColdStartTimerId = setTimeout(() => {
        if (!this.receivedFirstStreamEvent && !this.ctx.controller.signal.aborted) {
          this.ctx.sendTraceUpdate(this.ctx.session.id, this.ctx.thinkingStepId, {
            title: 'Waiting for model to load into memory...',
          });
        }
      }, 10000);
    }
  }

  handleLoopGuardDecision = (decision: LoopGuardDecision, context: string): void => {
    if (decision.action === 'none' || this.ctx.controller.signal.aborted) return;
    logWarn(`[LoopGuard] ${context}: action=${decision.action} reason=${decision.reason}`);

    if (decision.action === 'hash_abort' || decision.action === 'freq_abort') {
      // Always surface the loop-guard explanation, even if an earlier
      // error already set this.hasEmittedError — the user must see why the
      // this.ctx.session stopped. Mark the flag afterward to suppress duplicate
      // generic-error chatter from later paths in this turn.
      this.ctx.sendMessage(this.ctx.session.id, {
        id: uuidv4(),
        sessionId: this.ctx.session.id,
        role: 'assistant',
        content: [{ type: 'text', text: buildAbortUserMessage(decision) }],
        timestamp: Date.now(),
      });
      this.hasEmittedError = true;
      this.ctx.sendTraceUpdate(this.ctx.session.id, this.ctx.thinkingStepId, {
        status: 'error',
        title: 'Stopped: tool-call loop detected',
        error: buildTraceError(decision.reason, 'loop_guard'),
        outcome: 'loop_guard_stopped',
        isError: true,
        metrics: this.ctx.snapshotEvaluationMetrics(),
        endedAt: Date.now(),
        duration: Date.now() - this.ctx.runStartTime,
      });
      try {
        // Mark BEFORE calling abort() so the AbortError handler in the
        // outer catch can distinguish a loop-guard abort from a user
        // cancel and skip the "Cancelled" trace overwrite.
        this.ctx.onLoopGuardAbort();
        this.ctx.controller.abort();
      } catch (abortErr) {
        logWarn('[LoopGuard] abort error:', abortErr);
      }
      return;
    }

    const steerText =
      decision.action === 'hash_halt' || decision.action === 'freq_halt'
        ? buildHaltSteerMessage(decision)
        : buildWarnSteerMessage(decision);
    // fire-and-forget: SDK queues the steering message for the next turn
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sessionAny = this.ctx.piSession as any;
      if (typeof sessionAny.sendUserMessage === 'function') {
        Promise.resolve(sessionAny.sendUserMessage(steerText, { deliverAs: 'steer' })).catch(
          (err: unknown) => {
            logWarn('[LoopGuard] sendUserMessage(steer) failed:', err);
          }
        );
      } else {
        logWarn('[LoopGuard] this.ctx.piSession.sendUserMessage is not available; skipping steer');
      }
    } catch (steerErr) {
      logWarn('[LoopGuard] sendUserMessage(steer) threw:', steerErr);
    }
  };

  markFirstStreamEvent = (eventType: string) => {
    if (
      this.ctx.evaluationMetrics.firstTokenLatencyMs === undefined &&
      (eventType === 'text_delta' || eventType === 'thinking_delta')
    ) {
      this.ctx.evaluationMetrics.firstTokenLatencyMs = Date.now() - this.promptStartedAt;
    }
    if (this.receivedFirstStreamEvent) {
      return;
    }
    this.receivedFirstStreamEvent = true;
    this.firstStreamEventAt = Date.now();
    this.ctx.evaluationMetrics.firstResponseLatencyMs =
      this.firstStreamEventAt - this.promptStartedAt;
    if (this.ollamaColdStartTimerId) {
      clearTimeout(this.ollamaColdStartTimerId);
    }
    this.ctx.sendTraceUpdate(this.ctx.session.id, this.ctx.thinkingStepId, {
      title: 'Processing request...',
    });
    if (this.ctx.provider === 'ollama') {
      log(
        '[ClaudeAgentRunner] Ollama first stream event received',
        safeStringify({
          sessionId: this.ctx.session.id,
          eventType,
          modelId: this.ctx.piModel.id,
          modelProvider: this.ctx.piModel.provider,
          baseUrl: this.ctx.piModel.baseUrl || this.ctx.runtimeConfig.baseUrl || '',
          latencyMs: this.firstStreamEventAt - this.promptStartedAt,
        })
      );
    }
  };

  // Activity-based timeout: reset the 5-min timer whenever the SDK sends events
  PROMPT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
  activityTimeoutId: ReturnType<typeof setTimeout> | undefined;
  resetActivityTimeout = () => {
    if (this.activityTimeoutId) clearTimeout(this.activityTimeoutId);
    this.activityTimeoutId = setTimeout(() => {
      logWarn('[ClaudeAgentRunner] Prompt timed out (no activity for 5 min), aborting');
      this.ctx.onTimeoutAbort();
      this.ctx.controller.abort();
    }, this.PROMPT_TIMEOUT_MS);
  };

  recordStreamEvent = (eventType: string) => {
    this.streamEventCounts.set(eventType, (this.streamEventCounts.get(eventType) ?? 0) + 1);
  };

  getStreamEventSummary = () =>
    Object.fromEntries(
      Array.from(this.streamEventCounts.entries()).sort(([left], [right]) =>
        left.localeCompare(right)
      )
    );

  markProtocolViolation = (source: 'stream' | 'message_end'): void => {
    if (!this.currentMessageProtocolViolation) {
      logWarn('[ClaudeAgentRunner] Blocked pseudo tool-call markup from assistant text:', source);
    }
    this.currentMessageProtocolViolation = true;
    this.ctx.sendToRenderer({
      type: 'stream.reset',
      payload: { sessionId: this.ctx.session.id },
    });
  };

  subscribe(): () => void {
    return this.ctx.piSession.subscribe(this.handleEvent);
  }

  private handleEvent = (event: AgentSessionEvent): void => {
    try {
      if (this.ctx.controller.signal.aborted) return;

      // Reset activity timeout on meaningful events
      this.resetActivityTimeout();

      if (event.type === 'message_update') {
        const updateType = event.assistantMessageEvent.type;
        this.recordStreamEvent(updateType);
        if (updateType !== 'text_delta' && updateType !== 'thinking_delta') {
          log(`[ClaudeAgentRunner] Event: ${event.type} → ${updateType}`);
        }
      } else if (event.type === 'message_start') {
        if ((event.message as { role?: string }).role === 'assistant') {
          this.streamedText = '';
          this.thinkParser = new ThinkTagStreamParser();
          this.protocolGuard.reset();
          this.currentMessageProtocolViolation = false;
          this.ctx.modelClock.startedAt = Date.now();
          this.ctx.evaluationMetrics.modelCallCount += 1;
        }
        log(
          '[ClaudeAgentRunner] Event: message_start',
          safeStringify(summarizeMessageForLog(event.message), 2)
        );
      } else if (event.type === 'message_end') {
        const modelCallEndedAt = Date.now();
        const isAssistantMessage = (event.message as { role?: string }).role === 'assistant';
        const usage = normalizeTraceUsage((event.message as { usage?: unknown }).usage);
        if (isAssistantMessage) {
          if (this.ctx.modelClock.startedAt) {
            this.ctx.evaluationMetrics.modelDurationMs +=
              modelCallEndedAt - this.ctx.modelClock.startedAt;
          } else {
            this.ctx.evaluationMetrics.modelCallCount += 1;
          }
          this.ctx.modelClock.startedAt = undefined;
          if (usage) {
            this.ctx.evaluationMetrics.inputTokens += usage.inputTokens;
            this.ctx.evaluationMetrics.outputTokens += usage.outputTokens;
            this.ctx.evaluationMetrics.cacheReadTokens += usage.cacheReadTokens;
            this.ctx.evaluationMetrics.cacheWriteTokens += usage.cacheWriteTokens;
            this.ctx.evaluationMetrics.totalTokens += usage.totalTokens;
            this.ctx.evaluationMetrics.costTotal += usage.costTotal;
          }
        }
        log(
          '[ClaudeAgentRunner] Event: message_end',
          safeStringify(
            {
              message: summarizeMessageForLog(event.message),
              messageUpdateCounts: this.getStreamEventSummary(),
            },
            2
          )
        );
      } else if (event.type === 'turn_end') {
        log(`[ClaudeAgentRunner] Event: ${event.type}`);
      } else {
        log(`[ClaudeAgentRunner] Event: ${event.type}`);
      }

      switch (event.type) {
        case 'message_update': {
          if (this.ctx.controller.signal.aborted) break;
          const ame = event.assistantMessageEvent;
          if (ame.type === 'text_delta') {
            this.markFirstStreamEvent(ame.type);
            const parsed = this.thinkParser.push(ame.delta);
            if (parsed.thinking) {
              this.ctx.sendToRenderer({
                type: 'stream.thinking',
                payload: { sessionId: this.ctx.session.id, delta: parsed.thinking },
              });
            }
            if (parsed.text) {
              const guarded = this.protocolGuard.push(parsed.text);
              if (guarded.violated) this.markProtocolViolation('stream');
              if (guarded.text && !this.currentMessageProtocolViolation) {
                this.streamedText += guarded.text;
                this.ctx.sendPartial(this.ctx.session.id, guarded.text);
              }
            }
          } else if (ame.type === 'thinking_delta') {
            this.markFirstStreamEvent(ame.type);
            // Forward thinking delta to renderer for real-time display
            this.ctx.sendToRenderer({
              type: 'stream.thinking',
              payload: { sessionId: this.ctx.session.id, delta: ame.delta },
            });
          } else if (ame.type === 'toolcall_start') {
            this.markFirstStreamEvent(ame.type);
            const partial = ame.partial;
            const toolContent = partial?.content?.[ame.contentIndex];
            const toolName = toolContent?.type === 'toolCall' ? toolContent.name : 'unknown';
            const toolCallId = toolContent?.type === 'toolCall' ? toolContent.id : uuidv4();
            const toolDisplayName = this.ctx.getToolDisplayName(toolName);
            if (!this.ctx.seenToolCallIds.has(toolCallId)) {
              this.ctx.seenToolCallIds.add(toolCallId);
              this.toolCallCount += 1;
              this.ctx.evaluationMetrics.toolCallCount += 1;
            }
            this.attemptToolCallIds.add(toolCallId);
            this.ctx.sendTraceStep(this.ctx.session.id, {
              id: toolCallId,
              turnId: this.ctx.turnId,
              parentId: this.ctx.thinkingStepId,
              type: 'tool_call',
              status: 'running',
              title: toolDisplayName,
              toolName,
              toolInput:
                toolContent?.type === 'toolCall'
                  ? sanitizeTraceInput(toolContent.arguments || {})
                  : undefined,
              timestamp: Date.now(),
            });
          } else if (ame.type === 'done') {
            // Some providers emit 'done' via message_update — we handle it
            // in message_end below as a unified path for all providers.
            log('[ClaudeAgentRunner] message_update done event (handled in message_end)');
          } else if (ame.type === 'error') {
            const errorDetail = JSON.stringify(ame.error?.content || 'no content');
            logCtxError('[ClaudeAgentRunner] pi-ai stream error:', ame.reason, errorDetail);
          }
          break;
        }

        case 'message_end': {
          // Unified handler: send the final assistant message to the renderer.
          // Works for all providers (some emit 'done' via message_update, others don't).
          if (this.ctx.controller.signal.aborted) break;

          // Flush any buffered content from the think-tag parser
          const flushed = this.thinkParser.flush();
          if (flushed.thinking) {
            this.ctx.sendToRenderer({
              type: 'stream.thinking',
              payload: { sessionId: this.ctx.session.id, delta: flushed.thinking },
            });
          }
          if (flushed.text) {
            const guarded = this.protocolGuard.push(flushed.text);
            if (guarded.violated) this.markProtocolViolation('stream');
            if (guarded.text && !this.currentMessageProtocolViolation) {
              this.streamedText += guarded.text;
              this.ctx.sendPartial(this.ctx.session.id, guarded.text);
            }
          }
          const guardFlush = this.protocolGuard.flush();
          if (guardFlush.violated) this.markProtocolViolation('stream');
          if (guardFlush.text && !this.currentMessageProtocolViolation) {
            this.streamedText += guardFlush.text;
            this.ctx.sendPartial(this.ctx.session.id, guardFlush.text);
          }

          const msg = event.message;
          if (process.env.COWORK_LOG_SDK_MESSAGES_FULL === '1') {
            log('[ClaudeAgentRunner] message_end raw message:', safeStringify(msg, 2));
          }
          const resolvedPayload = resolveMessageEndPayload({
            message: msg as Parameters<typeof resolveMessageEndPayload>[0]['message'],
            streamedText: this.streamedText,
          });
          const hasStructuredToolCall = resolvedPayload.effectiveContent.some(
            (block) => block.type === 'toolCall'
          );
          const hasPseudoMarkup = resolvedPayload.effectiveContent.some(
            (block) => block.type === 'text' && containsPseudoToolCallMarkup(block.text)
          );
          if (hasPseudoMarkup) {
            this.markProtocolViolation('message_end');
            // A this.ctx.provider may emit both a valid structured call and an invalid
            // textual imitation. Keep only the structured blocks so tools still
            // pass through the normal validation and permission path.
            resolvedPayload.effectiveContent = resolvedPayload.effectiveContent.filter(
              (block) => block.type !== 'text' || !containsPseudoToolCallMarkup(block.text)
            );
            if (msg?.role === 'assistant') {
              msg.content = resolvedPayload.effectiveContent;
            }
          }
          this.streamedText = resolvedPayload.nextStreamedText;
          if (this.ctx.provider === 'ollama') {
            log(
              '[ClaudeAgentRunner] Ollama message_end diagnostics',
              safeStringify({
                sessionId: this.ctx.session.id,
                modelId: this.ctx.piModel.id,
                modelProvider: this.ctx.piModel.provider,
                usedSyntheticModel: this.ctx.usedSyntheticModel,
                receivedFirstStreamEvent: this.receivedFirstStreamEvent,
                firstStreamLatencyMs: this.firstStreamEventAt
                  ? this.firstStreamEventAt - this.promptStartedAt
                  : null,
                stopReason: (msg as { stopReason?: unknown })?.stopReason ?? null,
                contentBlocks: Array.isArray((msg as { content?: unknown[] })?.content)
                  ? ((msg as { content?: unknown[] }).content?.length ?? 0)
                  : 0,
                emittedError: Boolean(resolvedPayload.errorText),
              })
            );
          }
          if (resolvedPayload.errorText) {
            this.terminalErrorText = resolvedPayload.errorText;
            if (!this.hasEmittedError) {
              this.hasEmittedError = true;
              this.ctx.sendMessage(this.ctx.session.id, {
                id: uuidv4(),
                sessionId: this.ctx.session.id,
                role: 'assistant',
                content: [
                  {
                    type: 'text',
                    text: `**Error**: ${resolvedPayload.errorText}\n\n${
                      /\b4\d{2}\b/.test(resolvedPayload.errorText)
                        ? '_请检查配置后重试。_'
                        : '_Agent 正在自动重试，请稍候..._'
                    }`,
                  },
                ],
                timestamp: Date.now(),
              });
            }
            break;
          }
          if (this.currentMessageProtocolViolation && !hasStructuredToolCall) {
            // Do not persist or render the malformed assistant response. The
            // prompt loop below removes it from SDK history and retries once.
            this.retryableProtocolViolation = true;
            break;
          }
          if (resolvedPayload.shouldEmitMessage) {
            const contentBlocks: ContentBlock[] = [];
            for (const block of resolvedPayload.effectiveContent) {
              if (block.type === 'text') {
                const { cleanText, artifacts } = extractArtifactsFromText(block.text);
                if (cleanText) {
                  contentBlocks.push({
                    type: 'text',
                    text: this.ctx.sanitizeOutputPaths(cleanText),
                  });
                }
                if (artifacts.length > 0) {
                  for (const step of buildArtifactTraceSteps(artifacts)) {
                    this.ctx.sendTraceStep(this.ctx.session.id, {
                      ...step,
                      turnId: this.ctx.turnId,
                      parentId: this.ctx.thinkingStepId,
                    });
                  }
                }
              } else if (block.type === 'toolCall') {
                const displayName = this.ctx.getToolDisplayName(block.name);
                contentBlocks.push({
                  type: 'tool_use',
                  id: block.id,
                  name: block.name,
                  displayName,
                  input: block.arguments,
                });
              } else if (block.type === 'thinking') {
                // Include thinking blocks in the final message for UI display
                contentBlocks.push({
                  type: 'thinking',
                  thinking: block.thinking,
                });
              } else {
                // Unknown block type — pass through as text so content isn't silently lost
                const unknownBlock = block as { type?: string; text?: string };
                log(`[ClaudeAgentRunner] Unknown content block type: ${unknownBlock.type}`);
                const text = unknownBlock.text || JSON.stringify(block);
                if (text) contentBlocks.push({ type: 'text', text });
              }
            }
            // Always clear partial text; send message even if only artifacts were extracted
            this.ctx.sendToRenderer({
              type: 'stream.partial',
              payload: { sessionId: this.ctx.session.id, delta: '' },
            });

            // ── Loop guard layer 1: hash of this message's tool-call group ──
            const toolUseDescriptors: ToolCallDescriptor[] = [];
            for (const block of resolvedPayload.effectiveContent) {
              if (block.type === 'toolCall') {
                toolUseDescriptors.push({
                  name: block.name || '',
                  input: (block.arguments as Record<string, unknown>) || undefined,
                });
              }
            }
            if (toolUseDescriptors.length > 0) {
              this.handleLoopGuardDecision(
                this.loopGuard.recordAssistantMessage(toolUseDescriptors),
                'message_end'
              );
              if (this.ctx.controller.signal.aborted) break;
            }

            if (contentBlocks.length > 0) {
              const msgWithUsage = msg as { usage?: unknown };
              const tokenUsage = normalizeTokenUsage(msgWithUsage.usage);
              if (msgWithUsage.usage) {
                log(
                  '[ClaudeAgentRunner] normalized usage:',
                  safeStringify(
                    {
                      raw: msgWithUsage.usage,
                      normalized: tokenUsage,
                    },
                    2
                  )
                );
              }
              const assistantMsg: Message = {
                id: uuidv4(),
                sessionId: this.ctx.session.id,
                role: 'assistant',
                content: contentBlocks,
                timestamp: Date.now(),
                api: this.ctx.piModel.api,
                provider: this.ctx.piModel.provider,
                model: this.ctx.piModel.id,
                tokenUsage,
              };
              this.ctx.sendMessage(this.ctx.session.id, assistantMsg);
            }
          }
          break;
        }

        case 'tool_execution_start': {
          logCtx(`[ClaudeAgentRunner] Tool execution start: ${event.toolName}`);
          const toolCallId = event.toolCallId;
          const startedAt = Date.now();
          this.ctx.toolStartedAt.set(`${this.ctx.session.id}:${toolCallId}`, startedAt);
          if (!this.ctx.seenToolCallIds.has(toolCallId)) {
            this.ctx.seenToolCallIds.add(toolCallId);
            this.toolCallCount += 1;
            this.ctx.evaluationMetrics.toolCallCount += 1;
          }
          this.attemptToolCallIds.add(toolCallId);
          this.ctx.sendTraceUpdate(this.ctx.session.id, toolCallId, {
            turnId: this.ctx.turnId,
            parentId: this.ctx.thinkingStepId,
            type: 'tool_call',
            status: 'running',
            title: this.ctx.getToolDisplayName(event.toolName),
            toolName: event.toolName,
            toolInput: sanitizeTraceInput(event.args),
          });
          // ── Loop guard layer 2: per-tool cumulative frequency ──
          this.handleLoopGuardDecision(
            this.loopGuard.recordToolInvocation(event.toolName),
            'tool_execution_start'
          );
          break;
        }

        case 'tool_execution_end': {
          if (this.ctx.controller.signal.aborted) break;
          const toolCallId = event.toolCallId;
          const isError = event.isError;
          const normalizedToolResult = normalizeToolExecutionResultForUi(event.result);
          const outputText = this.ctx.sanitizeOutputPaths(normalizedToolResult.content);
          const toolDisplayName = this.ctx.getToolDisplayName(event.toolName);
          const endedAt = Date.now();
          const startedAt =
            this.ctx.toolStartedAt.get(`${this.ctx.session.id}:${toolCallId}`) ?? endedAt;
          this.ctx.toolStartedAt.delete(`${this.ctx.session.id}:${toolCallId}`);
          const outputPreview = buildTraceOutputPreview(outputText);
          const resultMessageId = uuidv4();
          const toolDurationMs = endedAt - startedAt;
          this.ctx.evaluationMetrics.toolDurationMs += toolDurationMs;
          if (isError) {
            this.toolErrorCount += 1;
            this.ctx.evaluationMetrics.toolErrorCount += 1;
          }
          this.ctx.sendTraceUpdate(this.ctx.session.id, toolCallId, {
            turnId: this.ctx.turnId,
            parentId: this.ctx.thinkingStepId,
            status: isError ? 'error' : 'completed',
            title: toolDisplayName,
            toolName: event.toolName,
            toolOutput: outputPreview.preview,
            toolOutputLength: outputPreview.length,
            toolOutputTruncated: outputPreview.truncated,
            resultMessageId,
            isError,
            error: isError ? buildTraceError(outputText) : undefined,
            outcome: isError ? 'tool_failed' : 'tool_completed',
            endedAt,
            duration: toolDurationMs,
          });

          // Send tool result message
          const toolResultMsg: Message = {
            id: resultMessageId,
            sessionId: this.ctx.session.id,
            role: 'assistant',
            content: [
              {
                type: 'tool_result',
                toolUseId: toolCallId,
                content: outputText,
                isError,
                ...(normalizedToolResult.images.length > 0
                  ? { images: normalizedToolResult.images }
                  : {}),
              },
            ],
            timestamp: Date.now(),
          };
          this.ctx.sendMessage(this.ctx.session.id, toolResultMsg);
          break;
        }

        case 'agent_end': {
          logCtx('[ClaudeAgentRunner] Agent finished');
          break;
        }

        case 'auto_compaction_start': {
          log('[ClaudeAgentRunner] Auto-compaction started, reason:', event.reason);
          this.compactionStepId = `compaction-${Date.now()}`;
          this.compactionStartedAt = Date.now();
          this.ctx.sendTraceStep(this.ctx.session.id, {
            id: this.compactionStepId,
            turnId: this.ctx.turnId,
            parentId: this.ctx.thinkingStepId,
            type: 'thinking',
            status: 'running',
            title: `Compacting context (${event.reason})...`,
            timestamp: this.compactionStartedAt,
          });
          break;
        }

        case 'auto_compaction_end': {
          const status = event.aborted ? 'error' : event.errorMessage ? 'error' : 'completed';
          const title = event.aborted
            ? 'Context compaction aborted'
            : event.errorMessage
              ? `Context compaction failed: ${event.errorMessage}`
              : 'Context compaction completed';
          log('[ClaudeAgentRunner] Auto-compaction ended:', title, 'willRetry:', event.willRetry);
          if (this.compactionStepId) {
            const endedAt = Date.now();
            this.ctx.sendTraceUpdate(this.ctx.session.id, this.compactionStepId, {
              status,
              title,
              isError: status === 'error',
              error:
                status === 'error'
                  ? buildTraceError(event.errorMessage || title, 'provider')
                  : undefined,
              endedAt,
              duration: this.compactionStartedAt ? endedAt - this.compactionStartedAt : undefined,
            });
            this.compactionStepId = undefined;
            this.compactionStartedAt = undefined;
          } else {
            // Fallback: no matching start event, send as new step
            this.ctx.sendTraceStep(this.ctx.session.id, {
              id: `compaction-end-${Date.now()}`,
              turnId: this.ctx.turnId,
              parentId: this.ctx.thinkingStepId,
              type: 'thinking',
              status,
              title,
              timestamp: Date.now(),
            });
          }
          break;
        }
      }
    } catch (subscribeErr) {
      logError('[ClaudeAgentRunner] Error in subscribe callback:', subscribeErr);
      if (this.compactionStepId) {
        this.ctx.sendTraceUpdate(this.ctx.session.id, this.compactionStepId, {
          status: 'error',
          title: 'Error during context compaction',
        });
        this.compactionStepId = undefined;
      }
      if (!this.hasEmittedError) {
        this.hasEmittedError = true;
        const errorText = toUserFacingErrorText(toErrorText(subscribeErr));
        this.ctx.sendMessage(this.ctx.session.id, {
          id: uuidv4(),
          sessionId: this.ctx.session.id,
          role: 'assistant',
          content: [{ type: 'text', text: `**Error**: ${errorText}` }],
          timestamp: Date.now(),
        });
      }
    }
  };

  discardLastMalformedAssistant = (): void => {
    const messages = [...this.ctx.piSession.agent.state.messages];
    if (messages[messages.length - 1]?.role === 'assistant') {
      messages.pop();
      this.ctx.piSession.agent.replaceMessages(messages);

      const leafId = this.ctx.piSession.sessionManager.getLeafId();
      const leafEntry = leafId ? this.ctx.piSession.sessionManager.getEntry(leafId) : undefined;
      if (leafEntry?.type === 'message' && leafEntry.message.role === 'assistant') {
        if (leafEntry.parentId) {
          this.ctx.piSession.sessionManager.branch(leafEntry.parentId);
        } else {
          this.ctx.piSession.sessionManager.resetLeaf();
        }
      }
    }
  };

  resetProtocolRetryState = (): void => {
    this.streamedText = '';
    this.thinkParser = new ThinkTagStreamParser();
    this.protocolGuard.reset();
    this.currentMessageProtocolViolation = false;
    this.retryableProtocolViolation = false;
    this.attemptToolCallIds = new Set<string>();
  };
}
