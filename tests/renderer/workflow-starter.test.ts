// @vitest-environment happy-dom
/**
 * Starter-graph builder + explain ordering: the empty-canvas template must
 * produce a wired input → sql → output draft that binds the pipeline's input
 * table when present.
 */
import { describe, expect, it } from 'vitest';
import './i18n-test';
import { buildWorkflowStarterGraph } from '../../src/renderer/components/data-view/data-pipelines/workflow/workflow-starter';
import { orderWorkflowNodes } from '../../src/renderer/components/data-view/data-pipelines/workflow/WorkflowExplainDialog';
import type { DataWorkflowEdge, DataWorkflowNode } from '../../src/renderer/types';

const LABELS = { input_source: 'Input', sql_query: 'SQL', output: 'Output' };

function makeNode(id: string, type = 'filter'): DataWorkflowNode {
  return {
    id,
    pipelineId: 'pipeline',
    type: type as DataWorkflowNode['type'],
    label: id,
    x: 0,
    y: 0,
    config: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeEdge(sourceNodeId: string, targetNodeId: string): DataWorkflowEdge {
  return {
    id: `${sourceNodeId}->${targetNodeId}`,
    pipelineId: 'pipeline',
    sourceNodeId,
    targetNodeId,
    sourceHandle: 'output',
    targetHandle: 'input',
    createdAt: 1,
  };
}

describe('buildWorkflowStarterGraph', () => {
  it('builds an input → sql → output chain with wired edges', () => {
    const graph = buildWorkflowStarterGraph({
      pipelineId: 'task_1',
      sourceRawTableId: null,
      resultTableName: 'my pipeline output',
      labels: LABELS,
    });

    expect(graph.nodes.map((node) => node.type)).toEqual(['input_source', 'sql_query', 'output']);
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges[0].sourceNodeId).toBe(graph.nodes[0].id);
    expect(graph.edges[0].targetNodeId).toBe(graph.nodes[1].id);
    expect(graph.edges[1].sourceNodeId).toBe(graph.nodes[1].id);
    expect(graph.edges[1].targetNodeId).toBe(graph.nodes[2].id);
    // Unbound pipeline: the input node stays in a pick-a-table draft state.
    expect(graph.nodes[0].config.rawTableId).toBeUndefined();
    expect(graph.nodes[1].config.sql).toContain('FROM input');
    expect(graph.nodes[2].config.outputStrategy).toBe('auto');
    expect(graph.nodes[2].config.resultTableName).toBe('my pipeline output');
  });

  it('binds the input node to the pipeline source rawTable', () => {
    const graph = buildWorkflowStarterGraph({
      pipelineId: 'task_2',
      sourceRawTableId: 'ds_orders',
      sourceName: 'Orders',
      resultTableName: 'out',
      labels: LABELS,
    });

    expect(graph.nodes[0].config).toMatchObject({
      source: 'rawTable',
      rawTableId: 'ds_orders',
      rawTableName: 'Orders',
      alias: 'source',
    });
  });
});

describe('orderWorkflowNodes', () => {
  it('orders source → transform → sink along edges', () => {
    const nodes = [makeNode('c'), makeNode('a'), makeNode('b')];
    const edges = [makeEdge('a', 'b'), makeEdge('b', 'c')];
    expect(orderWorkflowNodes(nodes, edges).map((node) => node.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps disconnected nodes at the end', () => {
    const nodes = [makeNode('lonely'), makeNode('a'), makeNode('b')];
    const edges = [makeEdge('a', 'b')];
    expect(orderWorkflowNodes(nodes, edges).map((node) => node.id)).toEqual(['a', 'b', 'lonely']);
  });
});
