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
import type {
  DataGroup,
  DataPipeline,
  DataRawSource,
  DataRawTable,
  DataResultTable,
} from '../../src/renderer/types';

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
  rawTables?: DataRawTable[];
  rawGroups?: DataGroup[];
  rawSources?: DataRawSource[];
  pipelines?: DataPipeline[];
  onRunPipeline?: (pipeline: DataPipeline) => void | Promise<void>;
  onDelete?: (resultTable: DataResultTable) => void | Promise<void>;
  onSave?: (
    resultTable: DataResultTable,
    name: string,
    sourceRawTableId: string | null
  ) => void | Promise<void>;
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
      rawTables={overrides?.rawTables ?? []}
      rawGroups={overrides?.rawGroups ?? []}
      rawSources={overrides?.rawSources ?? []}
      isRawTablesLoading={false}
      isBusy={false}
      pipelines={overrides?.pipelines ?? [makePipeline('task_1', 'Clean pipeline')]}
      onBack={vi.fn()}
      onSave={overrides?.onSave ?? vi.fn()}
      onRunPipeline={overrides?.onRunPipeline ?? vi.fn()}
      onDelete={overrides?.onDelete}
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
  expect(await screen.findByText(/^2 rows/)).toBeTruthy();
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
    expect(await screen.findByText('Source type')).toBeTruthy();
    // Source raw table picker is hidden when source type is Data pipeline.
    expect(screen.queryByTestId('raw-table-tree-select-trigger')).toBeNull();
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

  it('exports csv and excel formats through the export bridge', async () => {
    const { exportTable } = renderEditor();

    const openMenu = async () => {
      const trigger = screen.getByRole('button', { name: 'More' });
      fireEvent.pointerDown(trigger);
      fireEvent.click(trigger);
      const exportItem = await screen.findByText('Export');
      fireEvent.pointerMove(exportItem, { pointerType: 'mouse' });
    };
    await openMenu();
    fireEvent.click(await screen.findByText('CSV file'));
    await waitFor(() =>
      expect(exportTable).toHaveBeenCalledWith(
        expect.objectContaining({ tableKind: 'result', id: 'ot1', format: 'csv' })
      )
    );

    await openMenu();
    fireEvent.click(await screen.findByText('Excel file (2013)'));
    await waitFor(() =>
      expect(exportTable).toHaveBeenCalledWith(expect.objectContaining({ format: 'xlsx' }))
    );
  });

  it('omits summary stat cards and danger zone, uses tree picker for copy source, and puts delete in top more menu', async () => {
    const onDelete = vi.fn();
    const onSave = vi.fn();
    const rawGroup: DataGroup = { id: 'rg1', scope: 'raw', name: '销售组', createdAt: 1 };
    const rawTable = {
      id: 'rt1',
      name: '订单原始表',
      groupId: 'rg1',
      sourcePath: '/data/orders.xlsx',
      sourceKind: 'excel',
      fileCount: 1,
      tableName: 'raw_rt1',
      rowCount: 10,
      columnCount: 3,
      relatedPipelineNames: [],
      inputConfig: { sourceKind: 'excel' },
      memberStatus: 'ok',
      createdAt: 1,
      updatedAt: 1,
    } as unknown as DataRawTable;
    const target = makeResultTable();
    renderEditor({
      resultTable: target,
      rawTables: [rawTable],
      rawGroups: [rawGroup],
      onDelete,
      onSave,
    });

    // Summary stats and danger zone are removed.
    expect(screen.queryByTestId('result-danger-zone')).toBeNull();
    expect(screen.queryByText('Rows')).toBeNull();

    // Initially Data pipeline -> raw table selector is hidden.
    expect(screen.queryByTestId('raw-table-tree-select-trigger')).toBeNull();
    const saveBtn = screen.getByTestId('result-editor-save') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    // Switch source type to Copy raw table -> raw table tree selector appears; save stays disabled until a table is chosen.
    fireEvent.click(screen.getByRole('combobox', { name: 'Source type' }));
    fireEvent.click(await screen.findByRole('option', { name: /Copy raw table|复制原始表/ }));
    expect(saveBtn.disabled).toBe(true);

    const trigger = screen.getByTestId('raw-table-tree-select-trigger');
    fireEvent.click(trigger);
    const popover = await screen.findByTestId('raw-table-tree-select-popover');
    expect(popover.textContent).toContain('销售组');
    fireEvent.click(popover.querySelector('[data-table-id="rt1"]') as HTMLElement);
    expect(trigger.textContent).toContain('订单原始表');
    expect(saveBtn.disabled).toBe(false);

    fireEvent.click(saveBtn);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(target, 'Clean orders', 'rt1'));

    // Switching source type back to Data pipeline hides the raw table picker.
    fireEvent.click(screen.getByRole('combobox', { name: 'Source type' }));
    fireEvent.click(await screen.findByRole('option', { name: /Data pipeline|数据加工/ }));
    expect(screen.queryByTestId('raw-table-tree-select-trigger')).toBeNull();

    // Delete action is inside the top More menu and invokes onDelete (which runs the existing confirm prompt).
    const moreTrigger = screen.getByRole('button', { name: 'More' });
    fireEvent.pointerDown(moreTrigger);
    fireEvent.click(moreTrigger);
    fireEvent.click(await screen.findByText(/Delete result table|删除结果表/));
    expect(onDelete).toHaveBeenCalledWith(target);
  });
});
