import { describe, expect, it, vi } from 'vitest';
import { createDataAgentRuntimeExtension } from '../src/main/data/data-agent-extension';
import { DATA_TOOL_PACKS } from '../src/main/data/data-tool-packs';
import type { DataToolService } from '../src/main/data/data-tool-service';
import type { Session } from '../src/renderer/types';

const ALL_DATA_TOOLS = [
  ...new Set(Object.values(DATA_TOOL_PACKS).flatMap((pack) => [...pack.tools])),
];
const CORE_TOOLS = [...DATA_TOOL_PACKS['data.core'].tools];

function createService() {
  return {
    resolveConversationContext: vi.fn(async () => ({
      sessionId: 'session-1',
      workspacePath: '/tmp/workspace',
      capabilities: {
        canCreateRawTable: true,
        canCreateResultTable: true,
        canCreatePipeline: true,
        canRunPipeline: true,
        canImportLocalFiles: true,
      },
    })),
    updateExecutionContext: vi.fn(),
    hasPendingAnalysis: vi.fn(() => false),
    hasSupportedAnalysis: vi.fn(() => true),
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
  it('keeps analysis available for short clarification replies without domain keywords', async () => {
    const service = createService();
    vi.mocked(service.hasPendingAnalysis).mockReturnValue(true);
    vi.mocked(service.hasSupportedAnalysis).mockReturnValue(false);
    const extension = createDataAgentRuntimeExtension(service);
    const result = await extension.beforeSessionRun?.({
      session,
      prompt: 'region 就是省份',
      existingMessages: [],
      isColdStart: true,
    });
    expect(result?.activateTools).toContain('data_analyze_pipeline_requirement');
    const confirmed = await extension.beforeSessionRun?.({
      session,
      prompt: '好的',
      existingMessages: [],
      isColdStart: false,
    });
    expect(confirmed?.activateTools).toEqual([...DATA_TOOL_PACKS['data.generate'].tools]);
  });

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

  it('retains packs for explicit continuation, then releases them on topic change', async () => {
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
    expect(second?.activateTools).toContain('data_run_pipeline');
    // Unrelated packs stay off — sticky must not expand to everything.
    expect(second?.activateTools).not.toContain('data_apply_workflow_plan');
    const unrelated = await extension.beforeSessionRun?.({
      session,
      prompt: '写一首秋天的诗',
      existingMessages: [],
      isColdStart: false,
    });
    expect(unrelated?.activateTools).toEqual([]);
    expect(unrelated?.stablePrompt).toBeUndefined();
    const continuePoem = await extension.beforeSessionRun?.({
      session,
      prompt: '继续',
      existingMessages: [],
      isColdStart: false,
    });
    expect(continuePoem?.activateTools).toEqual([]);
  });
  it('keeps known-pipeline runs below the schema budget and separates business creation from expert tools', async () => {
    const extension = createDataAgentRuntimeExtension(createService());
    const run = await extension.beforeSessionRun?.({
      session,
      prompt: '运行数据任务 pipelineId=known',
      existingMessages: [],
      isColdStart: true,
    });
    expect(run?.activateTools).toEqual(['data_run_pipeline']);
    const schemaText = JSON.stringify(
      run?.customTools
        ?.filter((tool) => run.activateTools?.includes(tool.name))
        .map(({ name, description, parameters }) => ({ name, description, parameters }))
    );
    expect(schemaText.length).toBeLessThan(2000);
    const create = await extension.beforeSessionRun?.({
      session,
      prompt: '创建数据任务：筛选金额大于100的记录',
      existingMessages: [],
      isColdStart: false,
    });
    expect(create?.activateTools).toContain('data_analyze_pipeline_requirement');
    expect(create?.activateTools).not.toContain('data_apply_workflow_dsl');
    expect(create?.activateTools).not.toContain('data_apply_workflow_plan');
    const createSchemas = JSON.stringify(
      create?.customTools
        ?.filter((tool) => create.activateTools?.includes(tool.name))
        .map(({ name, description, parameters }) => ({ name, description, parameters }))
    );
    expect(createSchemas.length).toBeLessThan(37910 * 0.3);
  });

  it('exposes generation for a pending analysis confirmation without expert tools', async () => {
    const service = createService();
    vi.mocked(service.hasPendingAnalysis).mockReturnValue(true);
    const extension = createDataAgentRuntimeExtension(service);
    const confirmed = await extension.beforeSessionRun?.({
      session,
      prompt: '确认',
      existingMessages: [],
      isColdStart: true,
    });
    expect(confirmed?.activateTools).toEqual([...DATA_TOOL_PACKS['data.generate'].tools]);
    expect(confirmed?.activateTools).not.toContain('data_apply_workflow_plan');
    const unrelated = await extension.beforeSessionRun?.({
      session,
      prompt: '帮我写诗',
      existingMessages: [],
      isColdStart: false,
    });
    expect(unrelated?.activateTools).toEqual([]);
  });
});
