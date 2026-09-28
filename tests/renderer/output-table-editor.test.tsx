// @vitest-environment happy-dom
/**
 * Output-table editor: config-first like the input-table workbench — the
 * config form is the main body, preview opens in the shared preview dialog,
 * and the toolbar keeps re-run/export/save actions.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import './i18n-test';
import { OutputTableEditor } from '../../src/renderer/components/data-view/output-tables';
import type { DataCleaningTask, DataOutputTable } from '../../src/renderer/types';

const PREVIEW = {
  columns: ['id', 'amount'],
  columnTypes: [
    { name: 'id', type: 'integer', storageType: 'BIGINT' },
    { name: 'amount', type: 'float', storageType: 'DOUBLE' },
  ],
  rows: [
    { id: 1, amount: 9.5 },
    { id: 2, amount: 3 },
  ],
  fileCount: 1,
  limit: 100,
  offset: 0,
  totalRows: 2,
};

function makeOutputTable(overrides: Partial<DataOutputTable> = {}): DataOutputTable {
  return {
    id: 'ot1',
    name: 'Clean orders',
    groupId: null,
    sourceDatasetId: null,
    tableName: 'out_clean_orders',
    rowCount: 2,
    columnCount: 2,
    relatedTaskNames: ['Clean task'],
    relatedTaskIds: ['task_1'],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makeTask(id: string, name = id): DataCleaningTask {
  return {
    id,
    name,
    status: 'completed',
    groupId: null,
    nodeCount: 3,
    createdAt: 1,
    updatedAt: 1,
  } as unknown as DataCleaningTask;
}

function renderEditor(overrides?: {
  outputTable?: DataOutputTable;
  tasks?: DataCleaningTask[];
  onRunTask?: (task: DataCleaningTask) => void | Promise<void>;
  data?: Record<string, unknown>;
}) {
  const previewDataset = vi.fn(async () => PREVIEW);
  const exportTable = vi.fn(async () => ({ success: true, path: '/tmp/out.csv' }));
  (window as { electronAPI?: unknown }).electronAPI = {
    data: { previewDataset, exportTable, ...overrides?.data },
    automation: { list: async () => [] },
  };
  const view = render(
    <OutputTableEditor
      outputTable={overrides?.outputTable ?? makeOutputTable()}
      inputTables={[]}
      isInputTablesLoading={false}
      isBusy={false}
      tasks={overrides?.tasks ?? [makeTask('task_1', 'Clean task')]}
      onBack={vi.fn()}
      onSave={vi.fn()}
      onRunTask={overrides?.onRunTask ?? vi.fn()}
    />
  );
  return { ...view, previewDataset, exportTable };
}

async function openPreviewDialog(previewDataset: ReturnType<typeof vi.fn>) {
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  await waitFor(() =>
    expect(previewDataset).toHaveBeenCalledWith({ id: 'ot1', limit: 100, offset: 0 })
  );
  expect(await screen.findByText('Output table data preview')).toBeTruthy();
}

describe('OutputTableEditor', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('opens on the config form and does not prefetch the preview', async () => {
    const { previewDataset } = renderEditor();
    expect(await screen.findByText('Input table')).toBeTruthy();
    expect(previewDataset).not.toHaveBeenCalled();
  });

  it('opens the shared preview dialog from the toolbar', async () => {
    const { previewDataset } = renderEditor();
    await openPreviewDialog(previewDataset);
    // The dialog portals to document.body — query the document, not the render root.
    expect(document.body.querySelector('.glass-data-grid-preview')).toBeTruthy();
    expect(await screen.findByText('2 rows')).toBeTruthy();
  });

  it('re-runs the related task and reloads the open preview', async () => {
    const onRunTask = vi.fn(async () => undefined);
    const { previewDataset } = renderEditor({ onRunTask });
    await openPreviewDialog(previewDataset);

    fireEvent.click(screen.getByRole('button', { name: 'Re-run' }));
    await waitFor(() =>
      expect(onRunTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'task_1' }))
    );
    await waitFor(() => expect(previewDataset).toHaveBeenCalledTimes(2));
  });

  it('hides the run button when no task produces the table', () => {
    renderEditor({
      outputTable: makeOutputTable({ relatedTaskIds: [], relatedTaskNames: [] }),
    });
    expect(screen.queryByRole('button', { name: 'Re-run' })).toBeNull();
  });

  it('exports csv and report formats through the export bridge', async () => {
    const { exportTable } = renderEditor();

    const openMenu = async () => {
      const trigger = screen.getByRole('button', { name: /Export/ });
      fireEvent.pointerDown(trigger);
      fireEvent.click(trigger);
    };
    await openMenu();
    fireEvent.click(await screen.findByText('CSV file'));
    await waitFor(() =>
      expect(exportTable).toHaveBeenCalledWith(
        expect.objectContaining({ tableKind: 'output', id: 'ot1', format: 'csv' })
      )
    );

    await openMenu();
    fireEvent.click(await screen.findByText('Generate report (HTML)'));
    await waitFor(() =>
      expect(exportTable).toHaveBeenCalledWith(expect.objectContaining({ format: 'html' }))
    );
  });
});
