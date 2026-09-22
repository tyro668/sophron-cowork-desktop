import { describe, expect, it, vi } from 'vitest';
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import { applyActiveToolsInPlace } from '../src/main/agent/agent-runner-tools';

/**
 * Fake AgentSession mirroring the SDK internals applyActiveToolsInPlace relies
 * on: `agent.state.tools` is the live array a running loop captured.
 */
function createFakeSession(registeredNames: string[]) {
  const registry = new Map(registeredNames.map((name) => [name, { name }]));
  const state = { tools: [{ name: 'capabilities_search' }] as Array<{ name: string }> };
  const session = {
    agent: {
      state,
      setSystemPrompt: vi.fn(),
    },
    _toolRegistry: registry,
    _baseSystemPrompt: 'base',
    _rebuildSystemPrompt: vi.fn((names: string[]) => `prompt:${names.join(',')}`),
    setActiveToolsByName: vi.fn((names: string[]) => {
      state.tools = names.map((name) => ({ name }));
    }),
    getActiveToolNames: vi.fn(() => state.tools.map((tool) => tool.name)),
    getAllTools: vi.fn(() => [...registry.values()]),
  };
  return { session: session as unknown as AgentSession, internals: session, state };
}

describe('applyActiveToolsInPlace', () => {
  it('mutates the live tools array so an in-flight loop sees new tools', () => {
    const { session, state } = createFakeSession([
      'capabilities_search',
      'data_run_task',
      'data_list_tasks',
    ]);
    // The running loop captured this array instance at prompt() start.
    const capturedByLoop = state.tools;

    const valid = applyActiveToolsInPlace(session, [
      'capabilities_search',
      'data_run_task',
      'data_list_tasks',
    ]);

    expect(valid).toEqual(['capabilities_search', 'data_run_task', 'data_list_tasks']);
    // Same array instance mutated in place — a captured reference sees it.
    expect(state.tools).toBe(capturedByLoop);
    expect(capturedByLoop.map((tool) => tool.name)).toEqual([
      'capabilities_search',
      'data_run_task',
      'data_list_tasks',
    ]);
    expect(session.setActiveToolsByName).not.toHaveBeenCalled();
  });

  it('drops unknown names and rebuilds the system prompt', () => {
    const { session, internals, state } = createFakeSession(['capabilities_search', 'tool_a']);

    const valid = applyActiveToolsInPlace(session, ['tool_a', 'ghost_tool']);

    expect(valid).toEqual(['tool_a']);
    expect(state.tools.map((tool) => tool.name)).toEqual(['tool_a']);
    expect(internals._rebuildSystemPrompt).toHaveBeenCalledWith(['tool_a']);
    expect(internals._baseSystemPrompt).toBe('prompt:tool_a');
    expect(internals.agent.setSystemPrompt).toHaveBeenCalledWith('prompt:tool_a');
  });

  it('falls back to setActiveToolsByName when internals are absent', () => {
    const session = {
      agent: { state: {} },
      setActiveToolsByName: vi.fn(),
      getActiveToolNames: vi.fn(() => ['tool_a']),
    } as unknown as AgentSession;

    const valid = applyActiveToolsInPlace(session, ['tool_a']);

    expect(session.setActiveToolsByName).toHaveBeenCalledWith(['tool_a']);
    expect(valid).toEqual(['tool_a']);
  });
});
