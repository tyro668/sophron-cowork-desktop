import { describe, expect, it, vi } from 'vitest';
import {
  detectAutomationIntent,
  detectDataIntent,
  SessionPackActivation,
} from '../src/main/extensions/agent-intent';
import { createCapabilitiesSearchTool } from '../src/main/agent/agent-capabilities-tool';
import { DATA_TOOL_PACKS } from '../src/main/data/data-tool-packs';
import type { Message } from '../src/shared/contracts';

const ctx = (prompt: string, existingMessages: Message[] = []) => ({
  prompt,
  existingMessages,
});

const noSticky = { stickyActive: false, hasPendingReceipts: false };

describe('data intent routing', () => {
  it('stays inactive for plain chat', () => {
    expect(detectDataIntent(ctx('今天天气怎么样'), noSticky).active).toBe(false);
  });

  it('activates on data keywords and scopes file intent', () => {
    const intent = detectDataIntent(ctx('把这个 csv 文件导入成输入表'), noSticky);
    expect(intent.active).toBe(true);
    expect(intent.file).toBe(true);
    expect(intent.cloud).toBe(false);
    expect(intent.authoring).toBe(false);
  });

  it('detects cloud attachments without keywords', () => {
    const messages = [
      {
        role: 'user',
        content: [{ type: 'cloud_table_attachment', tables: [{ tableId: 't1', tableName: 'T' }] }],
      },
    ] as unknown as Message[];
    const withAttachment = detectDataIntent(ctx('继续处理', messages), noSticky);
    expect(withAttachment.active).toBe(true);
    expect(withAttachment.cloud).toBe(true);
  });

  it('activates when earlier turns already used data tools', () => {
    const messages = [
      {
        role: 'assistant',
        content: [{ type: 'tool_use', name: 'data_run_task', input: {} }],
      },
    ] as unknown as Message[];
    expect(detectDataIntent(ctx('然后呢', messages), noSticky).active).toBe(true);
  });

  it('does not reactivate old work for an unrelated prompt, even with pending receipts', () => {
    const pending = { stickyActive: true, hasPendingReceipts: true };
    expect(detectDataIntent(ctx('写一首秋天的诗'), pending).active).toBe(false);
    expect(detectAutomationIntent(ctx('写一首秋天的诗'), pending).active).toBe(false);
  });

  it('stays active on sticky packs or pending receipts without keyword expansion', () => {
    const intent = detectDataIntent(ctx('继续'), {
      stickyActive: true,
      hasPendingReceipts: false,
    });
    expect(intent.active).toBe(true);
    expect(intent.authoring).toBe(false);
    expect(intent.cloud).toBe(false);
  });
});

describe('automation intent routing', () => {
  it('activates create pack signals on scheduling requests', () => {
    const intent = detectAutomationIntent(ctx('每天早上9点自动运行这个任务'), noSticky);
    expect(intent.active).toBe(true);
    expect(intent.create).toBe(true);
  });

  it('detects schedule-update wording', () => {
    const intent = detectAutomationIntent(ctx('把这个自动化改期到下周'), noSticky);
    expect(intent.active).toBe(true);
    expect(intent.update).toBe(true);
  });
});

describe('SessionPackActivation', () => {
  it('replaces packs per intent and clears on delete', () => {
    const activations = new SessionPackActivation();
    activations.activate('s1', ['data.core']);
    activations.activate('s1', ['data.cloud']);
    activations.activate('s2', ['data.authoring']);

    expect([...activations.activePacks('s1')].sort()).toEqual(['data.cloud']);
    expect([...activations.activePacks('s2')]).toEqual(['data.authoring']);

    activations.clear('s1');
    expect(activations.activePacks('s1').size).toBe(0);
    expect([...activations.activePacks('s2')]).toEqual(['data.authoring']);
  });
});

describe('capabilities_search', () => {
  const execute = (tool: ReturnType<typeof createCapabilitiesSearchTool>, params: unknown) =>
    tool.execute(
      'call-1',
      params,
      new AbortController().signal,
      async () => undefined,
      undefined as never
    );
  const textOf = (result: Awaited<ReturnType<typeof execute>>): string =>
    result.content.map((block) => ('text' in block ? block.text : '')).join('\n');

  it('lists packs when the query matches nothing', async () => {
    const tool = createCapabilitiesSearchTool({
      getPacks: () => DATA_TOOL_PACKS,
      activateTools: vi.fn(() => ({ activated: [], unknown: [] })),
    });
    const result = await execute(tool, { query: 'zzz-no-match' });
    const text = textOf(result);
    expect(text).toContain('data.core');
    expect(text).toContain('data.authoring');
    expect(text).toContain('{"pack"');
  });

  it('activates a named pack through the callback', async () => {
    const activateTools = vi.fn((names: string[]) => ({ activated: names, unknown: [] }));
    const tool = createCapabilitiesSearchTool({
      getPacks: () => DATA_TOOL_PACKS,
      activateTools,
    });
    const result = await execute(tool, { pack: 'data.authoring' });
    expect(activateTools).toHaveBeenCalledWith([...DATA_TOOL_PACKS['data.authoring'].tools]);
    expect(textOf(result)).toContain('data_apply_workflow_plan');
    expect(result.details).toMatchObject({ pack: 'data.authoring' });
  });

  it('activates all query-matched packs', async () => {
    const activateTools = vi.fn((names: string[]) => ({ activated: names, unknown: [] }));
    const tool = createCapabilitiesSearchTool({
      getPacks: () => DATA_TOOL_PACKS,
      activateTools,
    });
    const result = await execute(tool, { query: 'cloud' });
    expect(activateTools).toHaveBeenCalledWith(
      expect.arrayContaining([...DATA_TOOL_PACKS['data.cloud'].tools])
    );
    expect(textOf(result)).toContain('data.cloud');
  });
});
