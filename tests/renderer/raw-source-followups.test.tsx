// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import './i18n-test';

vi.mock('../../src/renderer/features/data/api/data-client', () => ({ dataClient: {} }));

import {
  RawSourceRefreshDialog,
  shouldShowRefreshDialog,
} from '../../src/renderer/components/data-view/raw-source-refresh-dialog';
import { groupBySource, mergeParts } from '../../src/renderer/components/data-view/raw-tables';
import { rawTableOptionsBySource } from '../../src/renderer/components/data-view/data-pipelines/workflow/WorkflowInputSourceConfig';
import { groupOptions } from '../../src/renderer/components/GlassSelect';

const source = (patch: Record<string, unknown> = {}) => ({
  id: 's1',
  name: '9月经营数据.xlsx',
  sourcePath: '/d/9月经营数据.xlsx',
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
  rowCount: 8,
  updatedAt: 1,
  sourceId: 's1',
  inputConfig: { sourceKind: 'excel' },
  ...patch,
});
const refreshResult = (patch: Record<string, unknown> = {}) => ({
  source: source(),
  refreshed: [],
  added: [],
  missing: [],
  failed: [],
  renames: [
    { tableId: 't1', tableName: '目标', oldKey: '目标', newKey: '9月目标', similarity: 0.96 },
  ],
  addedItems: [{ id: 't9', name: '10月目标', key: '10月目标', pipelineNames: [] }],
  missingItems: [{ id: 't2', name: '汇总', key: '汇总', pipelineNames: ['月报'] }],
  unchangedNames: ['销售流水'],
  ...patch,
});

describe('refresh result dialog (4.3)', () => {
  it('opens only for renames or referenced missing tables', () => {
    expect(shouldShowRefreshDialog(refreshResult() as never)).toBe(true);
    expect(
      shouldShowRefreshDialog(
        refreshResult({
          renames: [],
          missingItems: [{ id: 'x', name: 'x', key: 'x', pipelineNames: [] }],
        }) as never
      )
    ).toBe(false);
  });

  it('defaults to "same table" and lets the user treat a rename as new', () => {
    const onApply = vi.fn();
    render(
      <RawSourceRefreshDialog
        result={refreshResult() as never}
        onLater={vi.fn()}
        onApply={onApply}
      />
    );
    expect(screen.getByText(/目标 → 9月目标/)).toBeTruthy();
    expect(screen.getByText(/96%/)).toBeTruthy();
    expect(screen.getByTitle('月报')).toBeTruthy();
    expect(screen.queryByText(/销售流水/)).toBeNull();
    fireEvent.click(screen.getByTestId('raw-source-refresh-unchanged'));
    expect(screen.getByText(/销售流水/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('raw-source-refresh-apply'));
    expect(onApply).toHaveBeenLastCalledWith([
      { tableId: 't1', newKey: '9月目标', action: 'rename' },
    ]);
    fireEvent.click(screen.getByTestId('raw-source-rename-new'));
    fireEvent.click(screen.getByTestId('raw-source-refresh-apply'));
    expect(onApply).toHaveBeenLastCalledWith([{ tableId: 't1', newKey: '9月目标', action: 'new' }]);
  });
});

describe('input picker grouped by source (4.4)', () => {
  it('groups multi-table and merged sources, searches by source name, mutes missing tables', () => {
    const t = (key: string) => key;
    const options = rawTableOptionsBySource(
      [
        table('销售流水'),
        table('九月目标', { memberStatus: 'missing' }),
        table('独立表', { sourceId: 's2' }),
        table('考勤（合并）', { sourceId: 's3' }),
      ] as never,
      [
        source({ memberIds: ['销售流水', '九月目标'] }),
        source({ id: 's2', name: '独立.csv', memberIds: ['独立表'], buildMode: 'single' }),
        source({
          id: 's3',
          name: '考勤导出',
          memberIds: ['考勤（合并）'],
          buildMode: 'folder_merge',
        }),
      ] as never,
      t
    );
    const sections = groupOptions(options);
    expect(sections.map((section) => section.label || '(flat)')).toEqual([
      '9月经营数据.xlsx',
      '考勤导出',
      '(flat)',
    ]);
    expect(sections[1].meta).toBe('data.rawSources.list.mergeBadge');
    const missing = options.find((option) => option.label === '九月目标')!;
    expect(missing.muted).toBe(true);
    expect(missing.searchText).toBe('9月经营数据.xlsx');
  });
});

describe('expandable merged sources', () => {
  it('marks merged sheets that were missing at the last refresh', () => {
    const merged = table('月报（合并）', {
      inputConfig: {
        sourceKind: 'excel',
        mergeSheets: ['一月', '二月'],
        missingMergeSheets: ['二月'],
      },
    });
    expect(mergeParts(merged as never)).toEqual([
      { name: '一月', included: true },
      { name: '二月', included: false, reason: 'missing_sheet' },
    ]);
  });

  it('lists included and excluded files of a folder merge when expanded', () => {
    const merged = table('门店（合并）', {
      inputConfig: {
        sourceKind: 'folder',
        mergeReport: {
          includedFiles: ['北京.xlsx', '上海.xlsx'],
          missingSheetFiles: ['广州.xlsx'],
          typeConflictFiles: [],
        },
      },
    });
    expect(mergeParts(merged as never)?.map((part) => [part.name, part.included])).toEqual([
      ['北京.xlsx', true],
      ['上海.xlsx', true],
      ['广州.xlsx', false],
    ]);
    const sources = [source({ memberIds: ['门店（合并）'], buildMode: 'folder_merge' })];
    expect(groupBySource([merged] as never, sources as never)).toHaveLength(1);
    const expanded = groupBySource([merged] as never, sources as never, new Set(['门店（合并）']));
    expect(expanded.map((row) => row.kind)).toEqual(['rawTable', 'part', 'part', 'part']);
    expect(mergeParts(table('plain') as never)).toBeNull();
  });
});
