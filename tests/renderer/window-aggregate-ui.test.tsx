// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n-test';
import FormAggregate from '../../src/renderer/components/workflow-forms/FormAggregate';
import FormCalculateField from '../../src/renderer/components/workflow-forms/FormCalculateField';
import { CalculationFunctionWizard } from '../../src/renderer/components/workflow-forms/calculate-field/CalculationFunctionWizard';
import { WorkflowDataContext } from '../../src/renderer/hooks/workflow-data-context';
import type { DataWorkflowNode } from '../../src/renderer/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const node = (type: string, config: Record<string, unknown>) =>
  ({
    id: 'n1',
    pipelineId: 'p1',
    type,
    label: type,
    x: 0,
    y: 0,
    config,
    createdAt: 0,
    updatedAt: 0,
  }) as DataWorkflowNode;

async function mount(element: ReturnType<typeof createElement>) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(element));
  return {
    host,
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

const formProps = {
  fieldCompletions: ['门店', '区域', '销售额'],
  otherNodes: [],
  onNodeChange: () => undefined,
};

describe('window aggregate UI', () => {
  it('FormAggregate flags a nested aggregate metric with a split action', async () => {
    const split: string[] = [];
    const { host, cleanup } = await mount(
      createElement(
        WorkflowDataContext.Provider,
        {
          value: {
            version: 0,
            workflow: null,
            splitNestedAggregate: (id: string) => split.push(id),
          },
        },
        createElement(FormAggregate, {
          ...formProps,
          node: node('aggregate', {
            groupBy: ['门店'],
            metrics: [{ function: 'avg', expression: 'sum([销售额])', alias: '均' }],
          }),
        })
      )
    );
    expect(host.querySelector('[data-testid="aggregate-nested-0"]')).not.toBeNull();
    const button = host.querySelector<HTMLElement>('[data-testid="aggregate-split-0"]');
    await act(async () => button!.click());
    expect(split).toEqual(['n1']);
    await cleanup();
  });

  it('FormCalculateField labels window-value rows with their partition', async () => {
    const { host, cleanup } = await mount(
      createElement(FormCalculateField, {
        ...formProps,
        node: node('derive', {
          calculations: [
            {
              field: '区域均值',
              action: 'add',
              expression: 'avg([销售额]) over(partition by [区域])',
            },
            { field: '双倍', action: 'add', expression: '[销售额] * 2' },
          ],
        }),
      })
    );
    expect(host.querySelector('[data-testid="calc-window-label-0"]')?.textContent).toContain(
      'avg · 按 区域'
    );
    expect(host.querySelector('[data-testid="calc-window-label-1"]')).toBeNull();
    await cleanup();
  });

  it('wizard scenario: aggregate + scope (全部行), sort collapsed', async () => {
    const replaced: string[] = [];
    const { host, cleanup } = await mount(
      createElement(CalculationFunctionWizard, {
        fieldCompletions: ['区域', '销售额'],
        columnTypes: { 区域: 'text', 销售额: 'decimal' },
        currentExpression: '',
        onInsertAtCursor: () => undefined,
        onReplace: (e: string) => replaced.push(e),
        tr: (key: string) => key,
      })
    );
    const button = host.querySelector<HTMLElement>('[data-testid="calc-scenario-window-compare"]');
    expect(button).not.toBeNull();
    await act(async () => button!.click());
    const text = host.textContent ?? '';
    expect(text).toContain('calcFieldWindowScopeAll');
    expect(text).toContain('calcFieldWindowSortToggle');
    expect(text).not.toContain('calcFieldSortField');
    await cleanup();
  });
});
