import { describe, expect, it, vi } from 'vitest';
import { Agent, type AgentTool } from '@earendil-works/pi-agent-core';
import {
  createAssistantMessageEventStream,
  getCurrentTools,
  type AssistantMessage,
  type Model,
  type ToolCall,
} from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import {
  AgentRequestContext,
  unavailableToolMessage,
} from '../src/main/agent/agent-request-context';
import { expandToolsToPacks } from '../src/main/agent/agent-runner-tools';

const model: Model<'openai-completions'> = {
  baseUrl: 'http://offline.invalid',
  id: 'offline',
  name: 'offline',
  provider: 'openai',
  api: 'openai-completions',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 1000,
};

function response(content: AssistantMessage['content']) {
  const message: AssistantMessage = {
    role: 'assistant',
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    stopReason: content.some((block) => block.type === 'toolCall') ? 'toolUse' : 'stop',
    timestamp: 0,
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
  stream.end(message);
  return stream;
}

function tool(name: string, execute = vi.fn()): AgentTool & { execute: typeof execute } {
  execute.mockResolvedValue({ content: [{ type: 'text', text: `${name} ok` }], details: {} });
  return {
    name,
    label: name,
    description: name,
    parameters: Type.Object({}, { additionalProperties: true }),
    execute,
  };
}

function scriptedAgent(
  visible: AgentTool[],
  calls: Array<Array<Pick<ToolCall, 'name' | 'arguments'>>>,
  seenTools: string[][]
) {
  let index = 0;
  return new Agent({
    initialState: { model, tools: visible },
    streamFn: (_model, request) => {
      seenTools.push(getCurrentTools(request.messages).map((entry) => entry.name));
      const batch = calls[index++];
      if (!batch) return response([{ type: 'text', text: 'done' }]);
      return response(
        batch.map((call, i) => ({ type: 'toolCall' as const, id: `call-${index}-${i}`, ...call }))
      );
    },
  });
}

describe('auto-activation of tools called before exposure', () => {
  it('activates a registered hidden tool and executes it instead of failing', async () => {
    const visible = tool('data_list_raw_tables');
    const hidden = tool('data_preview_table');
    const sibling = tool('data_run_pipeline');
    const registry = new Map([hidden, sibling].map((entry) => [entry.name, entry]));
    const seen: string[][] = [];
    const agent = scriptedAgent(
      [visible],
      [[{ name: 'data_preview_table', arguments: { tableId: 't1' } }]],
      seen
    );
    const context = new AgentRequestContext();
    const onMissing = vi.fn((names: string[]) => {
      const expanded = expandToolsToPacks(names, {
        'data.core': { description: 'core', tools: ['data_preview_table', 'data_run_pipeline'] },
      });
      const added = expanded.flatMap((name) => registry.get(name) ?? []);
      agent.state.tools = [...agent.state.tools, ...added];
      context.rememberStickyTools(added.map((entry) => entry.name));
    });
    context.onMissingToolCalls = onMissing;
    context.install(agent);

    await agent.prompt('预览一下');

    expect(onMissing).toHaveBeenCalledWith(['data_preview_table']);
    expect(hidden.execute).toHaveBeenCalledOnce();
    const results = agent.state.messages.filter((message) => message.role === 'toolResult');
    expect(results.map((message) => message.isError)).toEqual([false]);
    expect(JSON.stringify(results)).not.toContain('not found');
    // The next request declares the whole pack, so later sibling calls do not fail.
    expect(seen[1]).toEqual(
      expect.arrayContaining(['data_list_raw_tables', 'data_preview_table', 'data_run_pipeline'])
    );
    expect(context.getStickyTools()).toEqual(['data_preview_table', 'data_run_pipeline']);
  });

  it('answers truly unknown tools with capabilities_search guidance and never declares them', async () => {
    const visible = tool('data_list_raw_tables');
    const seen: string[][] = [];
    const agent = scriptedAgent(
      [visible],
      [
        [
          { name: 'made_up_tool', arguments: {} },
          { name: 'data_list_raw_tables', arguments: {} },
        ],
      ],
      seen
    );
    const context = new AgentRequestContext();
    context.onMissingToolCalls = vi.fn();
    context.install(agent);

    await agent.prompt('hi');

    const results = agent.state.messages.filter((message) => message.role === 'toolResult');
    expect(results.map((message) => [message.toolName, message.isError])).toEqual([
      ['made_up_tool', true],
      ['data_list_raw_tables', false],
    ]);
    expect(JSON.stringify(results[0].content)).toContain('capabilities_search');
    expect(JSON.stringify(results[0].content)).toContain(
      JSON.stringify(unavailableToolMessage('made_up_tool')).slice(1, -1)
    );
    expect(seen[1]).toEqual(['data_list_raw_tables']);
    expect(agent.state.tools.map((entry) => entry.name)).toEqual(['data_list_raw_tables']);
  });
});

describe('expandToolsToPacks', () => {
  it('adds every sibling of the packs that contain a called tool', () => {
    const packs = {
      a: { description: 'a', tools: ['x', 'y'] },
      b: { description: 'b', tools: ['y', 'z'] },
      c: { description: 'c', tools: ['w'] },
    };
    expect(expandToolsToPacks(['y'], packs).sort()).toEqual(['x', 'y', 'z']);
    expect(expandToolsToPacks(['loose'], packs)).toEqual(['loose']);
  });
});
