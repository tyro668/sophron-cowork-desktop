import { describe, expect, it, vi } from 'vitest';
import { MCPManager, mcpModelToolName } from '../src/main/mcp/mcp-manager';
import { buildMcpCustomTools } from '../src/main/agent/agent-runner-tools';

describe('MCP discovery and protocol', () => {
  it('publishes every page and routes colliding display names by stable identity', async () => {
    const manager = new MCPManager();
    const state = manager as unknown as {
      clients: Map<string, unknown>;
      serverConfigs: Map<string, unknown>;
    };
    const schema = {
      type: 'object',
      properties: { page: { type: 'integer', minimum: 1 } },
      additionalProperties: false,
    };
    const server = (id: string) => ({
      listTools: vi.fn(async (input?: { cursor?: string }) =>
        input?.cursor
          ? { tools: [{ name: 'inspect.logs', inputSchema: schema }] }
          : { tools: [{ name: 'list_entries', inputSchema: schema }], nextCursor: 'page-2' }
      ),
      callTool: vi.fn(async () => ({
        content: [{ type: 'text', text: 'receipt' }],
        structuredContent: { id },
        isError: id === 'b',
      })),
    });
    const a = server('a'),
      b = server('b');
    state.serverConfigs = new Map([
      ['a', { name: 'Project Files' }],
      ['b', { name: 'Project_Files' }],
    ]);
    for (const order of [
      [
        ['a', a],
        ['b', b],
      ],
      [
        ['b', b],
        ['a', a],
      ],
    ] as const) {
      state.clients = new Map<string, unknown>(order);
      await manager.refreshTools();
      const tools = buildMcpCustomTools(manager);
      expect(tools).toHaveLength(4);
      for (const id of ['a', 'b']) {
        const tool = tools.find((t) => t.name === mcpModelToolName(id, 'inspect.logs'))!;
        expect(tool.parameters).toMatchObject(schema);
        const result = await tool.execute(
          'call',
          { page: 1 },
          undefined,
          undefined,
          undefined as never
        );
        expect(result).toMatchObject({ structuredContent: { id }, isError: id === 'b' });
      }
    }
    expect(a.callTool).toHaveBeenCalledTimes(2);
    expect(b.callTool).toHaveBeenCalledTimes(2);
  });
  it('discards a partial catalog with repeated cursors', async () => {
    const manager = new MCPManager();
    const state = manager as unknown as {
      clients: Map<string, unknown>;
      serverConfigs: Map<string, unknown>;
    };
    const listTools = vi.fn(async (input?: { cursor: string }) => ({
      tools: [{ name: input?.cursor ?? 'first', inputSchema: { type: 'object' } }],
      nextCursor: 'loop',
    }));
    state.clients.set('id', { listTools });
    state.serverConfigs.set('id', { name: 'Service' });
    await manager.refreshTools();
    expect(listTools).toHaveBeenCalledTimes(2);
    expect(manager.getTools()).toEqual([]);
  });

  it('ignores a late refresh after the same service has reconnected', async () => {
    const manager = new MCPManager();
    const state = manager as unknown as {
      clients: Map<string, unknown>;
      serverConfigs: Map<string, unknown>;
    };
    const page = (name: string) => ({ tools: [{ name, inputSchema: { type: 'object' } }] });
    let finish!: (value: ReturnType<typeof page>) => void;
    state.serverConfigs.set('id', { name: 'Service' });
    state.clients.set('id', {
      listTools: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const stale = manager.refreshTools();
    state.clients.set('id', { listTools: async () => page('current') });
    await manager.refreshTools();
    finish(page('removed'));
    await stale;
    expect(manager.getTools().map((tool) => tool.originalName)).toEqual(['current']);
  });
});
