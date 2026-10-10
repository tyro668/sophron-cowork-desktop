// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from './i18n-test';
import { WorkflowAiGenerateDialog } from '../../src/renderer/components/data-view/data-pipelines/workflow/WorkflowAiGenerateDialog';
const startSession = vi.hoisted(() => vi.fn());
const getSessionMessages = vi.hoisted(() => vi.fn());
vi.mock('../../src/renderer/hooks/useIPC', () => ({
  useIPC: () => ({ startSession, getSessionMessages }),
}));
afterEach(cleanup);
beforeEach(async () => {
  vi.resetAllMocks();
  startSession.mockResolvedValue({ id: 'chat' });
  getSessionMessages.mockResolvedValue([]);
  await i18n.changeLanguage('zh');
});
describe('workflow conversation authoring', () => {
  it('carries the unsaved canvas and anchor as structured bindings', async () => {
    const workflow = { nodes: [], edges: [] };
    render(
      <WorkflowAiGenerateDialog
        open
        pipelineId="pipeline"
        boundRawTable={{ id: 'input', name: 'Sales' }}
        anchorNode={{ id: 'filter', label: '筛选', type: 'filter' }}
        draftWorkflow={workflow}
        hasExistingNodes
        isCanvasDirty
        onOpenChange={vi.fn()}
      />
    );
    expect(screen.getByText(/将以所选算子「筛选」为起点继续生成/)).toBeTruthy();
    const composer = screen.getByPlaceholderText(/描述想要的处理流程/);
    fireEvent.change(composer, { target: { value: '汇总销售额' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    await waitFor(() => expect(startSession).toHaveBeenCalledOnce());
    expect(startSession.mock.calls[0][1][1]).toMatchObject({
      type: 'data_pipeline_request',
      request: {
        reusePipelineId: 'pipeline',
        startFromNodeId: 'filter',
        workflow,
        source: { tableId: 'input' },
      },
    });
  });
  it('keeps the replacement warning when generating without an anchor', () => {
    render(
      <WorkflowAiGenerateDialog
        open
        pipelineId="pipeline"
        boundRawTable={{ id: 'input', name: 'Sales' }}
        hasExistingNodes
        onOpenChange={vi.fn()}
      />
    );
    expect(screen.getByText(/生成将替换当前画布上的流程/)).toBeTruthy();
  });
});
