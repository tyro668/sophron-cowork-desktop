// @vitest-environment happy-dom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from './i18n-test';
import { DataTaskAiGenerateDialog } from '../../src/renderer/components/data-view/data-tasks/DataTaskAiGenerateDialog';
import {
  DataProcessActionEditor,
  ActionChainSection,
} from '../../src/renderer/components/settings/schedule/action-config-editors';
import { useAppStore } from '../../src/renderer/store';
import type {
  AutomationActionNode,
  DataCleaningTask,
  DataDashboard,
  DataGenerateTaskFromRequirementResult,
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
const result: DataGenerateTaskFromRequirementResult = {
  taskId: 'generated',
  taskName: 'Sales processing',
  outputTableId: 'output',
  outputTableName: 'Sales result',
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
const inputTables = [{ id: 'input', name: 'Sales' }] as DataDashboard['datasets'];
const tasks = [
  { id: 'existing', name: 'Existing task', sourceDatasetId: 'input' },
] as DataCleaningTask[];
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
    data: { analyzeTaskRequirement: analyze, generateTaskFromRequirement: generate, getDashboard },
  };
  analyze.mockResolvedValue(supported);
  generate.mockResolvedValue(result);
  getDashboard.mockResolvedValue({ datasets: inputTables });
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
          dataTaskCompletion: { requestId, result },
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
      dataTasks={tasks}
      inputTables={inputTables}
      tr={tr}
      onChange={(next) => {
        setNode(next);
        changed(next);
      }}
      onGeneratedTaskSuccess={generated}
    />
  );
}

describe('shared data-task authoring', () => {
  it('passes selected bindings into a project conversation and refreshes from its saved result', async () => {
    const applied = vi.fn();
    render(
      <DataTaskAiGenerateDialog
        open
        boundInputTable={{ id: 'input', name: 'Sales' }}
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
        datasets: Array.from({ length: 200 }, (_, i) => ({ id: `i${i}`, name: `Input ${i}` })),
      })
      .mockResolvedValueOnce({ datasets: [{ id: 'last', name: 'Last' }] });
    render(<DataTaskAiGenerateDialog open onOpenChange={vi.fn()} />);
    await waitFor(() => expect(getDashboard).toHaveBeenCalledTimes(2));
    expect(getDashboard.mock.calls[1][0].datasetOffset).toBe(200);
    expect((screen.getByText('发送') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('automation task references', () => {
  it('selects an existing task and removes previous source/output/schema bindings', () => {
    const changed = vi.fn();
    render(
      <AutomationEditor
        changed={changed}
        initial={{
          id: 'action',
          type: 'cloud.table.process',
          enabled: true,
          config: {
            taskId: 'old',
            taskName: 'Old task',
            source: { tableId: 'wrong' },
            output: { location: 'local' },
            requiredColumns: [{ name: 'oldColumn' }],
            workflowHash: 'old',
          },
        }}
      />
    );
    expect(screen.queryByText('处理方式')).toBeNull();
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'existing' } });
    expect(changed).toHaveBeenCalledWith({
      id: 'action',
      type: 'data.task.run',
      enabled: true,
      label: '',
      config: { taskId: 'existing', taskName: 'Existing task', outputMode: 'persisted' },
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
          type: 'data.task.run',
          enabled: true,
          config: { taskId: 'existing', outputMode: 'temporary' },
        }}
      />
    );
    fireEvent.click(screen.getByText('AI 生成数据任务'));
    const request = await sendToChat();
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          taskId: 'existing',
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
        type: 'data.task.run',
        config: { taskId: 'generated', taskName: 'Sales processing', outputMode: 'temporary' },
      })
    );
  });
  it('does not replace a task the user selected while the authoring chat was running', async () => {
    const changed = vi.fn();
    const generated = vi.fn();
    render(
      <AutomationEditor
        changed={changed}
        generated={generated}
        initial={{
          id: 'action',
          type: 'data.task.run',
          enabled: true,
          config: { taskId: 'existing' },
        }}
      />
    );
    fireEvent.click(screen.getByText('AI 生成数据任务'));
    const request = await sendToChat();
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'existing' } });
    complete(request.id);
    expect(generated).not.toHaveBeenCalled();
    expect(changed.mock.calls.at(-1)?.[0].config.taskId).toBe('existing');
  });
  it('leaves the old binding intact when starting the conversation fails', async () => {
    startSession.mockRejectedValue(new Error('Cannot start'));
    const changed = vi.fn();
    render(
      <AutomationEditor
        changed={changed}
        initial={{
          id: 'action',
          type: 'data.task.run',
          enabled: true,
          config: { taskId: 'existing' },
        }}
      />
    );
    fireEvent.click(screen.getByText('AI 生成数据任务'));
    fireEvent.change(screen.getByLabelText('requirement'), { target: { value: 'Filter sales' } });
    fireEvent.click(screen.getByText('发送'));
    await screen.findByText('Cannot start');
    expect(changed).not.toHaveBeenCalled();
  });

  it('adds a data processing action as a saved-task reference by default', async () => {
    const changed = vi.fn();
    render(
      <ActionChainSection
        draft={{ actionGraph: { version: 1, nodes: [], edges: [] } } as never}
        actionDefinitions={[{ type: 'data.task.run' }] as never}
        dataTasks={tasks}
        inputTables={inputTables}
        outputTables={[]}
        appConfig={null}
        onDraftChange={changed}
        onGeneratedTaskSuccess={vi.fn()}
        tr={tr}
      />
    );
    fireEvent.keyDown(screen.getByText('添加动作'), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByText('数据处理'));
    expect(changed.mock.calls[0][0].actionGraph.nodes[0]).toMatchObject({
      type: 'data.task.run',
      config: { taskId: '', outputMode: 'persisted' },
    });
  });
});
