// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18n from './i18n-test';

const client = vi.hoisted(() => ({
  setRawSourceAutoInclude: vi.fn(),
  previewRawTable: vi.fn(),
  refreshRawSource: vi.fn(),
  scanRawSource: vi.fn(),
  rebuildRawSource: vi.fn(),
  getRawSourceRebuildImpact: vi.fn(),
  pickRawTableSourcePath: vi.fn(),
}));
vi.mock('../../src/renderer/features/data/api/data-client', () => ({ dataClient: client }));

import {
  RawSourceDetail,
  memberShortName,
} from '../../src/renderer/components/data-view/raw-source-detail';

const source = (patch: Record<string, unknown> = {}) =>
  ({
    id: 's1',
    name: '01_客户主数据.xlsx',
    sourcePath: '/d/01_客户主数据.xlsx',
    sourceKind: 'excel',
    buildMode: 'excel_per_sheet',
    config: { autoInclude: true, knownMembers: ['客户主数据', '关联说明'], lastScannedAt: 1 },
    memberIds: ['t1', 't2'],
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  }) as never;
const table = (id: string, patch: Record<string, unknown> = {}) =>
  ({
    id,
    name: `01_客户主数据 / ${id}`,
    memberKey: id,
    memberStatus: 'ok',
    sourcePath: '/d/01_客户主数据.xlsx',
    sourceKind: 'excel',
    inputConfig: {},
    relatedPipelineNames: [],
    rowCount: 30,
    columnCount: 10,
    updatedAt: 1,
    ...patch,
  }) as never;

function renderDetail(
  src = source(),
  tables = [table('客户主数据'), table('关联说明')],
  extra: Record<string, unknown> = {}
) {
  const fixed = {
    ...(src as object),
    memberIds: (tables as Array<{ id: string }>).map((t) => t.id),
  };
  const handlers = {
    onBack: vi.fn(),
    onOpenTable: vi.fn(),
    onRebuilt: vi.fn(),
    onChanged: vi.fn(),
  };
  render(<RawSourceDetail source={fixed as never} rawTables={tables} {...handlers} {...extra} />);
  return handlers;
}

beforeEach(async () => {
  await i18n.changeLanguage('zh');
  vi.clearAllMocks();
  client.setRawSourceAutoInclude.mockResolvedValue({});
  client.previewRawTable.mockResolvedValue({ columns: [], rows: [], total: 0 });
});

