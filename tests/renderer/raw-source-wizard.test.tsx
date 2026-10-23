// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import './i18n-test';

const client = vi.hoisted(() => ({
  scanRawSource: vi.fn(),
  createRawSource: vi.fn(),
  rebuildRawSource: vi.fn(),
  getRawSourceRebuildImpact: vi.fn(),
  pickRawTableSourcePath: vi.fn(),
}));
vi.mock('../../src/renderer/features/data/api/data-client', () => ({ dataClient: client }));

import { RawSourceWizard } from '../../src/renderer/components/data-view/raw-source-wizard';
import { RebuildConfirmDialog } from '../../src/renderer/components/data-view/raw-source-rebuild-dialog';
import { groupBySource } from '../../src/renderer/components/data-view/raw-tables';

const sheet = (name: string, columns = ['日期', '金额'], rowCount = 10) => ({
  name,
  rowCount,
  columnCount: columns.length,
  columns,
  empty: false,
});
const excelScan = {
  sourcePath: '/d/销售.xlsx',
  kind: 'excel',
  name: '销售.xlsx',
  sizeBytes: 1,
  sheets: [sheet('1月'), sheet('2月'), sheet('说明', ['备注'], 2)],
  files: [],
  merge: null,
};
const source = (patch: Record<string, unknown> = {}) => ({
  id: 's1',
  name: '销售.xlsx',
  sourcePath: '/d/销售.xlsx',
  sourceKind: 'excel',
  buildMode: 'excel_per_sheet',
  config: { autoInclude: true },
  memberIds: ['t1', 't2'],
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});
const table = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  name: id,
  rowCount: 10,
  updatedAt: 1,
  sourceId: 's1',
  ...patch,
});

function props(overrides: Record<string, unknown> = {}) {
  return {
    onBack: vi.fn(),
    onOpenData: vi.fn(),
    onOpenCloud: vi.fn(),
    ...overrides,
  };
}

async function scanPath(path: string) {
  const input = screen.getByTestId('raw-source-path-input');
  fireEvent.change(input, { target: { value: path } });
  await act(async () => {
    fireEvent.keyDown(input, { key: 'Enter' });
  });
}

beforeEach(() => {
  Object.values(client).forEach((fn) => fn.mockReset());
});

