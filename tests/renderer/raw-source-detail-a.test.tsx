// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18n from './i18n-test';

const client = vi.hoisted(() => ({
  setRawSourceAutoInclude: vi.fn(),
  previewRawTable: vi.fn(),
  refreshRawSource: vi.fn(),
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

function renderDetail(src = source(), tables = [table('客户主数据'), table('关联说明')]) {
  const fixed = {
    ...(src as object),
    memberIds: (tables as Array<{ id: string }>).map((t) => t.id),
  };
  const handlers = {
    onBack: vi.fn(),
    onOpenTable: vi.fn(),
    onChangeMode: vi.fn(),
    onChanged: vi.fn(),
  };
  render(<RawSourceDetail source={fixed as never} rawTables={tables} {...handlers} />);
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

  it('build-mode change goes through onChangeMode; actions preview / open', async () => {
    const h = renderDetail();
    fireEvent.change(screen.getByTestId('raw-source-build-mode'), {
      target: { value: 'excel_merge_sheets' },
    });
    expect(h.onChangeMode).toHaveBeenCalledWith(expect.anything(), 'excel_merge_sheets');
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
});
