// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import './i18n-test';

vi.mock('../../src/renderer/features/data/api/data-client', () => ({ dataClient: {} }));

import { upstreamRawNames } from '../../src/renderer/components/data-view/result-tables';
import { DataObjectCards } from '../../src/renderer/components/message/DataObjectCards';

describe('result table lineage', () => {
  const raws = [
    { id: 'r1', name: '经营 / 订单', relatedPipelineNames: ['join'] },
    { id: 'r2', name: '经营 / 客户', relatedPipelineNames: ['join', 'other'] },
    { id: 'r3', name: '别的表', relatedPipelineNames: [] },
  ];
  it('lists every raw child table the pipeline reads', () => {
    expect(
      upstreamRawNames({ sourceRawTableId: null }, { name: 'join', sourceRawTableId: 'r1' }, raws)
    ).toEqual(['经营 / 订单', '经营 / 客户']);
  });
  it('prefers the copy source and falls back to the pipeline primary input', () => {
    expect(upstreamRawNames({ sourceRawTableId: 'r3' }, null, raws)).toEqual(['别的表']);
    expect(
      upstreamRawNames({ sourceRawTableId: null }, { name: 'x', sourceRawTableId: 'r3' }, raws)
    ).toEqual(['别的表']);
    expect(upstreamRawNames({ sourceRawTableId: null }, null, raws)).toEqual(['—']);
  });
});

describe('chat data object cards', () => {
  afterEach(() => {
    delete (window as { electronAPI?: unknown }).electronAPI;
  });
  it('marks a deleted table and disables opening it', async () => {
    (window as { electronAPI?: unknown }).electronAPI = {
      data: {
        getRawTable: vi.fn(async (id: string) => (id === 'gone' ? null : { id })),
        getPipeline: vi.fn(async () => ({ id: 'p' })),
        getResultTable: vi.fn(async () => ({ id: 'r' })),
      },
    };
    render(
      <DataObjectCards
        objects={[
          { kind: 'raw_table', id: 'gone', name: '门店 / 西区' },
          { kind: 'raw_table', id: 'ok', name: '门店 / 东区' },
        ]}
      />
    );
    await waitFor(() =>
      expect(screen.getByText('门店 / 西区').closest('[data-deleted]')).not.toBeNull()
    );
    const cards = screen.getAllByRole('button');
    expect(cards[0]).toHaveProperty('disabled', true);
    expect(cards[1]).toHaveProperty('disabled', false);
    expect(screen.getByText('门店 / 东区').closest('[data-deleted]')).toBeNull();
  });
});
