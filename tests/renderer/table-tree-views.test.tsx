// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import './i18n-test';
import { RawTablesPanel } from '../../src/renderer/components/data-view/raw-tables';
import { RawTableTree } from '../../src/renderer/components/data-view/raw-table-tree';
import { useAppStore } from '../../src/renderer/store';
import { ResultTablesPanel } from '../../src/renderer/components/data-view/result-tables';
import { ResultTableCreateDialog } from '../../src/renderer/components/data-view/result-tables/ResultTableCreateDialog';
import type { DataResultTable, DataGroup, DataRawSource } from '../../src/shared/contracts';

const rawGroup: DataGroup = { id: 'rg1', scope: 'raw', name: '销售组', createdAt: 1 };
const resultGroup: DataGroup = { id: 'og1', scope: 'result', name: '分析组', createdAt: 1 };

const source: DataRawSource = {
  id: 's1',
  name: '经营.xlsx',
  sourcePath: '/data/经营.xlsx',
  sourceKind: 'excel',
  buildMode: 'excel_per_sheet',
  config: { autoInclude: true },
  memberIds: ['t1', 't2'],
  createdAt: 1,
  updatedAt: 1,
};

const member = (id: string, name: string, patch: Record<string, unknown> = {}) =>
  ({
    id,
    name,
    groupId: 'rg1',
    sourcePath: '/data/经营.xlsx',
    sourceKind: 'excel',
    fileCount: 1,
    tableName: `rawTable_${id}`,
    rowCount: 3,
    columnCount: 2,
    relatedPipelineNames: [],
    inputConfig: { sourceKind: 'excel' },
    sourceId: 's1',
    memberStatus: 'ok',
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  }) as never;

const resultTable: DataResultTable = {
  id: 'out-1',
  name: '汇总',
  groupId: 'og1',
  sourceRawTableId: null,
  tableName: 'out_1',
  rowCount: 10,
  columnCount: 3,
  relatedPipelineNames: [],
  relatedPipelineIds: [],
  createdAt: 1,
  updatedAt: 1,
};

const noop = vi.fn();

function renderRawTablesPanel(overrides: Partial<Parameters<typeof RawTablesPanel>[0]> = {}) {
  (window as { electronAPI?: unknown }).electronAPI = { data: {} };
  return render(
    <RawTablesPanel
      rawTables={[member('t1', '经营 / 目标'), member('t2', '经营 / 销售')]}
      sources={[source]}
      onOpenSource={noop}
      drafts={[]}
      groups={[rawGroup]}
      groupCounts={{ 'g:rg1': 2 }}
      groupPages={{}}
      totalRawTables={2}
      searchQuery=""
      isLoading={false}
      onSearchChange={noop}
      onCreate={noop}
      onRefresh={noop}
      onPreviewRawTable={noop}
      onDelete={noop}
      onDeleteAll={noop}
      onDeleteDraft={noop}
      onEditDraft={noop}
      onEditRawTable={noop}
      onCreatePipelineFromTable={noop}
      onAssignToGroup={noop}
      onRenameGroup={noop}
      onDeleteGroup={noop}
      onGroupPageChange={noop}
      isCreateDisabled={false}
      actionId={null}
      {...overrides}
    />
  );
}

