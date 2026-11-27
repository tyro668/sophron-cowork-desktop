// @vitest-environment happy-dom
/**
 * Formula editor: an expression that fails validation can never be saved, and the removed
 * case … when form offers a one-click rewrite to if … elseif.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import './i18n-test';
import {
  COMMON_EXPRESSION_FUNCTION_GROUPS,
  GlassExpressionInput,
} from '../../src/renderer/components/workflow-forms/shared/GlassExpressionInput';
import { CalculateFieldExpressionInput } from '../../src/renderer/components/workflow-forms/calculate-field/CalculateFieldExpressionInput';
import {
  CALCULATION_FUNCTION_CATEGORIES,
  calculationFunctionsByCategory,
} from '../../src/shared/calculate-field/function-registry';
import {
  buildCalculationFunctionDslExpression,
  expandCalculationDomainExpression,
} from '../../src/shared/calculate-field/domain-dsl';
import {
  WINDOW_COMPARE_FUNCTIONS,
  WINDOW_COMPARE_MODES,
  buildWindowCompareExpression,
} from '../../src/shared/calculate-field/window-compare';
import { defaultCalculationParameterValues } from '../../src/shared/calculate-field/wizard-state';
import { analyzeExpression, analyzeExpressionList } from '../../src/shared/expression';

const FIELDS = ['d', 's'];

function openEditor(value: string) {
  const onChange = vi.fn();
  render(
    <GlassExpressionInput
      value={value}
      onChange={onChange}
      fieldCompletions={FIELDS}
      columnTypes={{ d: 'INTEGER', s: 'VARCHAR' }}
    />
  );
  fireEvent.click(screen.getByTestId('expression-preview').closest('button')!);
  return onChange;
}

function confirmButton(): HTMLButtonElement {
  const grid = screen.getByTestId('formula-editor-grid');
  const buttons = Array.from(grid.ownerDocument.querySelectorAll('button'));
  return buttons.find((b) => b.getAttribute('aria-disabled') !== null)! as HTMLButtonElement;
}

describe('expression editor save guard', () => {
  it('blocks saving an invalid expression', async () => {
    const onChange = openEditor('[d] +');
    const confirm = confirmButton();
    await waitFor(() => expect(confirm.disabled).toBe(true));
    fireEvent.click(confirm);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('accepts elseif and saves it', async () => {
    const expr = "if [d] > 30 then 'late' elseif [s] in ('A', 'B') then 'ab' else 'ok' end";
    const onChange = openEditor(expr);
    const confirm = confirmButton();
    await waitFor(() => expect(confirm.disabled).toBe(false));
    fireEvent.click(confirm);
    expect(onChange).toHaveBeenCalledWith(expr);
  });

  it('case is blocked and the quick-fix rewrites it to if … elseif', async () => {
    const onChange = openEditor("case [s] when 'A' then 1 when 'B' then 2 else 0 end");
    const confirm = confirmButton();
    await waitFor(() => expect(confirm.disabled).toBe(true));
    expect(screen.getByTestId('expression-grammar-error').textContent).toMatch(/elseif/);
    fireEvent.click(screen.getByTestId('expression-case-quickfix'));
    await waitFor(() => expect(confirmButton().disabled).toBe(false));
    fireEvent.click(confirmButton());
    expect(onChange).toHaveBeenCalledWith("if [s] = 'A' then 1 elseif [s] = 'B' then 2 else 0 end");
  });

  it('keeps fixed sharp dialog dimensions across Formula and Calculation Wizard tabs', async () => {
    render(
      <CalculateFieldExpressionInput
        value="[d] + 1"
        onChange={vi.fn()}
        fieldCompletions={FIELDS}
        columnTypes={{ d: 'INTEGER', s: 'VARCHAR' }}
      />
    );
    fireEvent.click(screen.getByTestId('expression-preview').closest('button')!);
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('rounded-none');
    expect(dialog.className).toContain('h-[600px]');
    expect(dialog.className).toContain('w-[960px]');

    const wizardTab = screen.getByRole('button', { name: /Calculation wizard|计算向导/ });
    fireEvent.click(wizardTab);
    expect(dialog.className).toContain('h-[600px]');
    expect(screen.getByTestId('calc-wizard-generated-preview')).toBeTruthy();

    const formulaTab = screen.getByRole('button', { name: /Formula|公式编写/ });
    fireEvent.click(formulaTab);
    expect(dialog.className).toContain('h-[600px]');
  });

  it('accepts and saves calculation wizard domain DSL formulas without Unknown function errors', async () => {
    const onChange = vi.fn();
    const wizardExpr = 'group(count([d])) over(partition by [s])';
    render(
      <CalculateFieldExpressionInput
        value={wizardExpr}
        onChange={onChange}
        fieldCompletions={FIELDS}
        columnTypes={{ d: 'INTEGER', s: 'VARCHAR' }}
      />
    );
    fireEvent.click(screen.getByTestId('expression-preview').closest('button')!);
    expect(screen.queryByTestId('expression-grammar-error')).toBeNull();
    const confirm = confirmButton();
    await waitFor(() => expect(confirm.disabled).toBe(false));
    fireEvent.click(confirm);
    expect(onChange).toHaveBeenCalledWith(wizardExpr);
  });

  it('validates every calculation wizard function after domain DSL expansion', () => {
    const colTypes = { a: 'decimal', dt: 'date', g: 'text' };
    const failures: string[] = [];
    for (const category of CALCULATION_FUNCTION_CATEGORIES) {
      for (const def of calculationFunctionsByCategory(category)) {
        const parameters = defaultCalculationParameterValues(def.parameters);
        for (const param of def.parameters ?? []) {
          if (param.kind === 'temporal-field') parameters[param.key] = 'dt';
        }
        const dsl = buildCalculationFunctionDslExpression({
          functionId: def.id,
          value: def.valueArgument === 'none' ? undefined : 'a',
          extraParameter: def.extraParameter?.defaultValue,
          partitionBy: ['g'],
          orderBy: def.order === 'required' ? [{ field: 'dt', direction: 'asc' }] : [],
          frame:
            def.frame === 'custom'
              ? { type: 'rows', start: '2 preceding', end: 'current row', exclude: 'no others' }
              : undefined,
          parameters,
        });
        const expanded = expandCalculationDomainExpression(dsl, { allowLegacySql: true });
        const result = analyzeExpression(expanded, colTypes);
        if (!result.ok) {
          failures.push(`${category}/${def.id}: ${result.error?.message} (${expanded})`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('validates embedded domain DSL, window compare modes, metric lists and all editor catalog examples', () => {
    const colTypes = { a: 'decimal', dt: 'date', g: 'text' };

    // Embedded wizard DSL inserted inside a compound formula.
    const embedded = '[a] - group(avg([a])) over(partition by [g])';
    const expandedEmbedded = expandCalculationDomainExpression(embedded, { allowLegacySql: true });
    expect(analyzeExpression(expandedEmbedded, colTypes).ok).toBe(true);

    // Every window-compare function × mode × partition/sort combination.
    for (const fn of WINDOW_COMPARE_FUNCTIONS) {
      for (const mode of WINDOW_COMPARE_MODES) {
        const expr = buildWindowCompareExpression({
          fn,
          field: fn === 'count' ? '*' : 'a',
          partitionBy: ['g'],
          orderBy: [{ field: 'dt', direction: 'desc' }],
          mode,
        });
        expect(analyzeExpression(expr, colTypes).ok, `${fn}/${mode}: ${expr}`).toBe(true);
      }
    }

    // Special calculation wizard configs: temporal range, exclude, fiscal year, rolling_time.
    const specialCases = [
      buildCalculationFunctionDslExpression({
        functionId: 'moving_avg',
        value: 'a',
        partitionBy: ['g'],
        orderBy: [{ field: 'dt', direction: 'asc' }],
        frame: {
          type: 'range',
          start: 'interval 7 day preceding',
          end: 'current row',
          exclude: 'current row',
        },
      }),
      buildCalculationFunctionDslExpression({
        functionId: 'year_to_date',
        value: 'a',
        partitionBy: ['g'],
        parameters: { dateField: 'dt', aggregation: 'count_distinct', fiscalStartMonth: '4' },
      }),
      buildCalculationFunctionDslExpression({
        functionId: 'rolling_time',
        value: '*',
        partitionBy: ['g'],
        parameters: {
          dateField: 'dt',
          aggregation: 'count',
          windowSize: '30',
          intervalUnit: 'day',
        },
      }),
      buildCalculationFunctionDslExpression({
        functionId: 'year_over_year_rate',
        value: 'a',
        partitionBy: ['g'],
        parameters: { dateField: 'dt', granularity: 'week' },
      }),
    ];
    for (const dsl of specialCases) {
      const expanded = expandCalculationDomainExpression(dsl, { allowLegacySql: true });
      expect(analyzeExpression(expanded, colTypes).ok, `${dsl} -> ${expanded}`).toBe(true);
    }

    // Metric argument list (e.g. string_agg).
    expect(analyzeExpressionList("[g], '-'", colTypes).ok).toBe(true);

    // Every function example listed in the formula editor catalog must parse cleanly.
    const catalogFailures: string[] = [];
    for (const group of COMMON_EXPRESSION_FUNCTION_GROUPS) {
      for (const token of group.tokens) {
        for (const example of token.examples ?? []) {
          const res = analyzeExpression(example);
          if (!res.ok) catalogFailures.push(`${token.label}: ${example} -> ${res.error?.message}`);
        }
      }
    }
    expect(catalogFailures).toEqual([]);
  });
});
