import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import type { TSchema } from '@sinclair/typebox';
import type { AgentRuntimeConfig, Message, Session } from '../../shared/contracts';

export type AgentRuntimeCustomTool = ToolDefinition<TSchema, unknown>;

/**
 * A named, discoverable bundle of related tools. Packs stay registered in the
 * session catalog but are only exposed to the model when activated — either by
 * the extension's per-turn `activateTools` decision or on demand through the
 * `capabilities_search` tool.
 */
export interface AgentToolPack {
  /** One-line purpose surfaced by the discovery tool. */
  description: string;
  tools: string[];
}

export interface ToolActivationResult {
  activated: string[];
  unknown: string[];
}

export interface BeforeSessionRunContext {
  session: Session;
  prompt: string;
  existingMessages: Message[];
  isColdStart: boolean;
  /** Resolved execution-only model config. Extensions must not serialize it into prompts. */
  runtimeConfig?: AgentRuntimeConfig;
  /**
   * Run-scoped cancellation — fires when the run is aborted. Extensions doing
   * network work (retrieval, memory injection) should pass it through so a
   * cancelled run never waits on stale context assembly.
   */
  signal?: AbortSignal;
  /**
   * Activate already-registered tools by name for subsequent model requests.
   * Wired by the runner to the live SDK session — calling it inside a tool's
   * execute() takes effect on the next provider request within the same run.
   */
  activateTools?(toolNames: string[]): ToolActivationResult;
}

export interface BeforeSessionRunResult {
  /** Context available to tools discovered mid-run, without exposing it to unrelated requests. */
  toolContexts?: Array<{ tools: string[]; stablePrompt?: string; statePrompt?: string }>;
  /**
   * Stable domain rules, composed into the request's system context once.
   * Never appended to conversation history; available again after compaction.
   */
  stablePrompt?: string;
  /**
   * Short dynamic state for THIS turn (current time, selected resources,
   * pending operations). Replaces the previous turn's block rather than
   * accumulating full guides in history.
   */
  statePrompt?: string;
  /**
   * This extension's tool catalog. Tools are kept registered for later
   * activation even when not currently exposed.
   */
  customTools?: AgentRuntimeCustomTool[];
  /**
   * Tool names to expose to the model this turn. When the extension returns
   * customTools but omits this, all of its tools stay exposed (legacy default).
   */
  activateTools?: string[];
  /** Discoverable packs for the runner-owned `capabilities_search` tool. */
  toolPacks?: Record<string, AgentToolPack>;
}

export interface AfterSessionRunContext {
  session: Session;
  prompt: string;
  messages: Message[];
}

export interface SessionDeletedContext {
  sessionId: string;
  session?: Session | null;
}

export interface AgentRuntimeExtension {
  name: string;
  beforeSessionRun?(context: BeforeSessionRunContext): Promise<BeforeSessionRunResult | void>;
  afterSessionRun?(context: AfterSessionRunContext): Promise<void>;
  onSessionDeleted?(context: SessionDeletedContext): Promise<void>;
}
