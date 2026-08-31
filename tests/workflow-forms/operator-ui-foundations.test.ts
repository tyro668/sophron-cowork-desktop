import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GlassFormTextInput } from '../../src/renderer/components/workflow-forms/shared/GlassFormTextInput';
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
});
