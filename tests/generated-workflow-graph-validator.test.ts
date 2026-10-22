import { describe, expect, it } from 'vitest';
import type { DataWorkflowSaveInput } from '../src/renderer/types';
import { validateGeneratedExecutableWorkflow } from '../src/main/data/workflow/generated-workflow-graph-validator';
import { AI_GENERATED_WORKFLOW_NODE_TYPE_SET } from '../src/main/data/workflow/jflow-capability-profile';

function validWorkflow(): DataWorkflowSaveInput {
  return {
    nodes: [
      {
        id: 'input',
        type: 'input',
        label: '输入',
        x: 0,
        y: 0,
        config: { source: 'rawTable', rawTableId: 'table-1', alias: 'src' },
      },
      {
        id: 'derive',
        type: 'derive',
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
  it('limits AI-generated nodes to single-input jflow steps', () => {
    expect(AI_GENERATED_WORKFLOW_NODE_TYPE_SET.has('input')).toBe(true);
    expect(AI_GENERATED_WORKFLOW_NODE_TYPE_SET.has('derive')).toBe(true);
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
          nodeType: 'derive',
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
          nodeType: 'derive',
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
      // Only whitelisted functions belong to the runtime grammar.
      config: { condition: "date_sub([Order Date], 1) >= '2010-01-01'" },
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