describe('RawSourceWizard', () => {
  it('creates one table per selected sheet and opens the data tab of the first', async () => {
    client.scanRawSource.mockResolvedValue(excelScan);
    client.createRawSource.mockResolvedValue({
      source: source(),
      tables: [table('t1', { name: '销售 / 1月' }), table('t2', { name: '销售 / 2月' })],
      skipped: [],
    });
    const p = props();
    render(<RawSourceWizard {...p} />);
    await scanPath('/d/销售.xlsx');
    fireEvent.click(screen.getByTestId('raw-source-mode-excel_per_sheet'));
    fireEvent.click(screen.getByTestId('raw-source-next'));
    // Three sheets checked by default; uncheck "说明".
    fireEvent.click(screen.getByTestId('raw-source-sheet-说明'));
    expect(screen.queryByText(/预览/)).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByTestId('raw-source-create'));
    });
    expect(client.createRawSource).toHaveBeenCalledWith(
      expect.objectContaining({ buildMode: 'excel_per_sheet', sheets: ['1月', '2月'] })
    );
    fireEvent.click(await screen.findByTestId('raw-source-open-data'));
    expect(p.onOpenData).toHaveBeenCalledWith('t1');
  });

  it('merges same-structure sheets only when the toggle is on', async () => {
    client.scanRawSource.mockResolvedValue(excelScan);
    client.createRawSource.mockResolvedValue({
      source: source({ buildMode: 'excel_merge_sheets', memberIds: ['t1'] }),
      tables: [table('t1')],
      skipped: [],
    });
    render(<RawSourceWizard {...props()} />);
    await scanPath('/d/销售.xlsx');
    fireEvent.click(screen.getByTestId('raw-source-mode-excel_per_sheet'));
    fireEvent.click(screen.getByTestId('raw-source-next'));
    const toggle = screen.getByTestId('raw-source-merge-sheets');
    expect((toggle as HTMLButtonElement).disabled).toBe(true); // 说明 has different columns
    fireEvent.click(screen.getByTestId('raw-source-sheet-说明'));
    expect((toggle as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(toggle);
    await act(async () => {
      fireEvent.click(screen.getByTestId('raw-source-create'));
    });
    expect(client.createRawSource).toHaveBeenCalledWith(
      expect.objectContaining({ buildMode: 'excel_merge_sheets', sheets: ['1月', '2月'] })
    );
  });

  it('folder merge shows the sheet strategy row, filled-column notice and sends the selector', async () => {
    client.scanRawSource.mockResolvedValue({
      sourcePath: '/d/门店',
      kind: 'folder',
      name: '门店',
      sizeBytes: 1,
      sheets: [],
      files: [
        {
          path: '/d/门店/a.xlsx',
          relativePath: 'a.xlsx',
          kind: 'excel',
          status: 'ready',
          sheetNames: ['明细', '汇总'],
          usedSheet: '明细',
          rowCount: 5,
          columns: ['日期', '金额'],
        },
        {
          path: '/d/门店/b.xlsx',
          relativePath: 'b.xlsx',
          kind: 'excel',
          status: 'ready',
          sheetNames: ['明细'],
          usedSheet: '明细',
          rowCount: 3,
          columns: ['日期'],
        },
        {
          path: '/d/门店/c.xlsx',
          relativePath: 'c.xlsx',
          kind: 'excel',
          status: 'missing_sheet',
          reason: '无“明细”',
          sheetNames: ['Sheet1'],
          usedSheet: null,
          rowCount: 0,
          columns: [],
        },
      ],
      merge: {
        fileCount: 2,
        rowCount: 8,
        filledColumns: [{ name: '金额', missingInFiles: ['b.xlsx'] }],
      },
    });
    client.createRawSource.mockResolvedValue({
      source: source({ sourceKind: 'folder', buildMode: 'folder_merge', memberIds: ['t1'] }),
      tables: [table('t1')],
      skipped: [],
    });
    render(<RawSourceWizard {...props()} />);
    await scanPath('/d/门店');
    fireEvent.click(screen.getByTestId('raw-source-next'));
    expect(screen.getByTestId('raw-source-sheet-strategy')).toBeTruthy();
    expect(screen.getByTestId('raw-source-filled-notice').textContent).toContain('金额');
    expect(screen.getByText('无“明细”')).toBeTruthy();
    // Index stepper never goes below 1.
    fireEvent.change(screen.getByTestId('raw-source-selector-index'), { target: { value: '0' } });
    expect((screen.getByTestId('raw-source-selector-index') as HTMLInputElement).value).toBe('1');
    fireEvent.click(screen.getByTestId('raw-source-selector-by-name'));
    fireEvent.change(screen.getByTestId('raw-source-selector-name'), { target: { value: '明细' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('raw-source-create'));
    });
    expect(client.createRawSource).toHaveBeenCalledWith(
      expect.objectContaining({
        buildMode: 'folder_merge',
        sheetSelector: { by: 'name', name: '明细' },
      })
    );
  });

  it('rebuild asks for confirmation before deleting existing tables', async () => {
    client.scanRawSource.mockResolvedValue(excelScan);
    client.getRawSourceRebuildImpact.mockResolvedValue({
      sourceId: 's1',
      tables: [
        { id: 't1', name: '销售 / 1月', rowCount: 10, pipelineNames: ['月报'] },
        { id: 't2', name: '销售 / 2月', rowCount: 10, pipelineNames: [] },
      ],
    });
    client.rebuildRawSource.mockResolvedValue({
      source: source({ buildMode: 'excel_merge_sheets' }),
      tables: [table('t9')],
      skipped: [],
    });
    render(
      <RawSourceWizard
        {...props({
          rebuild: { source: source(), buildMode: 'excel_single' },
        })}
      />
    );
    await waitFor(() =>
      expect((screen.getByTestId('raw-source-create') as HTMLButtonElement).disabled).toBe(false)
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('raw-source-create'));
    });
    expect(client.rebuildRawSource).not.toHaveBeenCalled();
    const confirm = await screen.findByTestId('raw-source-rebuild-confirm');
    expect(screen.getByText('月报')).toBeTruthy();
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('raw-source-rebuild-ack'));
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(client.rebuildRawSource).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 's1',
        confirmDeleteExistingTables: true,
        buildMode: 'excel_single',
      })
    );
  });
});

describe('RebuildConfirmDialog', () => {
  it('collapses unreferenced tables beyond three and cancels safely', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <RebuildConfirmDialog
        open
        sourceName="销售"
        fromMode="A"
        toMode="B"
        impact={{
          sourceId: 's1',
          tables: ['a', 'b', 'c', 'd', 'e'].map((id) => ({
            id,
            name: `表${id}`,
            rowCount: 1,
            pipelineNames: [],
          })),
        }}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );
    expect(screen.queryByText('表d')).toBeNull();
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('groupBySource (layout A)', () => {
  it('groups multi-member sources under a header and keeps single sources flat', () => {
    const rows = groupBySource(
      [table('t2'), table('x', { sourceId: 's2' }), table('t1')] as never,
      [source({ memberIds: ['t1', 't2'] }), source({ id: 's2', memberIds: ['x'] })] as never
    );
    expect(rows.map((row) => `${row.kind}:${row.id}`)).toEqual([
      'source:source:s1',
      'rawTable:t1',
      'rawTable:t2',
      'rawTable:x',
    ]);
    expect(rows[1]).toMatchObject({ child: true });
    expect(rows[3]).not.toMatchObject({ child: true });
  });
});
