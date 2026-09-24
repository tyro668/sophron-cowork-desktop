import { describe, expect, it, vi } from 'vitest';
import { Agent, type BeforeToolCallResult } from '@earendil-works/pi-agent-core';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import { installAgentPermissionGate } from '../src/main/agent/agent-permission-hook';

function createHarness(toolName = 'bash') {
  const execute = vi.fn(async () => ({
    content: [{ type: 'text' as const, text: 'done' }],
    details: {},
  }));
  const sdkHook = vi.fn(async (): Promise<BeforeToolCallResult | undefined> => undefined);
  let turn = 0;
  const agent = new Agent({
    initialState: {
      tools: [
        {
          name: toolName,
          label: toolName,
          description: 'Test tool',
          parameters: Type.Object({}),
          execute,
        },
      ],
    },
    beforeToolCall: sdkHook,
    streamFn: () => {
      const isToolTurn = turn++ === 0;
      const message: AssistantMessage = {
        role: 'assistant',
        api: 'openai-completions',
        provider: 'test',
        model: 'test',
        content: isToolTurn
          ? [{ type: 'toolCall', id: 'call-1', name: toolName, arguments: {} }]
          : [{ type: 'text', text: 'Finished' }],
        stopReason: isToolTurn ? 'toolUse' : 'stop',
        timestamp: Date.now(),
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: 'done', reason: message.stopReason as 'toolUse' | 'stop', message });
      stream.end();
      return stream;
    },
  });
  return { agent, execute, sdkHook };
}

describe('permission hook with the installed SDK', () => {
  it.each(['bash', 'mcp__data__run_task'])(
    'allows %s only after permission and SDK checks',
    async (name) => {
      const { agent, execute, sdkHook } = createHarness(name);
      const gate = vi.fn(async () => {
        expect(execute).not.toHaveBeenCalled();
        expect(sdkHook).not.toHaveBeenCalled();
        return undefined;
      });
      installAgentPermissionGate(agent, gate);
      await agent.prompt('Run test tool');
      expect(gate).toHaveBeenCalledOnce();
      expect(sdkHook).toHaveBeenCalledOnce();
      expect(execute).toHaveBeenCalledOnce();
      expect(agent.state.errorMessage).toBeUndefined();
    }
  );

  it('blocks execution and extension callbacks when permission is denied', async () => {
    const { agent, execute, sdkHook } = createHarness();
    installAgentPermissionGate(agent, async () => ({ block: true, reason: 'Denied by user' }));
    await agent.prompt('Run test tool');
    expect(execute).not.toHaveBeenCalled();
    expect(sdkHook).not.toHaveBeenCalled();
    expect(agent.state.messages).toContainEqual(
      expect.objectContaining({ role: 'toolResult', isError: true })
    );
  });

  it('waits for approval before executing the tool', async () => {
    const { agent, execute, sdkHook } = createHarness();
    let approve!: () => void;
    let requested!: () => void;
    const pending = new Promise<void>((resolve) => {
      approve = resolve;
    });
    const started = new Promise<void>((resolve) => {
      requested = resolve;
    });
    installAgentPermissionGate(agent, async () => {
      requested();
      await pending;
      return undefined;
    });
    const run = agent.prompt('Run test tool');
    await started;
    expect(execute).not.toHaveBeenCalled();
    expect(sdkHook).not.toHaveBeenCalled();
    approve();
    await run;
    expect(execute).toHaveBeenCalledOnce();
    expect(sdkHook).toHaveBeenCalledOnce();
  });

  it('preserves SDK extension vetoes after permission is allowed', async () => {
    const { agent, execute, sdkHook } = createHarness();
    sdkHook.mockResolvedValue({ block: true, reason: 'Extension veto' });
    installAgentPermissionGate(agent, async () => undefined);
    await agent.prompt('Run test tool');
    expect(sdkHook).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
  });

  it('fails closed when permission evaluation throws', async () => {
    const { agent, execute, sdkHook } = createHarness();
    installAgentPermissionGate(agent, async () => {
      throw new Error('Review failed');
    });
    await agent.prompt('Run test tool');
    expect(execute).not.toHaveBeenCalled();
    expect(sdkHook).not.toHaveBeenCalled();
  });

  it('blocks a call cancelled while permission is pending', async () => {
    const { agent, execute, sdkHook } = createHarness();
    installAgentPermissionGate(agent, async () => {
      agent.abort();
      return undefined;
    });
    await agent.prompt('Run test tool');
    expect(execute).not.toHaveBeenCalled();
    expect(sdkHook).not.toHaveBeenCalled();
  });
});
