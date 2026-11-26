import { SessionResultRepository } from '../src/main/session/session-result-repository';
import { testResultStore, harnessDatabase, temporaryDatabasePath } from './fixtures/harness-db';
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
    const store = testResultStore();
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
    const store = testResultStore();
    const page = JSON.parse(
      textOf(store.bound({ content: [{ type: 'text', text: 'x'.repeat(10000) }], details: {} }))
    );
    await expect(invoke(testResultStore(), { resultRef: page.resultRef })).rejects.toThrow(
      'RESULT_REF_EXPIRED'
    );
  });

  it('reads the same page after reopen and enforces session, expiry and deletion boundaries', async () => {
    const path = temporaryDatabasePath();
    const db = harnessDatabase(path);
    for (const owner of ['alice', 'bob'])
      db.raw
        .prepare('INSERT INTO sessions(id,title,created_at,updated_at) VALUES (?,?,0,0)')
        .run(owner, owner);
    const text = 'prefix'.repeat(1400) + 'target-section' + 'tail'.repeat(200);
    const store = new ModelResultStore(new SessionResultRepository(db.raw, 'alice'));
    const result = store.bound(
      { content: [{ type: 'text', text }], details: { committed: true } },
      undefined,
      'call-1'
    );
    const { resultRef } = JSON.parse(textOf(result));
    const read = { resultRef, contains: 'target-section', limit: 24 };
    const originalPage = textOf(await invoke(store, read));
    expect(JSON.parse(originalPage)).toMatchObject({
      offset: 8400,
      textFragment: 'target-sectiontailtailta',
    });
    const index = db.raw
      .prepare('SELECT session_id,tool_call_id,bytes FROM session_tool_results WHERE result_ref=?')
      .get(resultRef);
    expect(index).toMatchObject({
      session_id: 'alice',
      tool_call_id: 'call-1',
      bytes: Buffer.byteLength(text) + Buffer.byteLength('{"committed":true}'),
    });
    db.close();
    const reopened = harnessDatabase(path);
    const alice = new ModelResultStore(new SessionResultRepository(reopened.raw, 'alice'));
    const bob = new ModelResultStore(new SessionResultRepository(reopened.raw, 'bob'));
    expect(textOf(await invoke(alice, read))).toBe(originalPage);
    await expect(invoke(bob, read)).rejects.toThrow('RESULT_REF_EXPIRED');
    const expiring = JSON.parse(
      textOf(alice.bound({ content: [{ type: 'text', text }], details: {} }))
    ).resultRef;
    reopened.raw
      .prepare('UPDATE session_tool_results SET expires_at=0 WHERE result_ref=?')
      .run(expiring);
    await expect(invoke(alice, { resultRef: expiring })).rejects.toThrow('RESULT_REF_EXPIRED');
    reopened.sessions.delete('alice');
    expect(reopened.raw.prepare('SELECT COUNT(*) FROM session_tool_results').pluck().get()).toBe(0);
    await expect(invoke(alice, read)).rejects.toThrow('RESULT_REF_EXPIRED');
  });

  it('preserves structured receipts and declines new references when a session is full', async () => {
    const db = harnessDatabase();
    db.raw.exec("INSERT INTO sessions(id,title,created_at,updated_at) VALUES ('s','Test',0,0)");
    const store = new ModelResultStore(new SessionResultRepository(db.raw, 's'));
    const structuredContent = { receiptId: 'write-42', committed: true, rows: 'r'.repeat(9000) };
    const result = {
      content: [{ type: 'text' as const, text: 'saved' }],
      structuredContent,
      details: {},
    };
    const first = JSON.parse(textOf(store.bound(result)));
    expect(first.evidence).toMatchObject({ receiptId: 'write-42', committed: true });
    expect(
      textOf(await invoke(store, { resultRef: first.resultRef, contains: '"rows"' }))
    ).toContain('rows');
    db.raw.prepare('UPDATE session_tool_results SET bytes=?').run(64 * 1024 * 1024);
    const refused = JSON.parse(textOf(store.bound(result)));
    expect(refused).toMatchObject({
      storageError: 'RESULT_NOT_STORED',
      evidence: { receiptId: 'write-42', committed: true },
    });
    expect(refused).not.toHaveProperty('resultRef');
    expect(JSON.parse(textOf(await invoke(store, { resultRef: first.resultRef }))).resultRef).toBe(
      first.resultRef
    );
    expect(db.raw.prepare('SELECT count(*) FROM session_tool_results').pluck().get()).toBe(1);
  });

  it('keeps small tool results unchanged', () => {
    const result = {
      content: [{ type: 'text' as const, text: 'status=completed' }],
      details: { id: 'r' },
    };
    expect(testResultStore().bound(result)).toBe(result);
  });

  it('keeps commit evidence visible even when the full evidence also exceeds the budget', async () => {
    const identifiers = Object.fromEntries(
      ['id', 'taskId', 'resultTableId', 'rawTableId', 'analysisId', 'draftId', 'runId', 'code'].map(
        (key) => [key, key + 'x'.repeat(180)]
      )
    );
    const store = testResultStore();
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
    const store = testResultStore();
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
