import { describe, expect, it, vi } from 'vitest';
import { createDataAgentRuntimeExtension } from '../src/main/data/data-agent-extension';
import { DATA_TOOL_PACKS } from '../src/main/data/data-tool-packs';
import type { DataToolService } from '../src/main/data/data-tool-service';
import type { Session } from '../src/renderer/types';

const ALL_DATA_TOOLS = Object.values(DATA_TOOL_PACKS).flatMap((pack) => [...pack.tools]);
const CORE_TOOLS = [...DATA_TOOL_PACKS['data.core'].tools];

function createService() {
  return {
    resolveConversationContext: vi.fn(async () => ({
      sessionId: 'session-1',
      workspacePath: '/tmp/workspace',
      capabilities: {
        canCreateInputTable: true,
        canCreateOutputTable: true,
        canCreateTask: true,
        canRunTask: true,
        canImportLocalFiles: true,
      },
    })),
    updateExecutionContext: vi.fn(),
    hasPendingAnalysis: vi.fn(() => false),
    clearConversationContext: vi.fn(),
  } as unknown as DataToolService;
}

const session: Session = {
  id: 'session-1',
  title: 'Data chat',
  status: 'idle',
  cwd: '/tmp/workspace',
  mountedPaths: [],
  allowedTools: [],
  memoryEnabled: false,
  createdAt: 1,
  updatedAt: 1,
};

describe('data agent extension', () => {
  it('registers the full catalog but activates only intent-scoped packs', async () => {
    const service = createService();
    const extension = createDataAgentRuntimeExtension(service);

    const result = await extension.beforeSessionRun?.({
      session,
      prompt: '帮我列出所有数据表',
      existingMessages: [],
      isColdStart: true,
    });

    expect(service.resolveConversationContext).toHaveBeenCalledWith(
      expect.objectContaining({ session, prompt: '帮我列出所有数据表' })
    );
    expect(service.updateExecutionContext).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1' })
    );
    // Stable rules + per-turn state are separate channels now.
    expect(result?.stablePrompt).toContain('data_*');
    expect(result?.statePrompt).toBeTruthy();
    // The whole catalog is registered so later packs can activate mid-session…
    expect(new Set(result?.customTools?.map((tool) => tool.name))).toEqual(new Set(ALL_DATA_TOOLS));
    // …but only the core pack is exposed for a generic data request.
    expect(new Set(result?.activateTools)).toEqual(new Set(CORE_TOOLS));
    expect(result?.activateTools).not.toContain('data_apply_workflow_dsl');
    expect(result?.activateTools).not.toContain('data_import_cloud_table');
    expect(result?.toolPacks).toBe(DATA_TOOL_PACKS);
  });

  it('exposes no data tools for unrelated chat', async () => {
    const service = createService();
    const extension = createDataAgentRuntimeExtension(service);

    const result = await extension.beforeSessionRun?.({
      session,
      prompt: '帮我写一首关于秋天的诗',
      existingMessages: [],
      isColdStart: true,
    });

    expect(result?.activateTools).toEqual([]);
    expect(result?.stablePrompt).toBeUndefined();
    expect(result?.statePrompt).toBeUndefined();
    // Catalog still registered for capabilities_search discovery.
    expect(result?.customTools?.length).toBe(ALL_DATA_TOOLS.length);
  });

  it('keeps packs sticky across turns once activated', async () => {
    const service = createService();
    const extension = createDataAgentRuntimeExtension(service);

    // Turn 1: cloud intent activates data.core + data.cloud.
    const first = await extension.beforeSessionRun?.({
      session,
      prompt: '把云端的个人分析表导入进来',
      existingMessages: [],
      isColdStart: true,
    });
    expect(first?.activateTools).toContain('data_import_cloud_table');

    // Turn 2: no data keywords in the prompt, but the sticky packs persist.
    const second = await extension.beforeSessionRun?.({
      session,
      prompt: '继续',
      existingMessages: [],
      isColdStart: false,
    });
    expect(second?.activateTools).toContain('data_import_cloud_table');
    expect(second?.activateTools).toContain('data_run_task');
    // Unrelated packs stay off — sticky must not expand to everything.
    expect(second?.activateTools).not.toContain('data_apply_workflow_plan');
  });
});
