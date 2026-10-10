import { describe, expect, it, vi } from 'vitest';
import { Agent, type AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from 'typebox';
import { AgentRuntimeExtensionManager } from '../src/main/extensions/agent-runtime-extension-manager';
import type { BeforeSessionRunContext } from '../src/main/extensions/agent-runtime-extension';
import { AgentSession } from '@earendil-works/pi-coding-agent';
import {
  createAssistantMessageEventStream,
  getCurrentSystemPrompt,
  getCurrentTools,
  type AssistantMessage,
  type Message,
  type Model,
  type ToolCall,
} from '@earendil-works/pi-ai';
import { AgentRequestContext } from '../src/main/agent/agent-request-context';
import {
  applyActiveToolsInPlace,
  selectActiveToolsForTurn,
} from '../src/main/agent/agent-runner-tools';
import { createCapabilitiesSearchTool } from '../src/main/agent/agent-capabilities-tool';
import { createDataAgentRuntimeExtension } from '../src/main/data/data-agent-extension';
import type { DataToolService } from '../src/main/data/data-tool-service';

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
function requestView(messages: readonly Message[]): {
  system: string;
  history: string;
  tools: string[];
} {
  return {
    system: getCurrentSystemPrompt(messages),
    history: JSON.stringify(messages.filter((message) => message.role !== 'system')),
    tools: getCurrentTools(messages).map((tool) => tool.name),
  };
}

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

describe('request-only domain context with the real SDK', () => {
  it('can inspect and re-analyze after generation fails in the confirmation turn', async () => {
    const ok = { content: [{ type: 'text' as const, text: 'ok' }], details: {} };
    const generate = vi.fn(async () => {
      throw new Error('generation validation failed');
    });
    const inspect = vi.fn(async () => ok);
    const analyze = vi.fn(async () => ok);
    const extension = createDataAgentRuntimeExtension({
      resolveConversationContext: async () => ({
        sessionId: 'chat',
        selectedDataPipelineId: 'task',
        capabilities: {},
      }),
      updateExecutionContext: vi.fn(),
      hasPendingAnalysis: () => true,
      hasSupportedAnalysis: () => true,
      resolveExecutionContext: () => ({ sessionId: 'chat', currentUserMessageId: 'confirmed' }),
      rememberResolvedResources: vi.fn(),
      generatePipelineFromAnalysis: generate,
      getPipelineWorkflow: inspect,
      analyzePipelineRequirement: analyze,
    } as unknown as DataToolService);
    const activated = (await extension.beforeSessionRun!({
      session: { id: 'chat' } as BeforeSessionRunContext['session'],
      prompt: '确认',
      existingMessages: [],
      isColdStart: false,
    }))!;
    const tools: AgentTool[] = activated
      .customTools!.filter((tool) => activated.activateTools!.includes(tool.name))
      .map((tool) => ({
        ...tool,
        execute: (id, args, signal, update) =>
          tool.execute(id, args, signal, update, undefined as never),
      }));
    const calls: Array<Pick<ToolCall, 'name' | 'arguments'>> = [
      {
        name: 'data_generate_pipeline_from_requirement',
        arguments: { analysisId: 'receipt', confirmed: true, outputMode: 'create' },
      },
      { name: 'data_get_pipeline_workflow', arguments: { pipelineId: 'task' } },
      {
        name: 'data_analyze_pipeline_requirement',
        arguments: {
          rawTableId: 'input',
          processRequirement: 'Filter profit > 0',
          reusePipelineId: 'task',
        },
      },
    ];
    let index = 0;
    const agent = new Agent({
      initialState: { model, tools },
      streamFn: (_model, request) => {
        const call = calls[index++];
        if (!call) return response([{ type: 'text', text: 'done' }]);
        expect(getCurrentTools(request.messages).map((tool) => tool.name)).toContain(call.name);
        return response([{ type: 'toolCall', id: `call-${index}`, ...call }]);
      },
    });
    const context = new AgentRequestContext();
    context.update(activated);
    context.setActiveTools(activated.activateTools!);
    context.install(agent);
    await agent.prompt('确认');
    expect(generate).toHaveBeenCalledOnce();
    expect(inspect).toHaveBeenCalledOnce();
    expect(analyze).toHaveBeenCalledOnce();
    const results = agent.state.messages.filter((message) => message.role === 'toolResult');
    expect(results.map((message) => message.isError)).toEqual([true, false, false]);
    expect(JSON.stringify(results)).not.toContain('not found');
  });

  it('keeps exactly one current state outside history through warm turns and history replacement', async () => {
    const seen: Array<{ system: string; history: string }> = [];
    const agent = new Agent({
      initialState: { model, systemPrompt: 'base' },
      streamFn: (_model, context) => {
        const view = requestView(context.messages);
        seen.push({ system: view.system, history: view.history });
        return response([{ type: 'text', text: 'done' }]);
      },
    });
    const context = new AgentRequestContext();
    context.install(agent);
    for (let i = 0; i < 10; i++) {
      context.update({
        toolContexts: [
          {
            tools: ['data_run_pipeline'],
            stablePrompt: 'stable-domain-rule',
            statePrompt: `current-task=${i};`,
          },
        ],
      });
      context.setActiveTools(['data_run_pipeline']);
      await agent.prompt('继续');
      expect(seen[i].system.match(/current-task=/g)).toHaveLength(1);
      expect(seen[i].system).toContain(`current-task=${i};`);
      expect(seen[i].system.match(/stable-domain-rule/g)).toHaveLength(1);
      expect(seen[i].history).not.toContain('current-task=');
      expect(seen[i].history).not.toContain('stable-domain-rule');
    }
    // Compaction/recovery replaces history; request context is independent of it.
    agent.state.messages = agent.state.messages.filter((message) => message.role === 'system');
    await agent.prompt('继续');
    expect(seen.at(-1)?.system).toContain('current-task=9;');
    expect(seen.at(-1)?.system).toContain('stable-domain-rule');
    context.update({});
    await agent.prompt('写诗');
    expect(seen.at(-1)?.system).toBe('base');
  });

  it('does not duplicate combined domain prompts and preserves legacy extension context', async () => {
    const manager = new AgentRuntimeExtensionManager(
      ['data', 'automation'].map((name) => ({
        name,
        beforeSessionRun: async () => ({
          stablePrompt: `${name}-rules`,
          statePrompt: `${name}-state`,
          activateTools: [name],
          toolContexts: [
            { tools: [name], stablePrompt: `${name}-rules`, statePrompt: `${name}-state` },
          ],
        }),
      }))
    );
    manager.register({
      name: 'legacy',
      beforeSessionRun: async () => ({ stablePrompt: 'legacy-rule' }),
    });
    const merged = await manager.beforeSessionRun({} as BeforeSessionRunContext);
    let system = '';
    const agent = new Agent({
      initialState: { model },
      streamFn: (_model, request) => {
        system = getCurrentSystemPrompt(request.messages);
        return response([{ type: 'text', text: 'done' }]);
      },
    });
    const context = new AgentRequestContext();
    context.install(agent);
    context.update(merged);
    context.setActiveTools(['data', 'automation']);
    await agent.prompt('continue');
    for (const part of [
      'data-rules',
      'automation-rules',
      'data-state',
      'automation-state',
      'legacy-rule',
    ]) {
      expect(system.split(part)).toHaveLength(2);
    }
  });

  it('discovers and executes a hidden tool in the same loop, then releases it next turn', async () => {
    const context = new AgentRequestContext();
    context.update({ toolContexts: [{ tools: ['hidden_tool'], stablePrompt: 'hidden-rule' }] });
    let calls = 0;
    const hidden: AgentTool = {
      label: 'Offline test tool',
      name: 'hidden_tool',
      description: 'offline',
      parameters: Type.Object({}),
      execute: async () => {
        calls++;
        return { content: [{ type: 'text' as const, text: 'executed' }], details: {} };
      },
    };
    const pi = Object.create(AgentSession.prototype) as AgentSession;
    const search = createCapabilitiesSearchTool({
      getPacks: () => ({ hidden: { description: 'test', tools: ['hidden_tool'] } }),
      activateTools: (names) => {
        const active = applyActiveToolsInPlace(pi, [...pi.getActiveToolNames(), ...names]);
        context.setActiveTools(active);
        return { activated: names, unknown: [] };
      },
    });
    const searchTool: AgentTool = {
      ...search,
      execute: (id, params, signal, onUpdate) =>
        search.execute(id, params, signal, onUpdate, undefined as never),
    };
    const requests: Array<{ tools: string[]; system: string }> = [];
    const agent = new Agent({
      initialState: { model, tools: [searchTool], systemPrompt: 'base' },
      streamFn: (_model, request) => {
        const view = requestView(request.messages);
        requests.push({
          tools: view.tools,
          system: view.system,
        });
        return response(
          requests.length === 1
            ? [
                {
                  type: 'toolCall',
                  id: 'discover',
                  name: 'capabilities_search',
                  arguments: { pack: 'hidden' },
                },
              ]
            : requests.length === 2
              ? [{ type: 'toolCall', id: 'execute', name: 'hidden_tool', arguments: {} }]
              : [{ type: 'text', text: 'done' }]
        );
      },
    });
    Object.assign(pi, {
      agent,
      _toolRegistry: new Map<string, AgentTool>([
        [searchTool.name, searchTool],
        [hidden.name, hidden],
      ]),
      _rebuildSystemPrompt: () => 'base',
    });
    context.install(agent);
    await agent.prompt('discover');
    expect(calls).toBe(1);
    expect(requests[1].tools).toContain('hidden_tool');
    expect(requests[1].system).toContain('hidden-rule');
    const next = selectActiveToolsForTurn(
      pi.getActiveToolNames(),
      new Set([search.name, hidden.name]),
      new Set([hidden.name]),
      []
    );
    applyActiveToolsInPlace(pi, next);
    context.update({});
    context.setActiveTools(next);
    await agent.prompt('写诗');
    expect(requests.at(-1)?.tools).toEqual(['capabilities_search']);
    expect(requests.at(-1)?.system).not.toContain('hidden-rule');
  });
});
