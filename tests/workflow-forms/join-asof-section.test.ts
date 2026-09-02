import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JoinCondition } from '../../src/shared/operator-schemas';
import type { JoinAsofPatch } from '../../src/renderer/components/workflow-forms/join/JoinAsofSection';

interface CapturedRowListProps {
  items: JoinCondition[];
  onAdd?: (index: number) => void;
  onRemove?: (index: number) => void;
  canAct?: (action: 'add' | 'copy' | 'remove', index: number) => boolean;
}

const captured = vi.hoisted(() => ({ rowListProps: null as CapturedRowListProps | null }));

vi.mock('../../src/renderer/components/workflow-forms/shared/GlassRowList', async () => {
  const React = await import('react');
  return {
    GlassRowList: (props: CapturedRowListProps) => {
      captured.rowListProps = props;
      return React.createElement('div');
    },
  };
});

vi.mock('../../src/renderer/hooks/useFormTranslation', () => ({
  useFormTranslation: () => (key: string) => key,
}));

import { JoinAsofSection } from '../../src/renderer/components/workflow-forms/join/JoinAsofSection';

const DEFAULT_ASOF = {
  leftTime: '',
  operator: '>=',
  rightTime: '',
  by: [],
  tolerance: '',
};

function renderSection(
  by: JoinCondition[],
  onAsofChange: (patch: JoinAsofPatch) => void
): CapturedRowListProps {
  renderToStaticMarkup(
    createElement(JoinAsofSection, {
      asof: { ...DEFAULT_ASOF, by },
      leftFields: ['created_at', 'id'],
      rightFields: ['created_at', 'id'],
      leftColumnTypes: { created_at: 'datetime', id: 'integer' },
      rightColumnTypes: { created_at: 'datetime', id: 'integer' },
      leftAlias: 'L',
      rightAlias: 'R',
      onAsofChange,
    })
  );

  if (!captured.rowListProps) throw new Error('JoinAsofSection did not render GlassRowList');
  return captured.rowListProps;
}

describe('JoinAsofSection', () => {
  beforeEach(() => {
    captured.rowListProps = null;
  });

  it('adds a second condition on the first click when only the placeholder row is shown', () => {
    const patches: JoinAsofPatch[] = [];
    const rowList = renderSection([], (patch) => patches.push(patch));

    expect(rowList.items).toEqual([{ left: '', operator: '=', right: '' }]);
    rowList.onAdd?.(0);

    expect(patches).toEqual([
      {
        by: [
          { left: '', operator: '=', right: '' },
          { left: '', operator: '=', right: '' },
        ],
      },
    ]);
  });

  it('removes the selected ASOF condition and emits the remaining rows', () => {
    const patches: JoinAsofPatch[] = [];
    const conditions: JoinCondition[] = [
      { left: 'L.id', operator: '=', right: 'R.id' },
      { left: 'L.region', operator: '=', right: 'R.region' },
    ];
    const rowList = renderSection(conditions, (patch) => patches.push(patch));

    rowList.onRemove?.(0);

    expect(patches).toEqual([{ by: [conditions[1]] }]);
  });
});
