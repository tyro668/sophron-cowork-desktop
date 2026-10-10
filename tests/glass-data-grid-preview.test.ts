import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@glideapps/glide-data-grid', async () => {
  const { createElement: createMockElement } = await import('react');
  return {
    default: ({ rows }: { rows: number }) =>
      createMockElement('div', { 'data-preview-grid': true, 'data-row-count': rows }),
    GridCellKind: {
      Boolean: 'boolean',
      Number: 'number',
      Text: 'text',
    },
    GridColumnIcon: {
      HeaderBoolean: 'boolean',
      HeaderDate: 'date',
      HeaderNumber: 'number',
      HeaderString: 'string',
      HeaderTime: 'time',
    },
  };
});

import { GlassDataGridPreview } from '../src/renderer/components/GlassDataGridPreview';

const labels = {
  loading: 'Loading',
  empty: 'Run the pipeline first',
  total: (count: number) => `${count} rows`,
  pageSize: (count: number) => `${count} rows per page`,
};

describe('GlassDataGridPreview', () => {
  it('shows cached columns even when the executed result has zero rows', () => {
    const html = renderToStaticMarkup(
      createElement(GlassDataGridPreview, {
        preview: {
          columns: ['id', 'amount'],
          columnTypes: [],
          rows: [],
          fileCount: 1,
          limit: 100,
          offset: 0,
          totalRows: 0,
        },
        labels,
      })
    );

    expect(html).toContain('data-preview-grid="true"');
    expect(html).toContain('data-row-count="0"');
    expect(html).toContain('0 rows');
    expect(html).not.toContain('Run the pipeline first');
  });

  it('keeps the run-first state when no cached columns are available', () => {
    const html = renderToStaticMarkup(
      createElement(GlassDataGridPreview, {
        preview: {
          columns: [],
          columnTypes: [],
          rows: [],
          fileCount: 0,
          limit: 100,
          offset: 0,
          totalRows: 0,
        },
        labels,
      })
    );

    expect(html).toContain('Run the pipeline first');
    expect(html).not.toContain('data-preview-grid="true"');
  });
});