describe('reusable table trees in existing views', () => {
  it('renders the 原始表 page with folder and source grouping after the tree extract', () => {
    (window as { electronAPI?: unknown }).electronAPI = { data: {} };
    render(
      <RawTablesPanel
        rawTables={[member('t1', '经营 / 目标'), member('t2', '经营 / 销售')]}
        sources={[source]}
        onOpenSource={noop}
        drafts={[]}
        groups={[rawGroup]}
        groupCounts={{ 'g:rg1': 2 }}
        groupPages={{}}
        totalRawTables={2}
        searchQuery=""
        isLoading={false}
        onSearchChange={noop}
        onCreate={noop}
        onRefresh={noop}
        onPreviewRawTable={noop}
        onDelete={noop}
        onDeleteAll={noop}
        onDeleteDraft={noop}
        onEditDraft={noop}
        onEditRawTable={noop}
        onCreatePipelineFromTable={noop}
        onAssignToGroup={noop}
        onRenameGroup={noop}
        onDeleteGroup={noop}
        onGroupPageChange={noop}
        isCreateDisabled={false}
        actionId={null}
      />
    );
    expect(screen.getByTestId('raw-table-tree')).toBeTruthy();
    expect(screen.getByText('销售组')).toBeTruthy();
    expect(screen.getByTestId('raw-source-group-row').textContent).toContain('经营.xlsx');
    expect(screen.getByText('目标')).toBeTruthy();
    expect(screen.getByText('销售')).toBeTruthy();
    expect(screen.getByText('Source type')).toBeTruthy();
    expect(screen.queryByText('Rows')).toBeNull();
    const filler = screen.getByTestId('data-list-filler');
    expect(filler).toBeTruthy();
    expect(filler.getAttribute('aria-hidden')).toBe('true');
    const table = screen.getByTestId('raw-table-tree').querySelector('table');
    expect(table?.classList.contains('data-list-table-fill')).toBe(true);
    const dataRows = [...screen.getByTestId('raw-table-tree').querySelectorAll('tbody tr')].filter(
      (row) => row.getAttribute('data-list-filler') !== 'true'
    );
    expect(dataRows.some((row) => row.className.includes('border-dashed'))).toBe(false);
    expect(dataRows.some((row) => row.className.includes('border-border-muted/85'))).toBe(true);
    expect(filler.querySelectorAll('td')).toHaveLength(1);
    expect(filler.querySelector('td')?.getAttribute('colspan')).toBe('5');
  });

  it('renders the 结果表 page with folder grouping after the tree extract', () => {
    (window as { electronAPI?: unknown }).electronAPI = { data: {} };
    render(
      <ResultTablesPanel
        resultTables={[resultTable]}
        totalResultTables={1}
        groups={[resultGroup]}
        groupCounts={{ 'g:og1': 1 }}
        groupPages={{}}
        searchQuery=""
        isLoading={false}
        actionId={null}
        isCreateDisabled={false}
        onCreate={noop}
        onSearchChange={noop}
        onRefresh={noop}
        onGroupPageChange={noop}
        onPreview={noop}
        onEdit={noop}
        onDelete={noop}
        onDeleteAll={noop}
        onAssignToGroup={noop}
        onRenameGroup={noop}
        onDeleteGroup={noop}
      />
    );
    expect(screen.getByTestId('result-table-tree')).toBeTruthy();
    expect(screen.getByText('分析组')).toBeTruthy();
    expect(screen.getByText('汇总')).toBeTruthy();
    const filler = screen.getByTestId('data-list-filler');
    expect(filler).toBeTruthy();
    expect(filler.getAttribute('aria-hidden')).toBe('true');
    const table = screen.getByTestId('result-table-tree').querySelector('table');
    expect(table?.classList.contains('data-list-table-fill')).toBe(true);
    expect(filler.querySelectorAll('td')).toHaveLength(1);
    expect(filler.querySelector('td')?.getAttribute('colspan')).toBe('4');
  });

  it('merges 新增原始表 and 从云端添加 into a split button', async () => {
    const onCreate = vi.fn();
    const navigateToTableAutomation = vi.fn();
    const previous = useAppStore.getState().navigateToTableAutomation;
    useAppStore.setState({ navigateToTableAutomation });
    try {
      renderRawTablesPanel({ onCreate });
      const addButton = screen.getByTestId('raw-table-add-button');
      expect(addButton.textContent).toContain('Add raw table');
      const trigger = screen.getByTestId('raw-table-add-menu-trigger');
      expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
      expect(trigger.className.split(/\s+/)).toContain('w-10');
      expect(screen.queryByRole('menuitem', { name: 'Add from cloud' })).toBeNull();
      await act(async () => {
        fireEvent.click(addButton);
      });
      expect(onCreate).toHaveBeenCalledTimes(1);

      await act(async () => {
        fireEvent.keyDown(trigger, { key: 'Enter' });
      });
      const item = await screen.findByRole('menuitem', { name: /Add from cloud/ });
      expect(item).toBeTruthy();
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      await act(async () => {
        fireEvent.click(item);
      });
      expect(navigateToTableAutomation).toHaveBeenCalledWith({ newRawTableName: '' });
    } finally {
      useAppStore.setState({ navigateToTableAutomation: previous });
    }
  });

  it('marks missing raw tables as unavailable in list and disables them in picker mode', () => {
    const unavailableTable = member('t1', '经营 / 目标', { memberStatus: 'missing' });
    const availableTable = member('t2', '经营 / 销售');
    const onSelectedIdsChange = vi.fn();

    const { container, unmount } = render(
      <RawTableTree
        variant="picker"
        rawTables={[unavailableTable, availableTable]}
        sources={[source]}
        groups={[rawGroup]}
        selectionMode="multi"
        selectedIds={[]}
        onSelectedIdsChange={onSelectedIdsChange}
      />
    );
    const unavailableRow = container.querySelector('[data-table-id="t1"]') as HTMLElement;
    const availableRow = container.querySelector('[data-table-id="t2"]') as HTMLElement;
    expect(unavailableRow.getAttribute('aria-disabled')).toBe('true');
    expect(unavailableRow.textContent).toMatch(/Unavailable|不可用/);
    expect(
      (unavailableRow.querySelector('input[type="checkbox"]') as HTMLInputElement).disabled
    ).toBe(true);
    fireEvent.click(unavailableRow);
    expect(onSelectedIdsChange).not.toHaveBeenCalled();

    // Selecting the parent source only picks available children, never unavailable ones.
    const sourceCheckbox = screen.getByLabelText('经营.xlsx') as HTMLInputElement;
    fireEvent.click(sourceCheckbox);
    expect(onSelectedIdsChange).toHaveBeenLastCalledWith(['t2']);

    onSelectedIdsChange.mockClear();
    fireEvent.click(availableRow);
    expect(onSelectedIdsChange).toHaveBeenLastCalledWith(['t2']);
    unmount();

    renderRawTablesPanel({
      rawTables: [unavailableTable, availableTable],
      onCreatePipelineFromTable: vi.fn(),
    });
    const childRows = screen.getAllByTestId('raw-source-child-row');
    expect(childRows[0].textContent).toMatch(/Unavailable|不可用/);
  });

  it('renders ResultTableCreateDialog with fixed height, purpose select and hover info tooltip', () => {
    (window as { electronAPI?: unknown }).electronAPI = { data: {} };
    const onSubmit = vi.fn();
    render(
      <ResultTableCreateDialog
        open
        onOpenChange={vi.fn()}
        suggestedName="新的结果表 6"
        onSubmit={onSubmit}
      />
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('rounded-none');
    expect(dialog.className).toContain('p-0');
    expect(dialog.className).toContain('h-[216px]');
    expect(dialog.querySelector('.ui-group')).toBeNull();
    expect(screen.getByTestId('result-table-create-header').className).toContain('h-11');
    expect(screen.getByRole('combobox')).toBeTruthy();
    expect(screen.queryByTestId('result-table-purpose-desc')).toBeNull();

    // Hovering the info icon after the source type dropdown shows descriptions for both options.
    const infoBtn = screen.getByTestId('result-table-source-type-info');
    expect(screen.queryByTestId('result-table-source-type-tooltip')).toBeNull();
    fireEvent.mouseEnter(infoBtn);
    const tooltip = screen.getByTestId('result-table-source-type-tooltip');
    expect(tooltip.textContent).toMatch(/Data pipeline|数据加工/);
    expect(tooltip.textContent).toMatch(/Copy raw table|复制原始表/);
    fireEvent.mouseLeave(infoBtn);
    expect(screen.queryByTestId('result-table-source-type-tooltip')).toBeNull();

    fireEvent.click(screen.getByTestId('result-table-create-confirm'));
    expect(onSubmit).toHaveBeenCalledWith({ name: '新的结果表 6', sourceRawTableId: null });
  });

  it('opens the cloud connection RawTableTree picker in a dropdown popover when copying a raw table', async () => {
    const unavailableTable = member('t1', '经营 / 目标', { memberStatus: 'missing' });
    const availableTable = member('t2', '经营 / 销售');
    const otherTable = member('t3', '订单汇总', { sourceId: null, groupId: null });
    (window as { electronAPI?: unknown }).electronAPI = {
      data: {
        getDashboard: vi.fn().mockResolvedValue({
          rawTables: [unavailableTable, availableTable, otherTable],
          groups: [rawGroup],
        }),
        listRawSources: vi.fn().mockResolvedValue([source]),
      },
    };
    const onSubmit = vi.fn();
    render(
      <ResultTableCreateDialog
        open
        onOpenChange={vi.fn()}
        suggestedName="复制结果表"
        onSubmit={onSubmit}
      />
    );

    const dialog = screen.getByRole('dialog');
    const purposeSelect = screen.getByRole('combobox');
    await act(async () => {
      fireEvent.click(purposeSelect);
    });
    const copyOption = await screen.findByRole('option', {
      name: /Copy raw table|复制原始表/,
    });
    await act(async () => {
      fireEvent.click(copyOption);
    });

    // Tree is NOT embedded inline before opening the dropdown popover.
    expect(screen.queryByTestId('raw-table-tree-select-popover')).toBeNull();
    const trigger = screen.getByTestId('raw-table-tree-select-trigger');
    const confirmBtn = screen.getByTestId('result-table-create-confirm') as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);

    // Click dropdown trigger -> opens portal popover outside the dialog body.
    await act(async () => {
      fireEvent.click(trigger);
    });
    const popover = await screen.findByTestId('raw-table-tree-select-popover');
    expect(dialog.contains(popover)).toBe(false);
    expect(screen.getByTestId('raw-table-tree')).toBeTruthy();
    expect(popover.querySelector('[role="tree"]')?.getAttribute('aria-multiselectable')).toBe(
      'false'
    );
    expect(popover.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(screen.getByText('销售组')).toBeTruthy();
    expect(screen.getByTestId('raw-source-group-row').textContent).toContain('经营.xlsx');

    // Unavailable table cannot be selected and keeps popover open.
    const unavailableRow = popover.querySelector('[data-table-id="t1"]') as HTMLElement;
    fireEvent.click(unavailableRow);
    expect(confirmBtn.disabled).toBe(true);
    expect(screen.getByTestId('raw-table-tree-select-popover')).toBeTruthy();

    // Selecting an available table closes the popover and displays its name on the trigger.
    const availableRow = popover.querySelector('[data-table-id="t2"]') as HTMLElement;
    fireEvent.click(availableRow);
    expect(screen.queryByTestId('raw-table-tree-select-popover')).toBeNull();
    expect(trigger.textContent).toContain('经营 / 销售');
    expect(confirmBtn.disabled).toBe(false);

    // Reopen -> active single-selected row shows trailing check, search & pick another replaces it.
    await act(async () => {
      fireEvent.click(trigger);
    });
    const reopenedPopover = await screen.findByTestId('raw-table-tree-select-popover');
    const selectedRow = reopenedPopover.querySelector('[data-table-id="t2"]') as HTMLElement;
    expect(selectedRow.getAttribute('aria-selected')).toBe('true');
    expect(selectedRow.querySelector('[data-testid="table-picker-single-check"]')).toBeTruthy();
    fireEvent.change(screen.getByTestId('raw-table-tree-select-search'), {
      target: { value: '订单' },
    });
    expect(reopenedPopover.querySelector('[data-table-id="t2"]')).toBeNull();
    const otherRow = reopenedPopover.querySelector('[data-table-id="t3"]') as HTMLElement;
    fireEvent.click(otherRow);
    expect(screen.queryByTestId('raw-table-tree-select-popover')).toBeNull();
    expect(trigger.textContent).toContain('订单汇总');

    fireEvent.click(confirmBtn);
    expect(onSubmit).toHaveBeenCalledWith({ name: '复制结果表', sourceRawTableId: 't3' });
  });
});
