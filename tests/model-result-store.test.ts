import { describe, expect, it } from 'vitest';
import { ModelResultStore, MODEL_RESULT_MAX_CHARS } from '../src/main/agent/model-result-store';
import { buildMcpCustomTools, buildMcpToolPacks } from '../src/main/agent/agent-runner-tools';
import type { MCPManager } from '../src/main/mcp/mcp-manager';

const textOf = (result: { content: Array<{ type: string; text?: string }> }) =>
  result.content.map((block) => block.text ?? '').join('');
const invoke = (store: ModelResultStore, params: Record<string, unknown>) =>
  store.createReadTool().execute('read', params, undefined, undefined, undefined as never);

describe('model result budget and complete references', () => {
  it.each([
    'x'.repeat(200000),
    '\n\t"\\'.repeat(10000),
    JSON.stringify({ ['column_' + 'c'.repeat(30000)]: 'value' }),
  ])('bounds serialized pages and reconstructs the complete original text', async (text) => {
    const store = new ModelResultStore();
    const details = {
      task: { id: 'task-id' },
      resultTableId: 'output-id',
      committed: true,
      mode: 'persisted',
      sentinel: 'UI_ONLY',
    };
    const bounded = store.bound({ content: [{ type: 'text', text }], details });
    expect(bounded.details).toBe(details);
    expect(textOf(bounded).length).toBeLessThanOrEqual(MODEL_RESULT_MAX_CHARS);
    let page = JSON.parse(textOf(bounded));
    expect(page.evidence).toMatchObject({
      task: { id: 'task-id' },
      resultTableId: 'output-id',
      committed: true,
    });
    expect(textOf(bounded)).not.toContain('UI_ONLY');
    let reconstructed = page.textFragment;
    while (page.nextOffset !== null) {
      const next = await invoke(store, { resultRef: page.resultRef, offset: page.nextOffset });
      expect(textOf(next).length).toBeLessThanOrEqual(MODEL_RESULT_MAX_CHARS);
      page = JSON.parse(textOf(next));
      reconstructed += page.textFragment;
    }
    expect(reconstructed).toBe(text);
  });

  it('does not expose another conversation result reference', async () => {
    const store = new ModelResultStore();
    const page = JSON.parse(
      textOf(store.bound({ content: [{ type: 'text', text: 'x'.repeat(10000) }], details: {} }))
    );
    await expect(invoke(new ModelResultStore(), { resultRef: page.resultRef })).rejects.toThrow(
      'RESULT_REF_EXPIRED'
    );
  });

  it('keeps small tool results unchanged', () => {
    const result = {
      content: [{ type: 'text' as const, text: 'status=completed' }],
      details: { id: 'r' },
    };
    expect(new ModelResultStore().bound(result)).toBe(result);
  });

  it('keeps commit evidence visible even when the full evidence also exceeds the budget', async () => {
    const identifiers = Object.fromEntries(
      ['id', 'taskId', 'resultTableId', 'rawTableId', 'analysisId', 'draftId', 'runId', 'code'].map(
        (key) => [key, key + 'x'.repeat(180)]
      )
    );
    const store = new ModelResultStore();
    const result = store.bound({
      content: [{ type: 'text', text: 'x'.repeat(10000) }],
      details: {
        ...identifiers,
        committed: true,
        mode: 'persisted',
        task: identifiers,
        rawTable: identifiers,
        resultTable: identifiers,
      },
    });
    const page = JSON.parse(textOf(result));
    expect(textOf(result).length).toBeLessThanOrEqual(MODEL_RESULT_MAX_CHARS);
    expect(page.evidence).toMatchObject({
      committed: true,
      mode: 'persisted',
      additionalEvidenceInResult: true,
    });
    const fullEvidence = await invoke(store, {
      resultRef: page.resultRef,
      contains: 'Additional execution evidence:',
    });
    expect(textOf(fullEvidence)).toContain('Additional execution evidence:');
  });

  it('bounds the actual MCP bridge result and exposes the read tool on truncation', async () => {
    const mcp = {
      getTools: () => [
        {
          name: 'mcp_search',
          serverName: '网页检索',
          serverId: 'web',
          inputSchema: { type: 'object' },
        },
      ],
      callTool: async () => ({ content: [{ type: 'text', text: 'm'.repeat(200000) }] }),
    } as unknown as MCPManager;
    const store = new ModelResultStore();
    let activated = false;
    const tool = store.wrap(buildMcpCustomTools(mcp), () => {
      activated = true;
    })[0];
    const result = await tool.execute('mcp', {}, undefined, undefined, undefined as never);
    expect(textOf(result).length).toBeLessThanOrEqual(MODEL_RESULT_MAX_CHARS);
    expect(activated).toBe(true);
    expect(JSON.parse(textOf(result)).totalChars).toBe(200000);
  });

  it('uses stable server identities even when display names collide after normalization', () => {
    const manager = {
      getTools: () => [
        { name: 'web_search', serverName: '网页检索', serverId: 'server-web' },
        { name: 'files_read', serverName: '文件管理', serverId: 'server-files' },
        { name: 'a', serverName: 'a-b', serverId: 'a-b' },
        { name: 'b', serverName: 'a_b', serverId: 'a_b' },
      ],
    } as unknown as MCPManager;
    const packs = buildMcpToolPacks(manager);
    expect(Object.keys(packs)).toHaveLength(4);
    expect(packs['mcp.server-web'].tools).toEqual(['web_search']);
    expect(packs['mcp.server-web'].description).toContain('网页检索');
    expect(packs['mcp.server-files'].tools).toEqual(['files_read']);
  });
});
