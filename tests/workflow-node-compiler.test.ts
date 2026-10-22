import { afterEach, describe, expect, it, vi } from 'vitest';
import { lowerGeneratedWorkflowIrSemantics } from '../src/main/data/workflow/workflow-ir-lowerer';
import { compileLoweredWorkflowToPlatformNodes } from '../src/main/data/workflow/workflow-node-compiler';
import type { WorkflowIr } from '../src/main/data/workflow/workflow-model';
import { validateOperatorConfig } from '../src/shared/operator-schemas';
import * as PrepDsl from '../src/shared/prep-dsl';

const COLUMNS = [
  { name: 'Product Name', type: 'text' },
  { name: 'Sales', type: 'decimal' },
  { name: 'Profit', type: 'decimal' },
  { name: 'Row ID', type: 'integer' },
];

function expectEveryNodeConfigToMatchPlatformSchema(
  nodes: ReturnType<typeof compileLoweredWorkflowToPlatformNodes>['nodes']
): void {
  for (const node of nodes) {
    expect(
      validateOperatorConfig(node.type, node.config ?? {}),
      `node ${node.id} (${node.type}) must satisfy its platform operator schema`
    ).toEqual([]);
  }
}

function compileWorkflowIrToPlatformNodes(input: {
  ir: WorkflowIr;
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
  bindings: Parameters<typeof compileLoweredWorkflowToPlatformNodes>[0]['bindings'];
}) {
  const semantics = lowerGeneratedWorkflowIrSemantics(input);
  return compileLoweredWorkflowToPlatformNodes({ semantics, bindings: input.bindings });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('workflow node compiler', () => {
  it('compiles representative IR directly into native nodes, edges, and configs', () => {
    const parseDsl = vi.spyOn(PrepDsl, 'parsePrepDsl').mockImplementation(() => {
      throw new Error('The native node compiler must not invoke the Prep DSL parser');
    });
    const ir: WorkflowIr = {
      irVersion: '1.0',
      kind: 'workflow',
      sourceLanguage: 'javascript',
      inputSeen: true,
      outputSeen: true,
      outputOperationId: 'op_limit',
      operations: [
        {
          operationId: 'op_select',
          inputOperationId: 'input',
          type: 'select',
          columns: ['Product Name', 'Sales', 'Profit'],
        },
        {
          operationId: 'op_sort',
          inputOperationId: 'op_select',
          type: 'sort',
          column: { kind: 'column', name: 'Sales' },
          direction: 'desc',
        },
        {
          operationId: 'op_limit',
          inputOperationId: 'op_sort',
          type: 'limit',
          config: {
            mode: 'limit',
            limit: 25,
            unit: 'rows',
            offset: 0,
            orderBy: [],
          },
        },
      ],
      provenance: [],
    };

    const plan = compileWorkflowIrToPlatformNodes({
      ir,
      requirement: '仅保留产品、销售额和利润，按销售额降序取前 25 行。',
      columns: COLUMNS,
      bindings: {
        rawTableId: 'rawTable-sales-id',
        inputAlias: 'sales',
        rawTableName: 'Sales Preview',
        resultTableName: 'Processed Sales',
        resultTableId: 'result-table-id',
        outputPhysicalTableName: 'data_output_abc123',
        outputMode: 'replace',
      },
    });

    expect(parseDsl).not.toHaveBeenCalled();
    expect(plan.nodes.map(({ id, type }) => ({ id, type }))).toEqual([
      { id: 'source_sales', type: 'input_source' },
      { id: 'field_select_1', type: 'field_select' },
      { id: 'sort_2', type: 'sort' },
      { id: 'limit_3', type: 'limit' },
      { id: 'output_result', type: 'output' },
    ]);
    expect(plan.nodes.map((node) => node.label)).toEqual([
      '输入',
      '字段选择',
      '排序',
      '限制行数',
      '输出',
    ]);
    expect(plan.edges).toEqual([
      {
        id: 'edge_source_sales_field_select_1',
        sourceNodeId: 'source_sales',
        targetNodeId: 'field_select_1',
        sourceHandle: 'output',
        targetHandle: 'input',
      },
      {
        id: 'edge_field_select_1_sort_2',
        sourceNodeId: 'field_select_1',
        targetNodeId: 'sort_2',
        sourceHandle: 'output',
        targetHandle: 'input',
      },
      {
        id: 'edge_sort_2_limit_3',
        sourceNodeId: 'sort_2',
        targetNodeId: 'limit_3',
        sourceHandle: 'output',
        targetHandle: 'input',
      },
      {
        id: 'edge_limit_3_output_result',
        sourceNodeId: 'limit_3',
        targetNodeId: 'output_result',
        sourceHandle: 'output',
        targetHandle: 'input',
      },
    ]);
    expect(plan.nodes[0].config).toEqual({
      source: 'rawTable',
      rawTableId: 'rawTable-sales-id',
      rawTableName: 'Sales Preview',
      alias: 'sales',
    });
    expect(plan.nodes[1].config).toMatchObject({
      selection: 'include',
      fields: ['Product Name', 'Sales', 'Profit'],
    });
    expect(plan.nodes[2].config).toMatchObject({
      orderBy: [{ field: 'Sales', direction: 'desc' }],
    });
    expect(plan.nodes[3].config).toMatchObject({
      sampling: 'fixed',
      limit: 25,
      unit: 'rows',
    });
    for (const node of plan.nodes) {
      expect(node.config).not.toHaveProperty('dsl');
    }
    expect(plan.nodes[4].config).toEqual({
      destination: 'duckdb_table',
      table: 'data_output_abc123',
      mode: 'replace',
      outputStrategy: 'existing',
      outputResultTableId: 'result-table-id',
      resultTableId: 'result-table-id',
      resultTableName: 'Processed Sales',
    });
    expectEveryNodeConfigToMatchPlatformSchema(plan.nodes);
  });

  it('expands one IR operation into a multi-node recipe and preserves source origins', () => {
    const ir: WorkflowIr = {
      irVersion: '1.0',
      kind: 'workflow',
      sourceLanguage: 'javascript',
      inputSeen: true,
      outputSeen: true,
      outputOperationId: 'op_filter_chairs',
      operations: [
        {
          operationId: 'op_filter_chairs',
          inputOperationId: 'input',
          type: 'filter',
          condition: {
            kind: 'binary',
            op: 'contains',
            left: { kind: 'column', name: 'Product Name' },
            right: { kind: 'literal', value: 'Chair' },
          },
        },
      ],
      provenance: [
        {
          operationId: 'op_filter_chairs',
          language: 'javascript',
          source: {
            functionName: 'keepChairProducts',
            start: 42,
            end: 180,
            line: 3,
            column: 3,
          },
        },
      ],
    };

    const plan = compileWorkflowIrToPlatformNodes({
      ir,
      requirement: '只保留产品名称包含 Chair 的记录。',
      columns: COLUMNS,
      bindings: {
        rawTableId: 'rawTable-sales-id',
        resultTableName: 'Chair Products',
        outputPhysicalTableName: 'data_output_chairs',
      },
    });

    const operationNodes = plan.nodes.slice(1, -1);
    expect(ir.operations).toHaveLength(1);
    expect(operationNodes.map(({ id, type }) => ({ id, type }))).toEqual([
      { id: 'calculate_field_1', type: 'calculate_field' },
      { id: 'filter_2', type: 'filter' },
      { id: 'field_select_3', type: 'field_select' },
    ]);
    expect(plan.operationNodeOrigins).toHaveLength(3);
    expect(plan.operationNodeOrigins.map((origin) => origin.nodeId)).toEqual(
      operationNodes.map((node) => node.id)
    );
    for (const [index, node] of operationNodes.entries()) {
      expect(node.config?.generatedOrigin).toEqual({
        operationId: index === 0 ? 'op_filter_chairs' : `op_filter_chairs:${index}`,
        operatorIndex: index,
        operationType: 'filter',
        nodeId: node.id,
        nodeType: node.type,
        functionName: 'keepChairProducts',
        start: 42,
        end: 180,
        line: 3,
        column: 3,
      });
    }
    expect(operationNodes.map((node) => node.label)).toEqual(['计算字段', '筛选', '字段选择']);
    expect(plan.operationNodeOrigins).toEqual(
      operationNodes.map((node, index) => ({
        operationId: index === 0 ? 'op_filter_chairs' : `op_filter_chairs:${index}`,
        operatorIndex: index,
        operationType: 'filter',
        nodeId: node.id,
        nodeType: node.type,
        functionName: 'keepChairProducts',
        start: 42,
        end: 180,
        line: 3,
        column: 3,
      }))
    );
    expect(plan.nodes.at(-1)?.config).toMatchObject({
      destination: 'duckdb_table',
      table: 'data_output_chairs',
    });
    expectEveryNodeConfigToMatchPlatformSchema(plan.nodes);
  });
});
