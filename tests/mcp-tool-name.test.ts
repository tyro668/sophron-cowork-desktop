import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0',
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

import { buildMcpCustomTools } from '../src/main/agent/agent-runner-tools';
import { harnessMessage } from '../src/main/utils/harness-messages';
import { mcpModelToolName, MCPManager } from '../src/main/mcp/mcp-manager';

type TestManagerInternals = {
  clients: Map<string, unknown>;
  tools: Map<string, unknown>;
  serverConfigs: Map<string, unknown>;
  reconnectServer: ReturnType<typeof vi.fn>;
};

function asTestManager(manager: MCPManager): TestManagerInternals {
  return manager as unknown as TestManagerInternals;
}

function createManagerWithTool(toolName: string, originalName = toolName) {
  const manager = new MCPManager();
  const mockClient = {
    callTool: vi.fn().mockResolvedValue({ ok: true }),
  };
  const testManager = asTestManager(manager);

  testManager.clients = new Map([['server-1', mockClient]]);
  testManager.tools = new Map([
    [
      toolName,
      {
        name: toolName,
        originalName,
        description: '',
        inputSchema: { type: 'object', properties: {} },
        serverId: 'server-1',
        serverName: 'Software Development',
      },
    ],
  ]);

  return { manager, mockClient };
}

