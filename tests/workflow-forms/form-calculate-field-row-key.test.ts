import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalculationRow } from '../../src/shared/calculate-field';

interface CapturedRowListProps {
  items: CalculationRow[];
  getKey?: (item: CalculationRow, index: number) => string;
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

vi.mock('../../src/renderer/hooks/useUpdateConfig', () => ({
  useUpdateConfig: () => () => undefined,
}));

vi.mock('../../src/renderer/hooks/useFormTranslation', () => ({
  useFormTranslation: () => (key: string) => key,
}));

vi.mock('../../src/renderer/hooks/useWorkflowNodeColumnTypes', () => ({
  useWorkflowNodeColumnTypes: () => ({}),
}));

import FormCalculateField from '../../src/renderer/components/workflow-forms/FormCalculateField';

type FormProps = ComponentProps<typeof FormCalculateField>;

function renderForm(calculations: CalculationRow[]): CapturedRowListProps {
  const props = {
    node: { config: { calculations } },
    fieldCompletions: ['amount', 'tax'],
    sourceNode: undefined,
    taskId: 'task-1',
    onNodeChange: () => undefined,
  } as unknown as FormProps;

  renderToStaticMarkup(createElement(FormCalculateField, props));

  if (!captured.rowListProps) throw new Error('FormCalculateField did not render GlassRowList');
  return captured.rowListProps;
}

describe('FormCalculateField row identity', () => {
  beforeEach(() => {
    captured.rowListProps = null;
  });

  it('keeps the surviving expression row key stable after the preceding row is removed', () => {
    const first = { id: 'calc-a', field: 'a', expression: '[amount]', action: 'add' } as const;
    const second = { id: 'calc-b', field: 'b', expression: '[tax]', action: 'add' } as const;

    const beforeRemoval = renderForm([first, second]);
    const keyBeforeRemoval = beforeRemoval.getKey?.(beforeRemoval.items[1], 1);

    const afterRemoval = renderForm([second]);
    const keyAfterRemoval = afterRemoval.getKey?.(afterRemoval.items[0], 0);

    expect(keyBeforeRemoval).toBe('calc-b');
    expect(keyAfterRemoval).toBe('calc-b');
  });

  it('disables add and copy actions after reaching the schema row limit', () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({
      id: `calc-${index}`,
      field: `field_${index}`,
      expression: String(index),
      action: 'add' as const,
    }));

    const rowList = renderForm(rows);

    expect(rowList.canAct?.('add', 0)).toBe(false);
    expect(rowList.canAct?.('copy', 0)).toBe(false);
    expect(rowList.canAct?.('remove', 0)).toBe(true);
  });
});
