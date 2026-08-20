import { describe, expect, it } from 'vitest';
import type { DataWorkflowSaveInput } from '../src/renderer/types';
import { validateGeneratedExecutableWorkflow } from '../src/main/data/workflow/generated-workflow-graph-validator';
import {
  AI_GENERATED_WORKFLOW_NODE_TYPE_SET,
  AI_PREP_DSL_OPERATION_CAPABILITIES,
} from '../src/main/data/workflow/prep-dsl-capability-profile';

function validWorkflow(): DataWorkflowSaveInput {
  return {
    nodes: [
      {
        id: 'input',
        type: 'input_source',
        label: '输入',
        x: 0,
        y: 0,
        config: { source: 'dataset', datasetId: 'table-1', alias: 'src' },
      },
      {
        id: 'derive',
        type: 'calculate_field',
        label: '计算字段',
        x: 160,
        y: 0,
        config: { calculations: [{ field: 'Margin', expression: '[Profit] / [Sales]' }] },
      },
      {
        id: 'output',
        type: 'output',
        label: '输出',
        x: 320,
        y: 0,
        config: { table: 'result', mode: 'replace' },
      },
    ],
    edges: [
      { id: 'e1', sourceNodeId: 'input', targetNodeId: 'derive' },
      { id: 'e2', sourceNodeId: 'derive', targetNodeId: 'output' },
    ],
  };
}

describe('validateGeneratedExecutableWorkflow', () => {
  it('derives the generated-node allowlist from enabled operation recipes', () => {
    for (const capability of Object.values(AI_PREP_DSL_OPERATION_CAPABILITIES)) {
      expect(capability.emittedNodeTypes).toContain(capability.nodeType);
    }
    expect(AI_GENERATED_WORKFLOW_NODE_TYPE_SET).toEqual(
      new Set([
        'input_source',
        'output',
        ...Object.values(AI_PREP_DSL_OPERATION_CAPABILITIES).flatMap((capability) =>
          capability.aiEnabled ? capability.emittedNodeTypes : []
        ),
      ])
    );
    expect(AI_GENERATED_WORKFLOW_NODE_TYPE_SET.has('join')).toBe(false);
    expect(AI_GENERATED_WORKFLOW_NODE_TYPE_SET.has('set_op')).toBe(false);
  });

  it('accepts a bound executable graph', () => {
    expect(validateGeneratedExecutableWorkflow(validWorkflow())).toEqual([]);
  });

  it('rejects malformed node configs before SQL execution', () => {
    const workflow = validWorkflow();
    workflow.nodes[1] = {
      ...workflow.nodes[1],
      config: {
        calculations: [],
        generatedOrigin: {
          operationId: 'op_margin',
          operatorIndex: 0,
          operationType: 'derive',
          functionName: 'addProfitMargin',
          start: 42,
          end: 180,
          line: 3,
          column: 5,
        },
      },
    };

    expect(validateGeneratedExecutableWorkflow(workflow)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'NODE_CALCULATION_MISSING',
          severity: 'error',
          nodeId: 'derive',
          nodeType: 'calculate_field',
          operationId: 'op_margin',
          operatorIndex: 0,
          operationType: 'derive',
          functionName: 'addProfitMargin',
          start: 42,
          end: 180,
          line: 3,
          column: 5,
        }),
      ])
    );
  });

  it('rejects generated configuration keys that the platform schema would strip', () => {
    const workflow = validWorkflow();
    workflow.nodes[1] = {
      ...workflow.nodes[1],
      config: {
        calculations: [{ field: 'Margin', expression: '[Profit] / [Sales]' }],
        inventedRuntimeOption: true,
      },
    };

    expect(validateGeneratedExecutableWorkflow(workflow)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalidConfig',
          severity: 'error',
          nodeId: 'derive',
          nodeType: 'calculate_field',
          params: expect.objectContaining({ path: 'inventedRuntimeOption' }),
        }),
      ])
    );
  });

  it.each(['join', 'set_op'] as const)(
    'rejects platform-wide %s nodes that are not enabled for AI generation',
    (type) => {
      const workflow = validWorkflow();
      workflow.nodes[1] = { ...workflow.nodes[1], type, config: {} };

      expect(validateGeneratedExecutableWorkflow(workflow)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'NODE_TYPE_UNSUPPORTED',
            nodeId: 'derive',
            nodeType: type,
          }),
        ])
      );
    }
  );

  it('rejects filter syntax outside the platform runtime grammar', () => {
    const workflow = validWorkflow();
    workflow.nodes[1] = {
      ...workflow.nodes[1],
      type: 'filter',
      config: { condition: "CAST([Order Date] AS DATE) >= CAST('2010-01-01' AS DATE)" },
    };

    expect(validateGeneratedExecutableWorkflow(workflow)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'NODE_FILTER_CONDITION_INVALID', severity: 'error' }),
      ])
    );
  });

  it('rejects cycles, dangling edges and unreachable nodes', () => {
    const workflow = validWorkflow();
    workflow.nodes.push({
      id: 'orphan',
      type: 'sort',
      label: '排序',
      x: 0,
      y: 80,
      config: { keys: [{ field: 'Profit', direction: 'asc' }] },
    });
    workflow.edges.push({ id: 'cycle', sourceNodeId: 'derive', targetNodeId: 'derive' });
    workflow.edges.push({ id: 'dangling', sourceNodeId: 'missing', targetNodeId: 'output' });

    const codes = validateGeneratedExecutableWorkflow(workflow).map((item) => item.code);
    expect(codes).toContain('NODE_GRAPH_SELF_CYCLE');
    expect(codes).toContain('NODE_GRAPH_DANGLING_EDGE');
    expect(codes).toContain('NODE_GRAPH_UNREACHABLE');
  });
});
