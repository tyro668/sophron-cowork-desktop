import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/renderer/hooks/useFormTranslation', () => ({
  useFormTranslation: () => (key: string) => key,
}));

vi.mock('../../src/renderer/hooks/useUpdateConfig', () => ({
  useUpdateConfig: () => () => undefined,
}));

import { VennDiagramIcon } from '../../src/renderer/components/workflow-forms/shared/VennDiagramIcon';
import { JoinVennSVG } from '../../src/renderer/components/workflow-forms/join/JoinVennIcon';
import FormSetOp from '../../src/renderer/components/workflow-forms/FormSetOp';

describe('VennDiagramIcon', () => {
  it('renders shared overlap and left-only geometry', () => {
    const overlap = renderToStaticMarkup(createElement(VennDiagramIcon, { region: 'overlap' }));
    const leftOnly = renderToStaticMarkup(createElement(VennDiagramIcon, { region: 'left-only' }));

    expect(overlap).toContain('data-venn-region="overlap"');
    expect(overlap).toContain('clip-path="url(#');
    expect(leftOnly).toContain('data-venn-region="left-only"');
    expect(leftOnly).toContain('mask="url(#');
  });

  it('maps join modes onto shared regions while retaining special icons', () => {
    const full = renderToStaticMarkup(createElement(JoinVennSVG, { type: 'full', selected: true }));
    const anti = renderToStaticMarkup(
      createElement(JoinVennSVG, { type: 'anti', selected: false })
    );
    const asof = renderToStaticMarkup(createElement(JoinVennSVG, { type: 'asof', selected: true }));

    expect(full).toContain('data-venn-region="both"');
    expect(anti).toContain('data-venn-region="left-only"');
    expect(asof).not.toContain('data-venn-region');
  });

  it('distinguishes semi join from inner join by emphasizing the output-side outline', () => {
    const inner = renderToStaticMarkup(
      createElement(JoinVennSVG, { type: 'inner', selected: true })
    );
    const semi = renderToStaticMarkup(createElement(JoinVennSVG, { type: 'semi', selected: true }));

    expect(inner).toContain('data-venn-region="overlap"');
    expect(semi).toContain('data-venn-region="overlap"');
    expect(inner).not.toContain('opacity="0.65"');
    expect(semi).toContain('opacity="0.65"');
    expect(semi).toContain('opacity="0.18"');
  });

  it('maps every set operation and uses the same icon size as join modes', () => {
    const html = renderToStaticMarkup(
      createElement(FormSetOp, {
        node: { config: {} },
        otherNodes: [],
        sourceNode: undefined,
        onNodeChange: () => undefined,
      } as unknown as ComponentProps<typeof FormSetOp>)
    );

    expect(html).toContain('data-venn-region="both"');
    expect(html).toContain('data-venn-region="overlap"');
    expect(html).toContain('data-venn-region="left-only"');
    expect(html.match(/class="h-4 w-6 shrink-0"/g)).toHaveLength(3);
  });
});
