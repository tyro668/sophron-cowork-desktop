import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/renderer/hooks/useFormTranslation', () => ({
  useFormTranslation: (ns?: string) => (key: string, params?: Record<string, unknown>) =>
    `${ns}.${key}${params ? JSON.stringify(params) : ''}`,
}));

vi.mock('../../src/renderer/hooks/useUpdateConfig', () => ({
  useUpdateConfig: () => () => undefined,
}));

vi.mock('../../src/renderer/hooks/useWorkflowNodeColumnTypes', () => ({
  useWorkflowNodeColumnTypes: () => ({ amount: 'decimal', created_at: 'datetime', name: 'text' }),
}));

vi.mock('../../src/renderer/hooks/useWorkflowNodeColumnValues', () => ({
  useWorkflowNodeColumnValues: () => ({
    values: ['a', 'b'],
    loading: false,
    loaded: true,
    error: false,
    reload: () => undefined,
  }),
}));

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, params?: Record<string, unknown>) =>
        `${key}${params ? JSON.stringify(params) : ''}`,
      i18n: { language: 'zh' },
    }),
  };
});

import FormSort from '../../src/renderer/components/workflow-forms/FormSort';
import FormTypeConvert from '../../src/renderer/components/workflow-forms/FormTypeConvert';
import FormFieldMapping from '../../src/renderer/components/workflow-forms/FormFieldMapping';
import FormLimit from '../../src/renderer/components/workflow-forms/FormLimit';
import FormSetOp from '../../src/renderer/components/workflow-forms/FormSetOp';
import FormUnnest from '../../src/renderer/components/workflow-forms/FormUnnest';
import FormUnpivot from '../../src/renderer/components/workflow-forms/FormUnpivot';
import FormMissingValue from '../../src/renderer/components/workflow-forms/FormMissingValue';
import FormAggregate from '../../src/renderer/components/workflow-forms/FormAggregate';
import FormJoin from '../../src/renderer/components/workflow-forms/FormJoin';
import FormPivot from '../../src/renderer/components/workflow-forms/FormPivot';
import FormCalculateField from '../../src/renderer/components/workflow-forms/FormCalculateField';

const baseProps = {
  node: { config: {} },
  pipelineId: 'pipeline-1',
  fieldCompletions: ['amount', 'created_at', 'name'],
  otherNodes: [],
  sourceNode: { id: 'src', type: 'input_source', config: { tableName: 'orders' } },
  rightSourceNode: { id: 'right', type: 'input_source', config: { tableName: 'refunds' } },
  upstreamRowCount: 100,
  onNodeChange: () => undefined,
};

function render<T extends object>(
  Component: ComponentType<T>,
  config: Record<string, unknown> = {}
) {
  return renderToStaticMarkup(
    createElement(Component, { ...baseProps, node: { config } } as unknown as T)
  );
}

describe('rewritten operator forms render', () => {
  it('FormSort', () => {
    const html = render(FormSort, { orderBy: [{ field: 'amount', direction: 'desc' }] });
    expect(html).toContain('sortKeys');
  });

  it('FormTypeConvert', () => {
    const html = render(FormTypeConvert, {
      conversions: [{ field: 'amount', type: 'integer' }],
    });
    expect(html).toContain('typeConvert');
  });

  it('FormFieldMapping', () => {
    const html = render(FormFieldMapping, {
      mappings: [{ source: 'amount', targetMode: 'rename', targetValue: 'amt' }],
    });
    expect(html).toContain('fieldMapping');
  });

  it('FormCalculateField', () => {
    const html = render(FormCalculateField, {
      calculations: [{ field: 'total', expression: '[amount] * 2', action: 'add' }],
    });
    expect(html).toContain('calculateField');
  });

  it('FormLimit fixed + random modes', () => {
    expect(render(FormLimit, { sampling: 'fixed', limit: 10, unit: 'rows' })).toContain(
      'limitMode'
    );
    expect(
      render(FormLimit, { sampling: 'random', limit: 10, unit: 'percent', method: 'system' })
    ).toContain('limitSampleMethod');
  });

  it('FormSetOp', () => {
    const html = render(FormSetOp, { operation: 'union', quantifier: 'all', match: 'by_name' });
    expect(html).toContain('data-venn-region="both"');
    expect(html).toContain('setOpMatchMode');
  });

  it('FormUnnest list + json modes', () => {
    expect(render(FormUnnest, { sourceKind: 'list', field: 'items', alias: 'item' })).toContain(
      'unnestIndexCol'
    );
    expect(render(FormUnnest, { sourceKind: 'json', field: 'meta' })).not.toContain(
      'unnestIndexCol'
    );
  });

  it('FormUnpivot', () => {
    const html = render(FormUnpivot, { fields: ['amount'], nameColumn: 'n', valueColumn: 'v' });
    expect(html).toContain('unpivotNullsLabel');
  });

  it('FormMissingValue both modes', () => {
    expect(
      render(FormMissingValue, {
        strategy: 'by_column',
        rules: [{ field: 'amount', method: 'literal_fill', value: '0' }],
      })
    ).toContain('missingMethodHeader');
    expect(
      render(FormMissingValue, { strategy: 'drop_rows_by_nulls', condition: 'any_null' })
    ).toContain('missingJudgeFields');
  });

  it('FormAggregate', () => {
    const html = render(FormAggregate, {
      groupBy: ['created_at'],
      metrics: [{ function: 'sum', expression: '[amount]', alias: 'total' }],
    });
    expect(html).toContain('aggregateMeasuresLabel');
  });

  it('FormJoin types', () => {
    expect(render(FormJoin, { joinType: 'inner', conditions: [] })).toContain('joinType');
    expect(render(FormJoin, { joinType: 'cross' })).toContain('noConditionsNeeded');
    expect(render(FormJoin, { joinType: 'semi' })).toContain('semiAntiConfigHint');
  });

  it('FormPivot', () => {
    const html = render(FormPivot, {
      on: [{ field: 'name', values: [] }],
      using: [{ function: 'count', expression: '*' }],
      groupBy: [],
    });
    expect(html).toContain('pivotMeasuresLabel');
    expect(html).toContain('pivotAddAxis');
  });
});
