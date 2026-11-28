// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from './i18n-test';
import { useAppStore } from '../../src/renderer/store';
import { WorkflowAiGenerateDialog } from '../../src/renderer/components/data-view/data-pipelines/workflow/WorkflowAiGenerateDialog';

const startSession = vi.hoisted(() => vi.fn());
const getSessionMessages = vi.hoisted(() => vi.fn());
vi.mock('../../src/renderer/hooks/useIPC', () => ({
  useIPC: () => ({ startSession, getSessionMessages }),
}));

const switchSet = vi.hoisted(() => vi.fn());
const selectBuiltinModel = vi.hoisted(() => vi.fn());

afterEach(() => {
  cleanup();
  delete (window as { electronAPI?: unknown }).electronAPI;
});

beforeEach(async () => {
  vi.resetAllMocks();
  startSession.mockResolvedValue({ id: 'chat' });
  getSessionMessages.mockResolvedValue([]);
  switchSet.mockResolvedValue({
    success: true,
    config: {
      activeConfigSetId: 'set-b',
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      isConfigured: true,
      configSets: [],
    },
  });
  selectBuiltinModel.mockResolvedValue({ success: true, config: { isConfigured: true } });
  useAppStore.setState({
    appConfig: {
      provider: 'openai',
      model: 'gpt-5.4',
      activeConfigSetId: 'set-a',
      isConfigured: true,
      configSets: [
        {
          id: 'set-a',
          name: 'OpenAI Default',
          provider: 'openai',
          activeProfileKey: 'openai',
          profiles: { openai: { model: 'gpt-5.4', apiKey: 'sk-a' } },
        },
        {
          id: 'set-b',
          name: 'Claude Work',
          provider: 'anthropic',
          activeProfileKey: 'anthropic',
          profiles: { anthropic: { model: 'claude-sonnet-4-6', apiKey: 'sk-b' } },
        },
      ],
    } as never,
  });
  await i18n.changeLanguage('zh');
});

describe('workflow conversation authoring', () => {
  it('carries the unsaved canvas, anchor, and default model as structured bindings', async () => {
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
    expect(screen.getByText('Sales')).toBeTruthy();
    expect(screen.getByText('模型')).toBeTruthy();
    expect(screen.getByTitle('gpt-5.4')).toBeTruthy();
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
    expect(startSession.mock.calls[0][3]).toEqual({ modelConfigSetId: 'set-a' });
  });

  it('lets the user pick a model and submits via the flush footer action', async () => {
    (window as { electronAPI?: unknown }).electronAPI = {
      config: {
        switchSet,
        selectBuiltinModel,
        listModels: vi.fn().mockResolvedValue([]),
      },
    };
    render(
      <WorkflowAiGenerateDialog
        open
        pipelineId="pipeline"
        boundRawTable={{ id: 'input', name: 'Sales' }}
        onOpenChange={vi.fn()}
      />
    );

    const submitButton = screen.getByTestId('data-pipeline-ai-submit') as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);

    // Open the model dropdown and pick the second custom config set.
    const modelTrigger = screen.getByTitle('gpt-5.4');
    fireEvent.pointerDown(modelTrigger, { button: 0, ctrlKey: false });
    const claudeItem = await screen.findByText('claude-sonnet-4-6');
    fireEvent.click(claudeItem);

    expect(screen.getByTitle('claude-sonnet-4-6')).toBeTruthy();
    // Choosing a model in the dialog does not mutate global config until submitted.
    expect(switchSet).not.toHaveBeenCalled();

    const composer = screen.getByPlaceholderText(/描述想要的处理流程/);
    fireEvent.change(composer, { target: { value: '按地区统计销量' } });
    expect(submitButton.disabled).toBe(false);
    fireEvent.click(submitButton);

    await waitFor(() => expect(startSession).toHaveBeenCalledOnce());
    expect(switchSet).toHaveBeenCalledWith({ id: 'set-b' });
    expect(startSession.mock.calls[0][3]).toEqual({ modelConfigSetId: 'set-b' });
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
