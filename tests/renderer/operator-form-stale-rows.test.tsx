// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { act, createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n-test';
import en from '../../src/shared/i18n/locales/en.json';
import FormAggregate from '../../src/renderer/components/workflow-forms/FormAggregate';
import FormPivot from '../../src/renderer/components/workflow-forms/FormPivot';
import FormFieldMapping from '../../src/renderer/components/workflow-forms/FormFieldMapping';
import FormCalculateField from '../../src/renderer/components/workflow-forms/FormCalculateField';
import FormJoin from '../../src/renderer/components/workflow-forms/FormJoin';
import type { OperatorFormProps } from '../../src/renderer/components/workflow-forms/types';
import type { DataWorkflowNode } from '../../src/renderer/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeNode(type: string, config: Record<string, unknown>): DataWorkflowNode {
  return {
    id: 'n1',
    pipelineId: 'p1',
    type,
    label: type,
    x: 0,
    y: 0,
    config,
    createdAt: 0,
    updatedAt: 0,
  } as DataWorkflowNode;
}

async function mount(
  Form: ComponentType<OperatorFormProps>,
  props: Partial<OperatorFormProps> & { node: DataWorkflowNode }
) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const updaters: Array<(n: DataWorkflowNode) => DataWorkflowNode> = [];
  await act(async () => {
    root.render(
      createElement(Form, {
        fieldCompletions: ['金额', '数量', '品类'],
        otherNodes: [],
        // Queue updates without re-rendering: simulates keystrokes arriving
        // before the parent has re-rendered with the previous edit.
        onNodeChange: (updater) => updaters.push(updater),
        ...props,
      })
    );
  });
  const cleanup = async () => {
    await act(async () => root.unmount());
    host.remove();
  };
  return { host, updaters, cleanup };
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function rowTextInputs(host: HTMLElement): HTMLInputElement[] {
  return [...host.querySelectorAll<HTMLInputElement>('input[type="text"]')];
}

const cases: Array<{
  name: string;
  Form: ComponentType<OperatorFormProps>;
  type: string;
  key: string;
  rows: Record<string, unknown>[];
}> = [
  {
    name: 'FormAggregate',
    Form: FormAggregate,
    type: 'aggregate',
    key: 'metrics',
    rows: [
      { id: 'm1', function: 'sum', field: '金额', alias: '' },
      { id: 'm2', function: 'sum', field: '数量', alias: '' },
    ],
  },
  {
    name: 'FormPivot',
    Form: FormPivot,
    type: 'pivot',
    key: 'using',
    rows: [
      { id: 'm1', function: 'sum', field: '金额', alias: '' },
      { id: 'm2', function: 'sum', field: '数量', alias: '' },
    ],
  },
  {
    name: 'FormFieldMapping',
    Form: FormFieldMapping,
    type: 'field_mapping',
    key: 'mappings',
    rows: [
      { id: 'f1', source: '金额', targetMode: 'rename', target: '' },
      { id: 'f2', source: '数量', targetMode: 'rename', target: '' },
    ],
  },
  {
    name: 'FormCalculateField',
    Form: FormCalculateField,
    type: 'calculate_field',
    key: 'calculations',
    rows: [
      { id: 'c1', field: '', expression: '1', action: 'add' },
      { id: 'c2', field: '', expression: '2', action: 'add' },
    ],
  },
];

describe('operator forms apply queued row edits against the latest config', () => {
  for (const c of cases) {
    it(`${c.name} keeps both edits when updates are queued before re-render`, async () => {
      const node = makeNode(c.type, { [c.key]: c.rows });
      const { host, updaters, cleanup } = await mount(c.Form, { node });
      const inputs = rowTextInputs(host).filter((i) => i.value === '');
      expect(inputs.length).toBeGreaterThanOrEqual(2);
      await act(async () => {
        typeInto(inputs[0], 'abc');
        typeInto(inputs[1], 'xyz');
      });
      const final = updaters.reduce((n, u) => u(n), node);
      const text = JSON.stringify(final.config[c.key]);
      expect(text).toContain('abc');
      expect(text).toContain('xyz');
      // Row ids are preserved so inputs don't remount (and lose focus).
      expect((final.config[c.key] as Array<{ id?: string }>).map((r) => r.id)).toEqual(
        c.rows.map((r) => r.id)
      );
      await cleanup();
    });
  }
});

describe('FormJoin reference names', () => {
  it('resolves saved conditions by input aliases, not node labels', async () => {
    const nodes = [
      makeNode('input_source', { alias: 'orders' }),
      makeNode('type_convert', {}),
      makeNode('input_source', { alias: 'products' }),
    ];
    nodes[0] = { ...nodes[0], id: 'orders', label: '输入' };
    nodes[1] = { ...nodes[1], id: 'convert', label: '已重命名的转换' };
    nodes[2] = { ...nodes[2], id: 'products', label: '输入' };
    const join = makeNode('join', {
      joinType: 'left',
      rightAlias: 'products',
      conditions: [{ left: '[orders].[商品ID]', operator: '=', right: '[products].[商品ID]' }],
      conflict: { strategy: 'suffix', leftSuffix: '_left', rightSuffix: '_right' },
    });
    const { host, cleanup } = await mount(FormJoin, {
      node: join,
      fieldCompletions: ['商品ID', '数量'],
      otherNodes: nodes,
      workflowEdges: [
        {
          id: 'e1',
          pipelineId: 'p1',
          sourceNodeId: 'orders',
          targetNodeId: 'convert',
          createdAt: 0,
        },
        {
          id: 'e2',
          pipelineId: 'p1',
          sourceNodeId: 'convert',
          targetNodeId: 'n1',
          targetHandle: 'left',
          createdAt: 0,
        },
        {
          id: 'e3',
          pipelineId: 'p1',
          sourceNodeId: 'products',
          targetNodeId: 'n1',
          targetHandle: 'right',
          createdAt: 0,
        },
      ] as OperatorFormProps['workflowEdges'],
      sourceNode: { id: 'convert', type: 'type_convert', config: {} },
      rightSourceNode: { id: 'products', type: 'input_source', config: { alias: 'products' } },
    });
    const notFound = (
      en as { data: { workflow: { formLabels: { fieldPicker: { fieldNotFound: string } } } } }
    ).data.workflow.formLabels.fieldPicker.fieldNotFound;
    const missing = [...host.querySelectorAll('[title]')].filter(
      (el) => el.getAttribute('title') === notFound
    );
    expect(missing).toHaveLength(0);
    // Friendly label: the field name is displayed for the saved reference.
    expect(host.textContent).toContain('商品ID');
    await cleanup();
  });
});
