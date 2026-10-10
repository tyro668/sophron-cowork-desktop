import React from 'react';
import { useTranslation } from 'react-i18next';
import ReactDOM from 'react-dom/client';
import { ReactFlow, ReactFlowProvider, Background } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import i18n from './i18n/config';
import './styles/globals.css';

import type { DataWorkflowNode } from './types';
import type { OperatorFormProps } from './components/workflow-forms';
import FormSort from './components/workflow-forms/FormSort';
import FormTypeConvert from './components/workflow-forms/FormTypeConvert';
import FormFieldMapping from './components/workflow-forms/FormFieldMapping';
import FormCalculateField from './components/workflow-forms/FormCalculateField';
import FormLimit from './components/workflow-forms/FormLimit';
import FormSetOp from './components/workflow-forms/FormSetOp';
import FormUnnest from './components/workflow-forms/FormUnnest';
import FormUnpivot from './components/workflow-forms/FormUnpivot';
import FormMissingValue from './components/workflow-forms/FormMissingValue';
import FormAggregate from './components/workflow-forms/FormAggregate';
import FormJoin from './components/workflow-forms/FormJoin';
import FormPivot from './components/workflow-forms/FormPivot';
import {
  WorkflowEdge,
  WorkflowOperatorNode,
} from './components/data-view/data-pipelines/workflow/WorkflowUi';
import type { WorkflowFlowNode } from './components/data-view/data-pipelines/workflow/workflow-model';

const COLUMNS = [
  'id',
  'amount',
  'price',
  'qty',
  'name',
  'region',
  'created_at',
  'active',
  'items',
  'meta',
];
const RIGHT_COLUMNS = ['order_id', 'customer', 'refund_amount', 'refund_at'];

const COLUMN_TYPES = [
  { name: 'id', type: 'integer' },
  { name: 'amount', type: 'decimal' },
  { name: 'price', type: 'decimal' },
  { name: 'qty', type: 'integer' },
  { name: 'name', type: 'text' },
  { name: 'region', type: 'text' },
  { name: 'created_at', type: 'datetime' },
  { name: 'active', type: 'boolean' },
  { name: 'items', type: 'list' },
  { name: 'meta', type: 'json' },
];

(window as unknown as Record<string, unknown>).electronAPI = {
  data: {
    getWorkflowNodeColumns: () => Promise.resolve(RIGHT_COLUMNS),
    getWorkflowNodeColumnTypes: () => Promise.resolve(COLUMN_TYPES),
    getWorkflowNodeColumnValues: () => Promise.resolve(['华东', '华北', '华南', '华西', '境外']),
  },
};

function makeNode(type: string, config: Record<string, unknown>): DataWorkflowNode {
  return {
    id: `${type}-node`,
    pipelineId: 'preview-task',
    type: type as DataWorkflowNode['type'],
    label: type,
    x: 0,
    y: 0,
    config,
    createdAt: 0,
    updatedAt: 0,
  };
}

const sourceNode = makeNode('input_source', { tableName: 'orders' });
const rightSourceNode = makeNode('input_source', { tableName: 'refunds' });
const otherNodes = [sourceNode, rightSourceNode];

function Panel({
  title,
  children,
  tall,
}: {
  title: string;
  children: React.ReactNode;
  tall?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border-muted bg-surface">
      <header className="border-b border-border-muted bg-surface-active px-3 py-1.5 text-[13px] font-medium text-text-primary">
        {title}
      </header>
      <div className={`operator-ui ${tall ? 'h-[420px]' : 'h-[320px]'} min-h-0`}>{children}</div>
    </section>
  );
}

