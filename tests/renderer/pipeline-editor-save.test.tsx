// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { DataPipeline, DataPipelineWorkflow } from '../../src/shared/contracts/data';
import { ConfirmDialogProvider } from '../../src/renderer/components/ConfirmDialog';
import { PipelineEditor } from '../../src/renderer/components/data-view/data-pipelines/workflow/PipelineEditor';
import type { WorkflowCanvas } from '../../src/renderer/components/data-view/data-pipelines/workflow/WorkflowCanvas';
import { dataClient } from '../../src/renderer/features/data/api/data-client';
import i18n from '../../src/renderer/i18n/config';

vi.mock('../../src/renderer/components/data-view/data-pipelines/workflow/WorkflowCanvas', () => ({
  WorkflowCanvas: ({ nodes, onMoveNode }: ComponentProps<typeof WorkflowCanvas>) => {
    const node = nodes[0];
    return (
      <button onClick={() => onMoveNode(node.id, node.x + 10, node.y)}>
        Move to {node.x + 10}
      </button>
    );
  },
}));
vi.mock(
  '../../src/renderer/components/data-view/data-pipelines/workflow/WorkflowInspector',
  () => ({
    WorkflowInspector: () => null,
  })
);

const pipeline: DataPipeline = {
  id: 'pipeline',
  name: 'Orders',
  status: 'draft',
  groupId: null,
  nodeCount: 1,
  sourcePath: null,
  sourceRawTableId: null,
  resultTable: null,
  rowCount: null,
  columnCount: null,
  error: null,
  scheduledFor: null,
  createdAt: 1,
  updatedAt: 1,
  lastRunAt: null,
};
const initial: DataPipelineWorkflow = {
  pipeline,
  edges: [],
  nodes: [
    {
      id: 'input',
      pipelineId: pipeline.id,
      type: 'input',
      label: 'Orders',
      x: 0,
      y: 0,
      config: {},
      createdAt: 1,
      updatedAt: 1,
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('pipeline editor save and recovery', () => {
  it('retries a rejected save and retains edits made while the retry is pending', async () => {
    vi.spyOn(dataClient, 'isAvailable').mockReturnValue(true);
    vi.spyOn(dataClient, 'has').mockReturnValue(false);
    vi.spyOn(dataClient, 'getPipelineWorkflow').mockResolvedValue(initial);
    let complete!: (workflow: DataPipelineWorkflow) => void;
    const save = vi
      .spyOn(dataClient, 'savePipelineWorkflow')
      .mockRejectedValueOnce(new Error('Write interrupted'))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          })
      )
      .mockResolvedValueOnce({ ...initial, nodes: [{ ...initial.nodes[0], x: 20 }] });
    const onSaved = vi.fn();
    render(
      <ConfirmDialogProvider>
        <PipelineEditor
          pipeline={pipeline}
          resultTables={[]}
          actionId={null}
          onBack={vi.fn()}
          onRun={vi.fn()}
          onWorkflowSaved={onSaved}
        />
      </ConfirmDialogProvider>
    );
    const move = await screen.findByRole('button', { name: 'Move to 10' });
    const saveButton = () =>
      screen.getByRole('button', { name: i18n.t('common.save') }) as HTMLButtonElement;
    expect(saveButton().disabled).toBe(true);
    fireEvent.click(move);
    fireEvent.click(saveButton());
    await screen.findByText('Write interrupted');
    expect(onSaved).not.toHaveBeenCalled();
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());
    expect(save.mock.calls[0]).toEqual(save.mock.calls[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Move to 20' }));
    await act(async () => complete({ ...initial, nodes: [{ ...initial.nodes[0], x: 10 }] }));
    expect(screen.getByRole('button', { name: 'Move to 30' })).toBeTruthy();
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[2][1].nodes[0].x).toBe(20);
    expect(saveButton().disabled).toBe(true);
  });
});
