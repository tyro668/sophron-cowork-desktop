import { getCurrentTools, getToolStateChanges } from '@earendil-works/pi-ai';
import type { Agent, AgentEvent, AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from 'typebox';
import type { BeforeSessionRunResult } from '../extensions/agent-runtime-extension';

/** Request-only context: the SDK history contains the actual user message only. */
export class AgentRequestContext {
  private context: BeforeSessionRunResult = {};
  beforeRequest?: () => boolean;
  /**
   * Called when the model calls tools that the current request did not expose.
   * The runner activates the registered ones (with their packs) on the live
   * session; names that stay unavailable are answered with a guidance error.
   */
  onMissingToolCalls?: (toolNames: string[]) => void;
  private activeTools = new Set<string>();
  /** Tools auto-activated by a direct call stay exposed for the cached SDK session. */
  private stickyTools = new Set<string>();
  /** The context object the loop executes tool calls against for the current request. */
  private currentRequest?: { tools?: AgentTool[] };

  update(context: BeforeSessionRunResult): void {
    this.context = context;
    this.activeTools.clear();
  }

  setActiveTools(names: Iterable<string>): void {
    this.activeTools = new Set(names);
  }

  rememberStickyTools(names: Iterable<string>): void {
    for (const name of names) this.stickyTools.add(name);
  }

  getStickyTools(): string[] {
    return [...this.stickyTools];
  }

  install(agent: Agent): void {
    agent.subscribe((event) => this.handleLoopEvent(agent, event));
    const previous = agent.prepareRequest;
    agent.prepareRequest = (async (request, signal) => {
      const catalogChanged = this.beforeRequest?.();
      const previousResult = await previous?.(request, signal);
      const context = previousResult?.context ?? request.context;
      const extra = this.requestPrompt();
      const tools = agent.state.tools;
      const messages = extra ? withRequestPrompt(context.messages, extra) : context.messages;
      // Pi serializes transcript tool deltas before prepareRequest. A service can
      // disconnect after that snapshot but before this request is sent.
      if (catalogChanged) {
        const delta = getToolStateChanges(getCurrentTools(messages), tools);
        if (delta.toolsAdded.length || delta.toolsRemoved.length) {
          const nextContext = {
            ...context,
            tools,
            messages: [
              ...messages,
              { role: 'system' as const, content: '', timestamp: Date.now(), ...delta },
            ],
          };
          this.currentRequest = nextContext;
          return { ...previousResult, context: nextContext };
        }
      }
      const nextContext = { ...context, tools, messages };
      this.currentRequest = nextContext;
      return { ...previousResult, context: nextContext };
    }) as Agent['prepareRequest'];
  }

  /**
   * Pi executes tool calls against the request context, which only holds the
   * tools exposed for that request. When the model calls a registered tool that
   * was not exposed yet, activate it before execution instead of failing with
   * "Tool not found"; stub unknown names with a guidance error until turn end.
   */
  private handleLoopEvent(agent: Agent, event: AgentEvent): void {
    const request = this.currentRequest;
    if (!request) return;
    if (event.type === 'turn_end') {
      if (request.tools?.some(isUnavailableToolStub)) {
        request.tools = request.tools.filter((tool) => !isUnavailableToolStub(tool));
      }
      return;
    }
    if (event.type !== 'message_end' || event.message.role !== 'assistant') return;
    const executable = new Set((request.tools ?? []).map((tool) => tool.name));
    const missing = [
      ...new Set(
        event.message.content
          .filter((block) => block.type === 'toolCall')
          .map((block) => block.name)
          .filter((name) => !executable.has(name))
      ),
    ];
    if (missing.length === 0) return;
    this.onMissingToolCalls?.(missing);
    const tools = agent.state.tools;
    const available = new Set(tools.map((tool) => tool.name));
    request.tools = [
      ...tools,
      ...missing.filter((name) => !available.has(name)).map(createUnavailableToolStub),
    ];
  }

  private requestPrompt(): string {
    const selected = (this.context.toolContexts ?? []).filter((entry) =>
      entry.tools.some((name) => this.activeTools.has(name))
    );
    const stable = new Set([
      this.context.stablePrompt,
      ...selected.map((entry) => entry.stablePrompt),
    ]);
    const state = new Set([
      this.context.statePrompt,
      ...selected.map((entry) => entry.statePrompt),
    ]);
    return [...stable, ...state].filter(Boolean).join('\n\n');
  }
}

function withRequestPrompt(
  messages: Agent['state']['messages'],
  extra: string
): Agent['state']['messages'] {
  const [first, ...rest] = messages;
  if (first?.role === 'system') {
    const content =
      typeof first.content === 'string'
        ? [first.content, extra].filter(Boolean).join('\n\n')
        : first.content;
    return [{ ...first, content }, ...rest];
  }
  return [{ role: 'system', content: extra, timestamp: Date.now() }, ...messages];
}

const UNAVAILABLE_TOOL_STUB = Symbol('unavailableToolStub');

type UnavailableToolStub = AgentTool & { [UNAVAILABLE_TOOL_STUB]: true };

function isUnavailableToolStub(tool: AgentTool): boolean {
  return (tool as Partial<UnavailableToolStub>)[UNAVAILABLE_TOOL_STUB] === true;
}

export function unavailableToolMessage(toolName: string): string {
  return `Tool "${toolName}" is not available in this app. Call capabilities_search with a short task description to find and load the right tool, then retry with its exact name.`;
}

/** Fails during argument preparation, so the permission gate never sees it. */
function createUnavailableToolStub(toolName: string): AgentTool {
  const stub: UnavailableToolStub = {
    name: toolName,
    label: toolName,
    description: '',
    parameters: Type.Object({}, { additionalProperties: true }),
    prepareArguments: () => {
      throw new Error(unavailableToolMessage(toolName));
    },
    execute: async () => {
      throw new Error(unavailableToolMessage(toolName));
    },
    [UNAVAILABLE_TOOL_STUB]: true,
  };
  return stub;
}
