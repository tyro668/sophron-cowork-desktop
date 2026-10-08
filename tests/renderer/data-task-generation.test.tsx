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
  }: {
    value: string;
    onChange: (value: string) => void;
    disabled: boolean;
  }) => (
    <textarea
      aria-label="requirement"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
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
  useAppStore.setState({ appConfig: { activeConfigSetId: 'model-config' } as never });
  (window as { electronAPI?: unknown }).electronAPI = {
    data: { analyzeTaskRequirement: analyze, generateTaskFromRequirement: generate, getDashboard },
  };
  analyze.mockResolvedValue(supported);
  generate.mockResolvedValue(result);
  getDashboard.mockResolvedValue({ datasets: inputTables });
});
afterEach(cleanup);

async function generateFromDialog() {
  fireEvent.change(screen.getByLabelText('requirement'), { target: { value: 'Filter sales' } });
  fireEvent.click(screen.getByText('分析可行性'));
  await screen.findByText('可生成');
  fireEvent.click(screen.getByText('生成并保存任务'));
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
  it('creates a reusable task from the selected table using the confirmed analysis', async () => {
    const applied = vi.fn();
    render(
      <DataTaskAiGenerateDialog
        open
        boundInputTable={{ id: 'input', name: 'Sales' }}
        onApplied={applied}
        onOpenChange={vi.fn()}
      />
    );
    expect(screen.getByText(/Sales/)).toBeTruthy();
    await generateFromDialog();
    await waitFor(() =>
      expect(applied).toHaveBeenCalledWith(
        result,
        expect.objectContaining({
          source: { location: 'local', tableId: 'input', tableName: 'Sales' },
          analysisId: 'receipt',
          reuseTaskId: undefined,
          modelConfigSetId: 'model-config',
          output: { location: 'local', writeMode: 'create', tableName: undefined },
        })
      )
    );
    expect(generate.mock.calls[0][0].usageTraceId).toBe(analyze.mock.calls[0][0].usageTraceId);
  });

  it('invalidates the receipt when output requirements change', async () => {
    render(
      <DataTaskAiGenerateDialog
        open
        boundInputTable={{ id: 'input', name: 'Sales' }}
        onApplied={vi.fn()}
        onOpenChange={vi.fn()}
      />
    );
    fireEvent.change(screen.getByLabelText('requirement'), { target: { value: 'Filter sales' } });
    fireEvent.click(screen.getByText('分析可行性'));
    await screen.findByText('可生成');
    fireEvent.change(screen.getByLabelText('结果表名（留空自动生成）'), {
      target: { value: 'Other output' },
    });
    expect((screen.getByText('生成并保存任务') as HTMLButtonElement).disabled).toBe(true);
    expect(generate).not.toHaveBeenCalled();
  });

  it('loads all input pages when no table is preselected', async () => {
    getDashboard
      .mockResolvedValueOnce({
        datasets: Array.from({ length: 200 }, (_, i) => ({ id: `i${i}`, name: `Input ${i}` })),
      })
      .mockResolvedValueOnce({ datasets: [{ id: 'last', name: 'Last input' }] });
    render(<DataTaskAiGenerateDialog open onApplied={vi.fn()} onOpenChange={vi.fn()} />);
    await waitFor(() => expect(getDashboard).toHaveBeenCalledTimes(2));
    expect(getDashboard.mock.calls[1][0].datasetOffset).toBe(200);
    expect((screen.getByText('分析可行性') as HTMLButtonElement).disabled).toBe(true);
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

  it('invokes the same authoring dialog and binds only after the task is saved', async () => {
    const changed = vi.fn();
    const generated = vi.fn();
    let resolve!: (value: DataGenerateTaskFromRequirementResult) => void;
    generate.mockReturnValue(
      new Promise<DataGenerateTaskFromRequirementResult>((done) => {
        resolve = done;
      })
    );
    render(
      <AutomationEditor
        changed={changed}
        generated={generated}
        initial={{
          id: 'action',
          type: 'data.task.run',
          enabled: true,
          config: { taskId: 'existing', outputMode: 'persisted' },
        }}
      />
    );
    fireEvent.click(screen.getByText('AI 生成数据任务'));
    expect(screen.getByText(i18n.t('data.workflow.aiInputBound', { name: 'Sales' }))).toBeTruthy();
    await generateFromDialog();
    expect(changed).not.toHaveBeenCalled();
    await act(async () => resolve(result));
    expect(changed).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'data.task.run',
        config: { taskId: 'generated', taskName: 'Sales processing', outputMode: 'persisted' },
      })
    );
    expect(generated).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('option', { name: 'Sales processing' })).toBeTruthy();
  });

  it('retains the existing task when generation fails or is cancelled', async () => {
    const changed = vi.fn();
    generate.mockRejectedValue(new Error('Generation unavailable'));
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
    await generateFromDialog();
    await screen.findByText('Generation unavailable');
    expect(changed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('取消'));
    expect(screen.queryByRole('dialog')).toBeNull();
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
