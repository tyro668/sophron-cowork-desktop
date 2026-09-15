import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GlassFormTextInput } from '../../src/renderer/components/workflow-forms/shared/GlassFormTextInput';
import { GlassFieldCompactSelect } from '../../src/renderer/components/workflow-forms/shared/GlassFieldCompactSelect';
import { GlassOptionSingleSelect } from '../../src/renderer/components/workflow-forms/shared/GlassOptionSingleSelect';
import { GlassRadioSelect } from '../../src/renderer/components/workflow-forms/shared/GlassRadioSelect';
import { GlassRowList } from '../../src/renderer/components/workflow-forms/shared/GlassRowList';

describe('operator UI foundations', () => {
  it('renders shared text inputs with the standard operator type and control size', () => {
    const html = renderToStaticMarkup(
      createElement(GlassFormTextInput, {
        value: 'revenue',
        onChange: () => undefined,
      })
    );

    expect(html).toContain('min-h-7');
    expect(html).toContain('text-[13px]');
  });

  it('renders radio choices with a readable size, minimum height, and selected semantics', () => {
    const html = renderToStaticMarkup(
      createElement(GlassRadioSelect, {
        value: 'include',
        options: [
          { value: 'include', label: 'Include' },
          { value: 'exclude', label: 'Exclude' },
        ],
        onChange: () => undefined,
      })
    );

    expect(html).toContain('min-h-7');
    expect(html).toContain('text-[13px]');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
  });

  it('left-aligns the selected value in ordinary option selects', () => {
    const html = renderToStaticMarkup(
      createElement(GlassOptionSingleSelect, {
        value: 'sum',
        groups: [{ key: 'operators', items: [{ value: 'sum', label: 'Sum' }] }],
        onChange: () => undefined,
      })
    );

    expect(html).toContain('text-left');
    expect(html).not.toContain('text-center');
  });

  it('renders draggable row handles as keyboard-operable buttons', () => {
    const html = renderToStaticMarkup(
      createElement(GlassRowList<{ label: string }>, {
        items: [{ label: 'Revenue' }],
        columns: [
          {
            flex: 'flex-1',
            header: 'Field',
            render: (item) => item.label,
          },
        ],
        draggable: true,
        onKeyboardMove: () => undefined,
      })
    );

    expect(html).toContain('<button type="button" draggable="true"');
    expect(html).toContain('aria-keyshortcuts="ArrowUp ArrowDown"');
    expect(html).toContain('data-row-drag-handle="true"');
  });

  it('keeps compact field lists within their parent when a field name is very long', () => {
    const html = renderToStaticMarkup(
      createElement(GlassFieldCompactSelect, {
        columns: [`field_${'x'.repeat(300)}`],
        selected: [],
        onChange: () => undefined,
      })
    );

    expect(html).toContain('min-w-0 max-w-full flex-1 flex-col overflow-hidden');
    expect(html).toContain('overflow-x-hidden overflow-y-auto');
    expect(html).toContain('flex-1 min-w-0 truncate');
  });

  it.each(['FormAggregate.tsx', 'FormUnpivot.tsx'])(
    'renders %s as compact label rows with a scrollable container',
    (fileName) => {
      const source = readFileSync(
        resolve(__dirname, '../../src/renderer/components/workflow-forms', fileName),
        'utf8'
      );

      expect(source).toContain('GlassFormLabel');
      expect(source).toContain('GlassFieldMultiDropdown');
      expect(source).toContain(
        'scrollbar-hover flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-3'
      );
    }
  );
});
