import type { Agent } from '@earendil-works/pi-agent-core';

type BeforeToolCall = NonNullable<Agent['beforeToolCall']>;

/** Gate every tool call using the SDK's public hook, retaining extension checks. */
export function installAgentPermissionGate(agent: Agent, gate: BeforeToolCall): void {
  if (!agent || !('beforeToolCall' in agent)) {
    throw new Error('Permission hook unavailable: agent.beforeToolCall is missing');
  }
  const sdkBeforeToolCall = agent.beforeToolCall;
  agent.beforeToolCall = async (context, signal) => {
    if (signal?.aborted) return { block: true, reason: 'Task cancelled.' };
    const result = await gate(context, signal);
    if (signal?.aborted) return { block: true, reason: 'Task cancelled.' };
    if (result?.block) return result;
    return sdkBeforeToolCall?.call(agent, context, signal);
  };
}
