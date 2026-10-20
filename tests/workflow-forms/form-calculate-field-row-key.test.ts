import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it, vi } from 'vitest';
import type { CalculationRow } from '../../src/shared/calculate-field';

vi.mock('../../src/renderer/hooks/useUpdateConfig', () => ({
  useUpdateConfig: () => () => undefined,
}));
vi.mock('../../src/renderer/hooks/useFormTranslation', () => ({
  useFormTranslation: () => (key: string) => key,
}));
vi.mock('../../src/renderer/hooks/useWorkflowNodeColumnTypes', () => ({
  useWorkflowNodeColumnTypes: () => ({}),
}));

import FormCalculateField, {
  validateCalculationRows,
} from '../../src/renderer/components/workflow-forms/FormCalculateField';

type FormProps = ComponentProps<typeof FormCalculateField>;

function renderForm(calculations: CalculationRow[]): string {
  const props = {
    node: { config: { calculations } },
    fieldCompletions: ['amount', 'tax'],
    sourceNode: undefined,
    pipelineId: 'pipeline-1',
    onNodeChange: () => undefined,
  } as unknown as FormProps;
  return renderToStaticMarkup(createElement(FormCalculateField, props));
}

describe('FormCalculateField grid rows', () => {
  it('keys grid rows by the persisted calculation id', () => {
    const source = readFileSync(
      resolve(__dirname, '../../src/renderer/components/workflow-forms/FormCalculateField.tsx'),
      'utf8'
    );
    expect(source).toContain('<Fragment key={calculation.id}>');
    const html = renderForm([
      { id: 'calc-b', field: 'b', expression: '[tax]', action: 'add' } as CalculationRow,
    ]);
    expect(html).toContain('calculate-field-row-0');
    expect(html).not.toContain('calculate-field-row-1');
  });

  it('disables add and copy actions after reaching the schema row limit', () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({
      id: `calc-${index}`,
      field: `field_${index}`,
      expression: String(index),
      action: 'add' as const,
    }));
    const html = renderForm(rows as CalculationRow[]);
    // The trailing AddRow is disabled once the limit is reached.
    expect(html).toMatch(/<button[^>]*class="opg-c add"[^>]*disabled=""/);
  });
});

describe('validateCalculationRows', () => {
  it('flags duplicate targets, upstream conflicts and formula issues', () => {
    const issues = validateCalculationRows(
      [
        { field: 'double', expression: '[amount] * 2', action: 'add' },
        { field: 'tax', expression: 'round([tax], 2)', action: 'replace' },
        { field: 'double', expression: '[missing] * (', action: 'add' },
        { field: 'amount', expression: '[double] + 1', action: 'add' },
      ],
      ['amount', 'tax']
    );
    expect(issues[0]).toEqual({
      duplicateOf: undefined,
      upstreamConflict: false,
      formulaIssues: 0,
    });
    expect(issues[1].upstreamConflict).toBe(false);
    expect(issues[2]).toMatchObject({ duplicateOf: 0, formulaIssues: 2 });
    // Earlier rows' new fields are known to later formulas.
    expect(issues[3]).toMatchObject({ upstreamConflict: true, formulaIssues: 0 });
  });
});
