import type { Agent } from '@earendil-works/pi-agent-core';
import type { BeforeSessionRunResult } from '../extensions/agent-runtime-extension';

/** Request-only context: the SDK history contains the actual user message only. */
export class AgentRequestContext {
  private context: BeforeSessionRunResult = {};
  private activeTools = new Set<string>();

  update(context: BeforeSessionRunResult): void {
    this.context = context;
    this.activeTools.clear();
  }

  setActiveTools(names: Iterable<string>): void {
    this.activeTools = new Set(names);
  }

  install(agent: Agent): void {
    const previous = agent.prepareRequest;
    agent.prepareRequest = (async (request, signal) => {
      const previousResult = await previous?.(request, signal);
      const context = previousResult?.context ?? request.context;
      const extra = this.requestPrompt();
      const tools = agent.state.tools;
      if (!extra) {
        return {
          ...previousResult,
          context: { ...context, tools },
        };
      }
      return {
        ...previousResult,
        context: {
          ...context,
          tools,
          messages: withRequestPrompt(context.messages, extra),
        },
      };
    }) as Agent['prepareRequest'];
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
