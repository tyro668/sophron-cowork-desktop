import type { AgentSession } from '@mariozechner/pi-coding-agent';
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

  install(agent: AgentSession['agent']): void {
    const stream = agent.streamFn.bind(agent);
    agent.streamFn = (model, context, options) => {
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
      return stream(
        model,
        {
          ...context,
          systemPrompt: [context.systemPrompt, ...stable, ...state].filter(Boolean).join('\n\n'),
        },
        options
      );
    };
  }
}
