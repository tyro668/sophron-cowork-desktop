import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const measureMaxTextWidth = vi.hoisted(() => vi.fn(() => 180));

vi.mock(
  '../../src/renderer/components/workflow-forms/shared/dropdownWidth',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('../../src/renderer/components/workflow-forms/shared/dropdownWidth')
    >()),
    measureMaxTextWidth,
  })
);

import { GlassOptionSingleSelect } from '../../src/renderer/components/workflow-forms/shared/GlassOptionSingleSelect';
import { computeDropdownWidth } from '../../src/renderer/components/workflow-forms/shared/dropdownWidth';

describe('dropdown width measurement', () => {
  it('caps the dropdown width at twice the trigger width', () => {
    expect(computeDropdownWidth(200, 160)).toEqual({ minWidth: 200, maxWidth: 400 });
    expect(computeDropdownWidth(200, 320)).toEqual({ minWidth: 320, maxWidth: 400 });
    expect(computeDropdownWidth(200, 600)).toEqual({ minWidth: 400, maxWidth: 400 });
  });

  it('does not measure option layout while the closed select is rendering', () => {
    renderToStaticMarkup(
      createElement(GlassOptionSingleSelect, {
        value: 'sum',
        groups: [{ key: 'functions', items: [{ value: 'sum', label: 'Sum' }] }],
        onChange: () => undefined,
      })
    );

    expect(measureMaxTextWidth).not.toHaveBeenCalled();
  });
});
