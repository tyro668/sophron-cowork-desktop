import { describe, expect, it, vi } from 'vitest';
import { createDataAgentRuntimeExtension } from '../src/main/data/data-agent-extension';
import type { DataToolService } from '../src/main/data/data-tool-service';
import type { Session } from '../src/renderer/types';

describe('data agent extension', () => {
  it('injects prompt prefix and data custom tools before a session run', async () => {
    const resolveConversationContext = vi.fn(async () => ({
      sessionId: 'session-1',
      workspacePath: '/tmp/workspace',
      capabilities: {
        canCreateInputTable: true,
        canCreateOutputTable: true,
        canCreateTask: true,
        canRunTask: true,
        canImportLocalFiles: true,
      },
    }));
    const updateExecutionContext = vi.fn();
    const service = {
      resolveConversationContext,
      updateExecutionContext,
    } as unknown as DataToolService;
    const extension = createDataAgentRuntimeExtension(service);
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

    const result = await extension.beforeSessionRun?.({
      session,
      prompt: '创建一个固定数据处理流程',
      existingMessages: [],
      isColdStart: true,
    });

    expect(resolveConversationContext).toHaveBeenCalledWith(
      expect.objectContaining({ session, prompt: '创建一个固定数据处理流程' })
    );
    expect(updateExecutionContext).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1' })
    );
    expect(result?.promptPrefix).toContain('data_* tools');
    expect(result?.customTools?.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'data_create_input_table',
        'data_create_input_table_with_processing_strategy',
        'data_create_output_table',
        'data_analyze_task_requirement',
        'data_generate_task_from_requirement',
        'data_run_task',
      ])
    );
    expect(result?.customTools?.map((tool) => tool.name)).not.toEqual(
      expect.arrayContaining([
        'data_get_workflow_dsl_reference',
        'data_create_task',
        'data_apply_workflow_dsl',
        'data_apply_operator_dsl',
      ])
    );
  });
});
