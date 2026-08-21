import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GlassFormTextInput } from '../../src/renderer/components/workflow-forms/shared/GlassFormTextInput';
import { GlassOptionSingleSelect } from '../../src/renderer/components/workflow-forms/shared/GlassOptionSingleSelect';
import { GlassRadioSelect } from '../../src/renderer/components/workflow-forms/shared/GlassRadioSelect';

describe('operator UI foundations', () => {
  it('renders shared text inputs with the standard operator type and control size', () => {
    const html = renderToStaticMarkup(
      createElement(GlassFormTextInput, {
        value: 'revenue',
        onChange: () => undefined,
      })
    );

    expect(html).toContain('min-h-8');
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

    expect(html).toContain('min-h-8');
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
});