describe('RawSourceDetail (方案 A)', () => {
  it('shows the source group and short member names with size and status', () => {
    renderDetail();
    expect(screen.getByText('数据来源')).toBeTruthy();
    expect(screen.getByText('打开所在位置')).toBeTruthy();
    expect(screen.getByText('修改将重建原始表')).toBeTruthy();
    expect(screen.getByTestId('raw-source-last-scan').textContent).toContain('2 个 Sheet，无变化');
    const rows = screen.getAllByTestId('raw-source-member-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getAllByText('客户主数据').length).toBeGreaterThan(0);
    expect(rows[0].textContent).not.toContain('01_客户主数据 /');
    expect(rows[0].textContent).toContain('30 × 10');
    expect(rows[0].textContent).toContain('正常');
  });

  it('persists the auto-include toggle and rolls back on failure', async () => {
    const h = renderDetail();
    const toggle = screen.getByTestId('raw-source-auto-include');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    await waitFor(() => expect(client.setRawSourceAutoInclude).toHaveBeenCalledWith('s1', false));
    await waitFor(() => expect(h.onChanged).toHaveBeenCalled());
    client.setRawSourceAutoInclude.mockRejectedValueOnce(new Error('boom'));
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByText(/保存失败/)).toBeTruthy());
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('row actions preview / open', async () => {
    const h = renderDetail();
    fireEvent.click(screen.getAllByTestId('raw-source-member-open')[1]);
    expect(h.onOpenTable).toHaveBeenCalledWith(expect.objectContaining({ id: '关联说明' }));
    fireEvent.click(screen.getAllByTestId('raw-source-member-preview')[1]);
    expect(screen.getByTestId('raw-source-detail-data')).toBeTruthy();
    await waitFor(() =>
      expect(client.previewRawTable).toHaveBeenCalledWith(
        expect.objectContaining({ id: '关联说明' })
      )
    );
  });

  it('folder merge lists included files; single-table modes disable auto-include', () => {
    renderDetail(
      source({
        sourceKind: 'folder',
        buildMode: 'folder_merge',
        name: '月报',
        sourcePath: '/d/月报',
      }),
      [
        table('m1', {
          name: '月报',
          inputConfig: { mergeReport: { includedFiles: ['1月.csv', '2月.csv'] } },
        }),
      ]
    );
    expect(screen.getByText('文件夹')).toBeTruthy();
    expect(screen.getByText('合并自')).toBeTruthy();
    expect(screen.getAllByTestId('raw-source-merged-part').map((r) => r.textContent)).toEqual([
      '1月.csv',
      '2月.csv',
    ]);
    const toggle = screen.getByTestId('raw-source-auto-include') as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    expect(screen.getByText('以后新增的文件自动导入')).toBeTruthy();
  });

  it('memberShortName strips the stem of the name or the path', () => {
    const s = source({ name: 'U_PS', sourcePath: '/x/per_sheet.xlsx' });
    expect(memberShortName(table('a', { name: 'per_sheet / 客户' }), s)).toBe('客户');
    expect(memberShortName(table('a', { name: 'U_PS / 客户' }), s)).toBe('客户');
    expect(memberShortName(table('a', { name: '其他' }), s)).toBe('其他');
  });

  describe('inline 组织方式 change', () => {
    const sheet = (name: string, rows: number) => ({
      name,
      rowCount: rows,
      columnCount: 2,
      columns: ['日期', '金额'],
      empty: false,
    });
    beforeEach(() => {
      client.scanRawSource.mockResolvedValue({
        sourcePath: '/d/01_客户主数据.xlsx',
        kind: 'excel',
        name: '01_客户主数据.xlsx',
        sizeBytes: 1,
        sheets: [sheet('客户主数据', 30), sheet('关联说明', 3)],
        files: [],
        merge: null,
      });
      client.getRawSourceRebuildImpact.mockResolvedValue({
        sourceId: 's1',
        tables: [{ id: '客户主数据', name: '客户主数据', rowCount: 30, pipelineNames: [] }],
      });
    });

    it('stays on the page, shows the new options with 保存 / 取消, and 取消 restores', async () => {
      const h = renderDetail();
      fireEvent.change(screen.getByTestId('raw-source-build-mode'), {
        target: { value: 'excel_single' },
      });
      expect(screen.getByTestId('raw-source-detail')).toBeTruthy();
      expect(screen.getByTestId('raw-source-mode-change-hint').textContent).toContain('改为');
      expect(screen.queryByTestId('raw-source-detail-tables')).toBeNull();
      expect(screen.queryByTestId('raw-source-refresh')).toBeNull();
      await waitFor(() =>
        expect(screen.getByTestId('raw-source-mode-editor').textContent).toContain('关联说明')
      );
      fireEvent.click(screen.getByTestId('raw-source-mode-cancel'));
      expect(screen.queryByTestId('raw-source-mode-change')).toBeNull();
      expect(screen.getByTestId('raw-source-detail-tables')).toBeTruthy();
      expect((screen.getByTestId('raw-source-build-mode') as HTMLSelectElement).value).toBe(
        'excel_per_sheet'
      );
      expect(client.rebuildRawSource).not.toHaveBeenCalled();
      expect(h.onRebuilt).not.toHaveBeenCalled();
    });

    it('picking the original mode again also cancels', async () => {
      renderDetail();
      const select = screen.getByTestId('raw-source-build-mode');
      fireEvent.change(select, { target: { value: 'excel_single' } });
      expect(screen.getByTestId('raw-source-mode-change')).toBeTruthy();
      fireEvent.change(select, { target: { value: 'excel_per_sheet' } });
      expect(screen.queryByTestId('raw-source-mode-change')).toBeNull();
    });

    it('保存 opens the delete confirmation, then rebuilds and reports back', async () => {
      const result = { source: { id: 's1' }, tables: [{ id: 'n1' }], skipped: [] };
      client.rebuildRawSource.mockResolvedValue(result);
      const h = renderDetail();
      fireEvent.change(screen.getByTestId('raw-source-build-mode'), {
        target: { value: 'excel_single' },
      });
      const save = screen.getByTestId('raw-source-mode-save') as HTMLButtonElement;
      await waitFor(() => expect(save.disabled).toBe(false));
      fireEvent.click(save);
      const confirm = await screen.findByTestId('raw-source-rebuild-confirm');
      expect(client.rebuildRawSource).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId('raw-source-rebuild-ack'));
      fireEvent.click(confirm);
      await waitFor(() =>
        expect(client.rebuildRawSource).toHaveBeenCalledWith(
          expect.objectContaining({
            sourceId: 's1',
            buildMode: 'excel_single',
            confirmDeleteExistingTables: true,
          })
        )
      );
      await waitFor(() => expect(h.onRebuilt).toHaveBeenCalledWith(result));
      expect(h.onChanged).toHaveBeenCalled();
      expect(screen.queryByTestId('raw-source-mode-change')).toBeNull();
    });
  });

  describe('数据 tab table switcher', () => {
    const three = () => [table('客户'), table('商品'), table('订单', { rowCount: 180 })];
    const lastPreviewId = () => client.previewRawTable.mock.calls.at(-1)?.[0].id;

    it('defaults to the first table, switches via tabs, and keeps config / title in sync', async () => {
      renderDetail(source({ id: 'sw1' }), three());
      fireEvent.click(screen.getByTestId('raw-source-detail-tab-data'));
      const tabs = screen.getAllByTestId('raw-source-switcher-tab');
      expect(tabs).toHaveLength(3);
      expect(tabs[2].textContent).toContain('180');
      await waitFor(() => expect(lastPreviewId()).toBe('客户'));
      expect(screen.getByTestId('raw-source-detail-current').textContent).toBe('/ 客户');
      fireEvent.click(tabs[2]);
      await waitFor(() => expect(lastPreviewId()).toBe('订单'));
      expect(screen.getByTestId('raw-source-detail-current').textContent).toBe('/ 订单');
      expect(screen.queryByText(/预览：/)).toBeNull();
      fireEvent.click(screen.getByTestId('raw-source-detail-tab-config'));
      const rows = screen.getAllByTestId('raw-source-member-row');
      expect(rows[2].className).toContain('bg-accent-muted');
      fireEvent.click(rows[1]);
      fireEvent.click(screen.getByTestId('raw-source-detail-tab-data'));
      await waitFor(() => expect(lastPreviewId()).toBe('商品'));
    });

    it('opens on the child picked in the list, else the last viewed table', async () => {
      renderDetail(source({ id: 'sw2' }), three(), { initialTableId: '订单' });
      fireEvent.click(screen.getByTestId('raw-source-detail-tab-data'));
      await waitFor(() => expect(lastPreviewId()).toBe('订单'));
      fireEvent.click(screen.getAllByTestId('raw-source-switcher-tab')[1]);
      await waitFor(() => expect(lastPreviewId()).toBe('商品'));
      cleanup();
      renderDetail(source({ id: 'sw2' }), three());
      fireEvent.click(screen.getByTestId('raw-source-detail-tab-data'));
      await waitFor(() => expect(lastPreviewId()).toBe('商品'));
    });

    it('uses a searchable dropdown for many tables and marks missing ones', async () => {
      const many = ['a1', 'a2', 'a3', 'a4', 'a5', 'b6'].map((id) =>
        table(id, id === 'b6' ? { memberStatus: 'missing' } : {})
      );
      renderDetail(source({ id: 'sw3' }), many);
      fireEvent.click(screen.getByTestId('raw-source-detail-tab-data'));
      expect(screen.queryAllByTestId('raw-source-switcher-tab')).toHaveLength(0);
      fireEvent.click(screen.getByTestId('raw-source-switcher-trigger'));
      fireEvent.change(screen.getByTestId('raw-source-switcher-search'), {
        target: { value: 'b' },
      });
      const options = screen.getAllByTestId('raw-source-switcher-option');
      expect(options).toHaveLength(1);
      expect(options[0].className).toContain('text-warning');
      fireEvent.click(options[0]);
      await waitFor(() => expect(lastPreviewId()).toBe('b6'));
      expect(screen.getByTestId('raw-source-switcher-missing').textContent).toBe('上次导入的数据');
    });

    it('has no switcher for single-table or merged sources', () => {
      renderDetail(source({ id: 'sw4', sourceKind: 'folder', buildMode: 'folder_merge' }), [
        table('m1'),
      ]);
      fireEvent.click(screen.getByTestId('raw-source-detail-tab-data'));
      expect(screen.queryByTestId('raw-source-switcher')).toBeNull();
      expect(screen.queryByTestId('raw-source-detail-current')).toBeNull();
    });
  });
});