describe('MCP tool name parsing', () => {
  it('submits a write once when the server commits it and the response is lost', async () => {
    const { manager, mockClient } = createManagerWithTool('submit');
    const committed: string[] = [];
    mockClient.callTool.mockImplementation(async () => {
      committed.push('receipt-1');
      throw new Error('connection closed');
    });
    const state = asTestManager(manager);
    state.reconnectServer = vi.fn().mockResolvedValue(true);
    await expect(manager.callTool('submit', {})).rejects.toThrow(
      harnessMessage('unknownToolOutcome', {
        tool: 'submit',
        reason: 'connection closed',
      })
    );
    expect(committed).toEqual(['receipt-1']);
  });

  it('delivers SDK cancellation to an in-flight MCP request', async () => {
    const { manager, mockClient } = createManagerWithTool('submit');
    mockClient.callTool.mockImplementation(() => new Promise(() => {}));
    const [tool] = buildMcpCustomTools(manager);
    const controller = new AbortController();
    const pending = tool.execute('call', {}, controller.signal, undefined, undefined as never);
    const requestSignal = mockClient.callTool.mock.calls[0][2].signal as AbortSignal;
    expect(requestSignal.aborted).toBe(false);
    controller.abort(new Error('cancelled in flight'));
    expect(requestSignal.aborted).toBe(true);
    await expect(pending).rejects.toThrow(
      harnessMessage('unknownToolOutcome', {
        tool: 'submit',
        reason: 'cancelled in flight',
      })
    );
    expect(mockClient.callTool).toHaveBeenCalledTimes(1);
  });

  it('retains the server receipt when cancellation follows delivery in the same tick', async () => {
    const { manager, mockClient } = createManagerWithTool('submit');
    mockClient.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'saved' }],
      structuredContent: { receiptId: 'save-42' },
    });
    const [tool] = buildMcpCustomTools(manager);
    const controller = new AbortController();
    const pending = tool.execute('submit-42', {}, controller.signal, undefined, undefined as never);
    controller.abort();
    const result = await pending;
    expect(mockClient.callTool.mock.calls[0][0]._meta).toEqual({
      'sophron/tool-call-id': 'submit-42',
    });
    expect(result.content).toEqual([{ type: 'text', text: expect.stringContaining('save-42') }]);
    expect(result.isError).toBe(false);
    expect(mockClient.callTool).toHaveBeenCalledTimes(1);
  });

  it('preserves the lookup ID when the server reports an uncertain write', async () => {
    const { manager, mockClient } = createManagerWithTool('submit');
    mockClient.callTool.mockResolvedValue({
      isError: true,
      content: [{ type: 'text', text: 'Not connected' }],
      structuredContent: { requestId: 'lookup-42' },
    });
    const [tool] = buildMcpCustomTools(manager);
    const result = await tool.execute('submit-42', {}, undefined, undefined, undefined as never);
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: expect.stringContaining('lookup-42') }]);
    expect(mockClient.callTool).toHaveBeenCalledTimes(1);
  });

  it('stops retrying a read when cancelled during backoff', async () => {
    const { manager, mockClient } = createManagerWithTool('inspect');
    const state = asTestManager(manager);
    Object.assign(manager.getTool('inspect')!, { readOnly: true });
    state.reconnectServer = vi.fn().mockResolvedValue(false);
    mockClient.callTool.mockRejectedValue(new Error('connection closed'));
    const controller = new AbortController();
    const pending = manager.callTool('inspect', {}, controller.signal);
    await vi.waitFor(() => expect(state.reconnectServer).toHaveBeenCalledOnce());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(mockClient.callTool).toHaveBeenCalledTimes(1);
  });

  it('routes to the original tool when the model name differs', async () => {
    const toolName = 'mcp__Software_Development__create_or_modify_code';
    const { manager, mockClient } = createManagerWithTool(toolName, 'create_or_modify_code');

    await manager.callTool(toolName, { foo: 'bar' });

    expect(mockClient.callTool).toHaveBeenCalledWith(
      {
        name: 'create_or_modify_code',
        arguments: { foo: 'bar' },
      },
      undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('preserves the original name regardless of the model alias', async () => {
    const toolName = 'mcp__Chrome__navigate';
    const { manager, mockClient } = createManagerWithTool(toolName, 'navigate');

    await manager.callTool(toolName, { url: 'https://example.com' });

    expect(mockClient.callTool).toHaveBeenCalledWith(
      {
        name: 'navigate',
        arguments: { url: 'https://example.com' },
      },
      undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('reconnects and retries when tool returns structured Not connected error', async () => {
    const toolName = 'mcp__GUI_Operate__screenshot_for_display';
    const manager = new MCPManager();
    const testManager = asTestManager(manager);
    const mockClient = {
      callTool: vi
        .fn()
        .mockResolvedValueOnce({
          content: [
            {
              type: 'text',
              text: '{"error":true,"message":"Not connected"}',
            },
          ],
        })
        .mockResolvedValueOnce({ ok: true }),
    };

    testManager.clients = new Map([['server-1', mockClient]]);
    testManager.tools = new Map([
      [
        toolName,
        {
          name: toolName,
          originalName: 'screenshot_for_display',
          description: '',
          inputSchema: { type: 'object', properties: {} },
          serverId: 'server-1',
          serverName: 'GUI_Operate',
          readOnly: true,
        },
      ],
    ]);
    testManager.reconnectServer = vi.fn().mockResolvedValue(true);

    const result = await manager.callTool(toolName, { display_index: 0 });

    expect(testManager.reconnectServer).toHaveBeenCalledWith('server-1');
    expect(mockClient.callTool).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: true });
  });

  it('does not reconnect when tool returns plain text content without structured error envelope', async () => {
    const toolName = 'mcp__GUI_Operate__screenshot_for_display';
    const manager = new MCPManager();
    const testManager = asTestManager(manager);
    const mockClient = {
      callTool: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: 'Not connected',
          },
        ],
      }),
    };

    testManager.clients = new Map([['server-1', mockClient]]);
    testManager.tools = new Map([
      [
        toolName,
        {
          name: toolName,
          originalName: 'screenshot_for_display',
          description: '',
          inputSchema: { type: 'object', properties: {} },
          serverId: 'server-1',
          serverName: 'GUI_Operate',
          readOnly: true,
        },
      ],
    ]);
    testManager.reconnectServer = vi.fn().mockResolvedValue(true);

    const result = await manager.callTool(toolName, { display_index: 0 });

    expect(testManager.reconnectServer).not.toHaveBeenCalled();
    expect(mockClient.callTool).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: 'Not connected',
        },
      ],
    });
  });

  it('sanitizes model-facing MCP tool names while calling the original tool name', async () => {
    const manager = new MCPManager();
    const testManager = asTestManager(manager);
    const mockClient = {
      listTools: vi.fn().mockResolvedValue({
        tools: [
          {
            name: 'browser.context',
            description: 'Inspect browser context',
            annotations: { readOnlyHint: true },
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      }),
      callTool: vi.fn().mockResolvedValue({ ok: true }),
    };

    testManager.clients = new Map([['server-1', mockClient]]);
    testManager.serverConfigs = new Map([
      [
        'server-1',
        {
          id: 'server-1',
          name: 'Browser Context',
          type: 'stdio',
          enabled: true,
        },
      ],
    ]);

    await manager.refreshTools();

    const [tool] = manager.getTools();
    expect(tool.name).toBe(mcpModelToolName('server-1', 'browser.context'));
    expect(tool.originalName).toBe('browser.context');
    expect(tool.readOnly).toBe(true);

    await manager.callTool(tool.name, { url: 'https://example.com' });

    expect(mockClient.callTool).toHaveBeenCalledWith(
      {
        name: 'browser.context',
        arguments: { url: 'https://example.com' },
      },
      undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('deduplicates sanitized MCP tool names that would otherwise collide', async () => {
    const manager = new MCPManager();
    const testManager = asTestManager(manager);
    const mockClient = {
      listTools: vi.fn().mockResolvedValue({
        tools: [
          {
            name: 'browser:context',
            description: '',
            inputSchema: { type: 'object', properties: {} },
          },
          {
            name: 'browser.context',
            description: '',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      }),
      callTool: vi.fn().mockResolvedValue({ ok: true }),
    };

    testManager.clients = new Map([['server-1', mockClient]]);
    testManager.serverConfigs = new Map([
      [
        'server-1',
        {
          id: 'server-1',
          name: 'Browser Context',
          type: 'stdio',
          enabled: true,
        },
      ],
    ]);

    await manager.refreshTools();

    const tools = manager.getTools();
    expect(new Set(tools.map((tool) => tool.name))).toEqual(
      new Set([
        mcpModelToolName('server-1', 'browser.context'),
        mcpModelToolName('server-1', 'browser:context'),
      ])
    );
  });

  it('keeps sanitized MCP tool names within provider length limits', async () => {
    const manager = new MCPManager();
    const testManager = asTestManager(manager);
    const originalToolName = 'browser.' + 'context-'.repeat(10);
    const mockClient = {
      listTools: vi.fn().mockResolvedValue({
        tools: [
          {
            name: originalToolName,
            description: '',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      }),
      callTool: vi.fn().mockResolvedValue({ ok: true }),
    };

    testManager.clients = new Map([['server-1', mockClient]]);
    testManager.serverConfigs = new Map([
      [
        'server-1',
        {
          id: 'server-1',
          name: 'Browser Context Server With A Very Long Display Name',
          type: 'stdio',
          enabled: true,
        },
      ],
    ]);

    await manager.refreshTools();

    const [tool] = manager.getTools();
    expect(tool.name.length).toBeLessThanOrEqual(64);

    await manager.callTool(tool.name, { url: 'https://example.com' });

    expect(mockClient.callTool).toHaveBeenCalledWith(
      {
        name: originalToolName,
        arguments: { url: 'https://example.com' },
      },
      undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('falls back to tool when the original tool name sanitizes to an empty string', async () => {
    const manager = new MCPManager();
    const testManager = asTestManager(manager);
    const mockClient = {
      listTools: vi.fn().mockResolvedValue({
        tools: [
          {
            name: '!!!',
            description: '',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      }),
      callTool: vi.fn().mockResolvedValue({ ok: true }),
    };

    testManager.clients = new Map([['server-1', mockClient]]);
    testManager.serverConfigs = new Map([
      [
        'server-1',
        {
          id: 'server-1',
          name: 'Browser Context',
          type: 'stdio',
          enabled: true,
        },
      ],
    ]);

    await manager.refreshTools();

    const [tool] = manager.getTools();
    expect(tool.name).toBe(mcpModelToolName('server-1', '!!!'));
    expect(tool.originalName).toBe('!!!');
  });

  it('falls back to a hashed safe name when an absurdly long suffix leaves no room for the base', () => {
    const toolName = mcpModelToolName('server', '9'.repeat(80));

    expect(toolName.length).toBeLessThanOrEqual(64);
    expect(toolName.startsWith('mcp__')).toBe(true);
  });
});
