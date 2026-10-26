// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import './i18n-test';
import { RawTablesPanel } from '../../src/renderer/components/data-view/raw-tables';

const member = (id: string, name: string) => ({
  id,
  name,
  groupId: null,
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
});
const source = {
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

describe('raw source rows', () => {
  it('select on click, open only via the toolbar edit button, and hide the path', () => {
    (window as { electronAPI?: unknown }).electronAPI = { data: {} };
    const onOpenSource = vi.fn();
    const noop = vi.fn();
    render(
      <RawTablesPanel
        rawTables={[member('t1', '经营 / 目标'), member('t2', '经营 / 销售')] as never}
        sources={[source] as never}
        onOpenSource={onOpenSource}
        drafts={[]}
        groups={[]}
        groupCounts={{}}
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
    const row = screen.getByTestId('raw-source-group-row');
    expect(row.textContent).not.toContain('/data/经营.xlsx');
    expect(row.querySelector('[data-testid=excel-multi-sheet-icon]')).not.toBeNull();
    fireEvent.click(screen.getByText('经营.xlsx'));
    expect(onOpenSource).not.toHaveBeenCalled();
    expect(row.getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByTestId('raw-source-toggle')).toBeNull();
    // First click selected and collapsed; a second click expands again.
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryAllByTestId('raw-source-child-row')).toHaveLength(0);
    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByTestId('raw-source-child-row')).toHaveLength(2);
    expect(window.localStorage.getItem('sophron.rawSources.collapsed')).toBe('[]');
    const edit = screen
      .getAllByRole('button')
      .find((button) => /^(Edit|编辑)$/.test(button.getAttribute('title') ?? ''))!;
    fireEvent.click(edit);
    expect(onOpenSource).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }), undefined);
  });
});