function PreviewApp() {
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  const nodesRef = React.useRef(new Map<string, DataWorkflowNode>());

  const nodeFor = (type: string, config: Record<string, unknown>) => {
    if (!nodesRef.current.has(type)) nodesRef.current.set(type, makeNode(type, config));
    return nodesRef.current.get(type)!;
  };

  const onNodeChange =
    (type: string) => (updater: (node: DataWorkflowNode) => DataWorkflowNode) => {
      const current = nodesRef.current.get(type);
      if (current) nodesRef.current.set(type, updater(current));
      force();
    };

  const base = {
    pipelineId: 'preview-task',
    fieldCompletions: COLUMNS,
    otherNodes,
    sourceNode,
    rightSourceNode,
    upstreamRowCount: 12345,
  };

  const { t } = useTranslation();
  const cases: Array<{
    op: string;
    variant?: string;
    node: DataWorkflowNode;
    tall?: boolean;
    C: React.ComponentType<OperatorFormProps>;
  }> = [
    {
      op: 'sort',
      node: nodeFor('sort', {
        keys: [
          { field: 'created_at', direction: 'desc', nulls: 'last' },
          { field: 'id', direction: 'asc' },
        ],
      }),
      C: FormSort,
    },
    {
      op: 'type_convert',
      node: nodeFor('type_convert', {
        conversions: [
          { column: 'amount', type: 'integer' },
          { column: 'created_at', type: 'date' },
        ],
      }),
      C: FormTypeConvert,
    },
    {
      op: 'field_mapping',
      node: nodeFor('field_mapping', {
        mappings: [
          { source: 'amount', targetMode: 'rename', targetValue: 'amt' },
          { source: 'name', targetMode: 'keep' },
        ],
      }),
      C: FormFieldMapping,
    },
    {
      op: 'calculate_field',
      node: nodeFor('calculate_field', {
        calculations: [{ field: 'total', expression: '[amount] * [qty]', action: 'add' }],
      }),
      C: FormCalculateField,
    },
    {
      op: 'limit',
      variant: 'fixed',
      node: nodeFor('limit-fixed', {
        mode: 'fixed',
        limit: 100,
        unit: 'rows',
        offset: 5,
        orderBy: [{ field: 'id', direction: 'asc' }],
        ties: true,
      }),
      C: FormLimit,
    },
    {
      op: 'limit',
      variant: 'random',
      node: nodeFor('limit-random', {
        mode: 'random',
        limit: 10,
        unit: 'percent',
        method: 'system',
        seed: 42,
      }),
      C: FormLimit,
    },
    {
      op: 'set_op',
      node: nodeFor('set_op', { operation: 'union', mode: 'all', match: 'by_name' }),
      C: FormSetOp,
    },
    {
      op: 'unnest',
      variant: 'list',
      node: nodeFor('unnest-list', {
        sourceKind: 'list',
        column: 'items',
        alias: 'item',
        withIndex: 'idx',
        keepParentNames: true,
        preserveOrder: true,
      }),
      C: FormUnnest,
    },
    {
      op: 'unnest',
      variant: 'json',
      node: nodeFor('unnest-json', { sourceKind: 'json', column: 'meta', path: '$.items[*]' }),
      C: FormUnnest,
    },
    {
      op: 'unpivot',
      node: nodeFor('unpivot', {
        columns: ['amount', 'price'],
        mode: 'include',
        nameColumn: '指标',
        valueColumn: '值',
        includeNulls: false,
      }),
      C: FormUnpivot,
    },
    {
      op: 'missing_value',
      variant: 'by_column',
      node: nodeFor('missing-col', {
        strategy: 'by_column',
        rules: [
          { column: 'amount', method: 'literal_fill', value: '0' },
          { column: 'name', method: 'forward_fill' },
        ],
      }),
      C: FormMissingValue,
    },
    {
      op: 'missing_value',
      variant: 'by_row',
      node: nodeFor('missing-row', {
        strategy: 'drop_rows_by_nulls',
        condition: 'any_null',
        columns: ['amount', 'name'],
      }),
      C: FormMissingValue,
    },
    {
      op: 'aggregate',
      node: nodeFor('aggregate', {
        groupBy: ['region', 'created_at'],
        metrics: [
          { function: 'sum', expression: '[amount]', alias: 'total_amount' },
          { function: 'count', expression: '*', alias: 'rows' },
        ],
      }),
      C: FormAggregate,
      tall: true,
    },
    {
      op: 'join',
      variant: 'inner',
      node: nodeFor('join-inner', {
        joinType: 'inner',
        conditions: [{ left: '[orders].[id]', operator: '=', right: '[refunds].[order_id]' }],
      }),
      C: FormJoin,
      tall: true,
    },
    {
      op: 'join',
      variant: 'asof',
      node: nodeFor('join-asof', {
        joinType: 'asof',
        asof: {
          leftTime: '[orders].[created_at]',
          operator: '>=',
          rightTime: '[refunds].[refund_at]',
          tolerance: '1h',
        },
      }),
      C: FormJoin,
      tall: true,
    },
    {
      op: 'pivot',
      node: nodeFor('pivot', {
        on: [{ field: 'region', values: [] }],
        using: [{ function: 'sum', expression: '[amount]', alias: '' }],
        groupBy: ['name'],
      }),
      C: FormPivot,
      tall: true,
    },
  ];

  const flowNodes: WorkflowFlowNode[] = [
    {
      id: 'n-in',
      type: 'operator',
      position: { x: 40, y: 60 },
      data: { workflowNode: makeNode('input_source', { tableName: 'orders' }) },
    },
    {
      id: 'n-in2',
      type: 'operator',
      position: { x: 40, y: 140 },
      data: { workflowNode: makeNode('input_source', { tableName: 'refunds' }) },
    },
    {
      id: 'n-join',
      type: 'operator',
      position: { x: 260, y: 85 },
      data: { workflowNode: makeNode('join', { joinType: 'inner' }) },
    },
    {
      id: 'n-agg',
      type: 'operator',
      position: { x: 480, y: 85 },
      data: { workflowNode: makeNode('aggregate', {}), invalid: true },
    },
    {
      id: 'n-out',
      type: 'operator',
      position: { x: 700, y: 85 },
      data: { workflowNode: makeNode('output', {}) },
    },
  ];
  const flowEdges = [
    {
      id: 'e1',
      source: 'n-in',
      target: 'n-join',
      sourceHandle: 'output',
      targetHandle: 'left',
      type: 'workflow',
      reconnectable: true,
      interactionWidth: 18,
    },
    {
      id: 'e2',
      source: 'n-in2',
      target: 'n-join',
      sourceHandle: 'output',
      targetHandle: 'right',
      type: 'workflow',
      reconnectable: true,
      interactionWidth: 18,
    },
    {
      id: 'e3',
      source: 'n-join',
      target: 'n-agg',
      sourceHandle: 'output',
      targetHandle: 'input',
      type: 'workflow',
      reconnectable: true,
      interactionWidth: 18,
    },
    {
      id: 'e4',
      source: 'n-agg',
      target: 'n-out',
      sourceHandle: 'output',
      targetHandle: 'input',
      type: 'workflow',
      reconnectable: true,
      interactionWidth: 18,
    },
  ];

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="mx-auto grid max-w-[900px] gap-4">
        <Panel title={t('data.workflow.operators.output') + ' — canvas'}>
          <ReactFlowProvider>
            <div className="workflow-react-flow h-full w-full">
              <ReactFlow
                nodes={flowNodes}
                edges={flowEdges}
                nodeTypes={{ operator: WorkflowOperatorNode }}
                edgeTypes={{ workflow: WorkflowEdge }}
                fitView
                proOptions={{ hideAttribution: true }}
              >
                <Background color="var(--workflow-canvas-dot)" gap={18} size={1.3} />
              </ReactFlow>
            </div>
          </ReactFlowProvider>
        </Panel>
        {cases.map(({ op, variant, node, tall, C }) => (
          <Panel
            key={op + (variant ?? '')}
            title={t(`data.workflow.operators.${op}`) + (variant ? ` — ${variant}` : '')}
            tall={tall}
          >
            <C
              node={node}
              pipelineId={base.pipelineId}
              fieldCompletions={base.fieldCompletions}
              otherNodes={base.otherNodes}
              sourceNode={base.sourceNode}
              rightSourceNode={base.rightSourceNode}
              upstreamRowCount={base.upstreamRowCount}
              onNodeChange={onNodeChange(node.type)}
            />
          </Panel>
        ))}
      </div>
    </div>
  );
}

void i18n.changeLanguage('zh').then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <PreviewApp />
    </React.StrictMode>
  );
});
