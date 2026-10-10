// @vitest-environment happy-dom
/**
 * Output-table editor: config-first tab layout shared with the raw-table
 * workbench — 配置 (default) shows bindings/automations, 数据 hosts the inline
 * preview grid; the toolbar keeps re-run/export/save actions.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import './i18n-test';
import { ResultTableEditor } from '../../src/renderer/components/data-view/result-tables';
import type { DataPipeline, DataResultTable } from '../../src/renderer/types';

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

function makeResultTable(overrides: Partial<DataResultTable> = {}): DataResultTable {
  return {
    id: 'ot1',
    name: 'Clean orders',
    groupId: null,
    sourceRawTableId: null,
    tableName: 'out_clean_orders',
    rowCount: 2,
    columnCount: 2,
    relatedPipelineNames: ['Clean pipeline'],
    relatedPipelineIds: ['task_1'],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makePipeline(id: string, name = id): DataPipeline {
  return {
    id,
    name,
    status: 'completed',
    groupId: null,
    nodeCount: 3,
    createdAt: 1,
    updatedAt: 1,
  } as unknown as DataPipeline;
}

function renderEditor(overrides?: {
  resultTable?: DataResultTable;
  pipelines?: DataPipeline[];
  onRunPipeline?: (pipeline: DataPipeline) => void | Promise<void>;
  data?: Record<string, unknown>;
}) {
  const previewRawTable = vi.fn(async () => PREVIEW);
  const exportTable = vi.fn(async () => ({ success: true, path: '/tmp/out.csv' }));
  (window as { electronAPI?: unknown }).electronAPI = {
    data: { previewRawTable, exportTable, ...overrides?.data },
    automation: { list: async () => ({ automations: [], groupCounts: {} }) },
  };
  const view = render(
    <ResultTableEditor
      resultTable={overrides?.resultTable ?? makeResultTable()}
      rawTables={[]}
      isRawTablesLoading={false}
      isBusy={false}
      pipelines={overrides?.pipelines ?? [makePipeline('task_1', 'Clean pipeline')]}
      onBack={vi.fn()}
      onSave={vi.fn()}
      onRunPipeline={overrides?.onRunPipeline ?? vi.fn()}
    />
  );
  return { ...view, previewRawTable, exportTable };
}

/** The preview grid is canvas-based — assert the fetch + footer + grid shell. */
async function waitForGrid(previewRawTable: ReturnType<typeof vi.fn>, container: HTMLElement) {
  await waitFor(() =>
    expect(previewRawTable).toHaveBeenCalledWith({ id: 'ot1', limit: 100, offset: 0 })
  );
  fireEvent.click(screen.getByRole('tab', { name: 'Data' }));
  expect(await screen.findByText('2 rows')).toBeTruthy();
  expect(container.querySelector('.glass-data-grid-preview')).toBeTruthy();
}

describe('ResultTableEditor', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('opens on the config tab and prefetches the preview for the data tab', async () => {
    const { previewRawTable } = renderEditor();
    await waitFor(() =>
      expect(previewRawTable).toHaveBeenCalledWith({ id: 'ot1', limit: 100, offset: 0 })
    );
    expect(screen.getByRole('tab', { name: 'Configuration' }).getAttribute('aria-selected')).toBe(
      'true'
    );
    // The config form is the default view.
    expect(await screen.findByText('Raw table')).toBeTruthy();
  });

  it('shows the preview grid after switching to the data tab', async () => {
    const { previewRawTable, container } = renderEditor();
    await waitForGrid(previewRawTable, container);
    expect(screen.getByRole('tab', { name: 'Data' }).getAttribute('aria-selected')).toBe('true');
  });

  it('re-runs the related pipeline and reloads the preview', async () => {
    const onRunPipeline = vi.fn(async () => undefined);
    const { previewRawTable, container } = renderEditor({ onRunPipeline });
    await waitForGrid(previewRawTable, container);

    fireEvent.click(screen.getByRole('button', { name: 'Re-run' }));
    await waitFor(() =>
      expect(onRunPipeline).toHaveBeenCalledWith(expect.objectContaining({ id: 'task_1' }))
    );
    await waitFor(() => expect(previewRawTable).toHaveBeenCalledTimes(2));
  });

  it('hides the run button when no pipeline produces the table', () => {
    renderEditor({
      resultTable: makeResultTable({ relatedPipelineIds: [], relatedPipelineNames: [] }),
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
        expect.objectContaining({ tableKind: 'result', id: 'ot1', format: 'csv' })
      )
    );

    await openMenu();
    fireEvent.click(await screen.findByText('Generate report (HTML)'));
    await waitFor(() =>
      expect(exportTable).toHaveBeenCalledWith(expect.objectContaining({ format: 'html' }))
    );
  });
});
