// @vitest-environment happy-dom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from './i18n-test';
import { DataPipelineAiGenerateDialog } from '../../src/renderer/components/data-view/data-pipelines/DataPipelineAiGenerateDialog';
import {
  DataProcessActionEditor,
  ActionChainSection,
} from '../../src/renderer/components/settings/schedule/action-config-editors';
import { useAppStore } from '../../src/renderer/store';
import type {
  AutomationActionNode,
  DataPipeline,
  DataDashboard,
  DataGeneratePipelineFromRequirementResult,
} from '../../src/renderer/types';

vi.mock('../../src/renderer/components/LlmPromptComposer', () => ({
  LlmPromptComposer: ({
    value,
    onChange,
    disabled,
    onSubmit,
    submitDisabled,
  }: {
    value: string;
    onChange: (value: string) => void;
    disabled: boolean;
    onSubmit?: () => void;
    submitDisabled?: boolean;
  }) => (
    <>
      <textarea
        aria-label="requirement"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" onClick={onSubmit} disabled={submitDisabled}>
        发送
      </button>
    </>
  ),
}));
vi.mock('../../src/renderer/components/GlassSelect', () => ({
  GlassSelect: ({
    value,
    options,
    onValueChange,
  }: {
    value: string;
    options: Array<{ value: string; label: string }>;
    onValueChange: (value: string) => void;
  }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
const startSession = vi.hoisted(() => vi.fn());
const getSessionMessages = vi.hoisted(() => vi.fn());
vi.mock('../../src/renderer/hooks/useIPC', () => ({
  useIPC: () => ({ startSession, getSessionMessages }),
}));
const analyze = vi.fn();
const generate = vi.fn();
const getDashboard = vi.fn();
const result: DataGeneratePipelineFromRequirementResult = {
  pipelineId: 'generated',
  pipelineName: 'Sales processing',
  resultTableId: 'output',
  resultTableName: 'Sales result',
  workflowDslAvailable: true,
  requiredColumns: [],
  expectedOutputSchema: [],
  lineage: [],
  columnsSnapshot: [],
  sourceSummaryHash: 's',
  workflowHash: 'w',
  version: 1,
  generatedAt: 1,
};
const supported = {
  status: 'supported',
  analysisId: 'receipt',
  items: [{ requirement: 'Filter sales', status: 'supported', operations: ['filter'] }],
};
const rawTables = [{ id: 'input', name: 'Sales' }] as DataDashboard['rawTables'];
const pipelines = [
  { id: 'existing', name: 'Existing pipeline', sourceRawTableId: 'input' },
] as DataPipeline[];
const tr = (key: string, fallback: string) => i18n.t(key, { defaultValue: fallback });
beforeEach(async () => {
  vi.resetAllMocks();
  await i18n.changeLanguage('zh');
  useAppStore.setState({
    appConfig: { activeConfigSetId: 'model-config' } as never,
    sessionStates: {},
    workingDir: '/workspace',
  });
  startSession.mockResolvedValue({ id: 'chat' });
  getSessionMessages.mockResolvedValue([]);
  (window as { electronAPI?: unknown }).electronAPI = {
    data: {
      analyzePipelineRequirement: analyze,
      generatePipelineFromRequirement: generate,
      getDashboard,
    },
  };
  analyze.mockResolvedValue(supported);
  generate.mockResolvedValue(result);
  getDashboard.mockResolvedValue({ rawTables: rawTables });
});
afterEach(cleanup);

async function sendToChat() {
  fireEvent.change(screen.getByLabelText('requirement'), { target: { value: 'Filter sales' } });
  fireEvent.click(screen.getByText('发送'));
  await waitFor(() => expect(startSession).toHaveBeenCalledOnce());
  return startSession.mock.calls[0][1][1].request;
}
function complete(requestId: string, isError = false) {
  act(() =>
    useAppStore.getState().addMessage('chat', {
      id: crypto.randomUUID(),
      sessionId: 'chat',
      role: 'assistant',
      timestamp: 1,
      content: [
        {
          type: 'tool_result',
          toolUseId: 'generate',
          content: 'Saved',
          isError,
          dataPipelineCompletion: { requestId, result },
        },
      ],
    })
  );
}

function AutomationEditor({
  initial,
  changed = () => {},
  generated = () => {},
}: {
  initial: AutomationActionNode;
  changed?: (node: AutomationActionNode) => void;
  generated?: (available: boolean) => void;
}) {
  const [node, setNode] = useState(initial);
  return (
    <DataProcessActionEditor
      node={node}
      dataPipelines={pipelines}
      rawTables={rawTables}
      tr={tr}
      onChange={(next) => {
        setNode(next);
        changed(next);
      }}
      onGeneratedPipelineSuccess={generated}
    />
  );
}

describe('shared data-pipeline authoring', () => {
  it('passes selected bindings into a project conversation and refreshes from its saved result', async () => {
    const applied = vi.fn();
    render(
      <DataPipelineAiGenerateDialog
        open
        boundRawTable={{ id: 'input', name: 'Sales' }}
        onApplied={applied}
        onOpenChange={vi.fn()}
      />
    );
    const request = await sendToChat();
    expect(request).toMatchObject({
      source: { location: 'local', tableId: 'input' },
      output: { location: 'local', writeMode: 'create' },
    });
    expect(startSession.mock.calls[0][2]).toBe('/workspace');
    expect(analyze).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    complete('unrelated');
    expect(applied).not.toHaveBeenCalled();
    complete(request.id);
    await waitFor(() =>
      expect(applied).toHaveBeenCalledWith(
        result,
        expect.objectContaining({ source: request.source })
      )
    );
  });
  it('loads all input pages when no table is preselected', async () => {
    getDashboard
      .mockResolvedValueOnce({
        rawTables: Array.from({ length: 200 }, (_, i) => ({ id: `i${i}`, name: `Input ${i}` })),
      })
      .mockResolvedValueOnce({ rawTables: [{ id: 'last', name: 'Last' }] });
    render(<DataPipelineAiGenerateDialog open onOpenChange={vi.fn()} />);
    await waitFor(() => expect(getDashboard).toHaveBeenCalledTimes(2));
    expect(getDashboard.mock.calls[1][0].rawTableOffset).toBe(200);
    expect((screen.getByText('发送') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('automation pipeline references', () => {
  it('selects an existing pipeline and removes previous source/output/schema bindings', () => {
    const changed = vi.fn();
    render(
      <AutomationEditor
        changed={changed}
        initial={{
          id: 'action',
          type: 'cloud.table.process',
          enabled: true,
          config: {
            pipelineId: 'old',
            pipelineName: 'Old pipeline',
            source: { tableId: 'wrong' },
            output: { location: 'local' },
            requiredColumns: [{ name: 'oldColumn' }],
            workflowHash: 'old',
          },
        }}
      />
    );
    // 处理方式 is a full-width dropdown (复用数据加工 / AI 生成加工); the pipeline select follows it.
    expect(screen.getByText('处理方式')).toBeTruthy();
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'existing' } });
    expect(changed).toHaveBeenCalledWith({
      id: 'action',
      type: 'data.pipeline.run',
      enabled: true,
      label: '',
      config: {
        pipelineId: 'existing',
        pipelineName: 'Existing pipeline',
        outputMode: 'persisted',
      },
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it('uses the project conversation and binds only its successful persisted result', async () => {
    const changed = vi.fn();
    const generated = vi.fn();
    render(
      <AutomationEditor
        changed={changed}
        generated={generated}
        initial={{
          id: 'action',
          type: 'data.pipeline.run',
          enabled: true,
          config: { pipelineId: 'existing', outputMode: 'temporary' },
        }}
      />
    );
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'ai' } });
    fireEvent.click(screen.getByText('AI 生成数据加工'));
    const request = await sendToChat();
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          pipelineId: 'existing',
          generationSessionId: 'chat',
          generationRequestId: request.id,
        }),
      })
    );
    complete('unrelated');
    complete(request.id, true);
    expect(generated).not.toHaveBeenCalled();
    complete(request.id);
    await waitFor(() => expect(generated).toHaveBeenCalledWith(true));
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'data.pipeline.run',
        config: {
          pipelineId: 'generated',
          pipelineName: 'Sales processing',
          outputMode: 'temporary',
        },
      })
    );
  });
  it('does not replace a pipeline the user selected while the authoring chat was running', async () => {
    const changed = vi.fn();
    const generated = vi.fn();
    render(
      <AutomationEditor
        changed={changed}
        generated={generated}
        initial={{
          id: 'action',
          type: 'data.pipeline.run',
          enabled: true,
          config: { pipelineId: 'existing' },
        }}
      />
    );
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'ai' } });
    fireEvent.click(screen.getByText('AI 生成数据加工'));
    const request = await sendToChat();
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'pipeline' } });
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'existing' } });
    complete(request.id);
    expect(generated).not.toHaveBeenCalled();
    expect(changed.mock.calls.at(-1)?.[0].config.pipelineId).toBe('existing');
  });
  it('leaves the old binding intact when starting the conversation fails', async () => {
    startSession.mockRejectedValue(new Error('Cannot start'));
    const changed = vi.fn();
    render(
      <AutomationEditor
        changed={changed}
        initial={{
          id: 'action',
          type: 'data.pipeline.run',
          enabled: true,
          config: { pipelineId: 'existing' },
        }}
      />
    );
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'ai' } });
    fireEvent.click(screen.getByText('AI 生成数据加工'));
    fireEvent.change(screen.getByLabelText('requirement'), { target: { value: 'Filter sales' } });
    fireEvent.click(screen.getByText('发送'));
    await screen.findByText('Cannot start');
    expect(changed).not.toHaveBeenCalled();
  });

  it('adds a data processing action as a saved-pipeline reference by default', async () => {
    const changed = vi.fn();
    render(
      <ActionChainSection
        draft={{ actionGraph: { version: 1, nodes: [], edges: [] } } as never}
        actionDefinitions={[{ type: 'data.pipeline.run' }] as never}
        dataPipelines={pipelines}
        rawTables={rawTables}
        resultTables={[]}
        appConfig={null}
        onDraftChange={changed}
        onGeneratedPipelineSuccess={vi.fn()}
        tr={tr}
      />
    );
    fireEvent.keyDown(screen.getByText('添加动作'), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByText('数据处理'));
    expect(changed.mock.calls[0][0].actionGraph.nodes[0]).toMatchObject({
      type: 'data.pipeline.run',
      config: { pipelineId: '', outputMode: 'persisted' },
    });
  });
});
