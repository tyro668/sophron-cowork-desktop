import { describe, expect, it } from 'vitest';
import { removeWorkflowNode } from '../../src/renderer/components/data-view/data-pipelines/workflow/workflow-graph-operations';
import type {
  DataPipeline,
  DataPipelineWorkflow,
  DataWorkflowEdge,
  DataWorkflowNode,
} from '../../src/shared/contracts';

const pipeline = { id: 'pipeline-1' } as DataPipeline;

function node(id: string, type: DataWorkflowNode['type'] = 'filter'): DataWorkflowNode {
  return {
    id,
    pipelineId: pipeline.id,
    type,
    label: id,
    x: 0,
    y: 0,
    config: {},
    createdAt: 0,
    updatedAt: 0,
  };
}

function edge(
  sourceNodeId: string,
  targetNodeId: string,
  sourceHandle: string | null = 'output',
  targetHandle: string | null = 'input'
): DataWorkflowEdge {
  return {
    id: `edge_${sourceNodeId}_${targetNodeId}_${sourceHandle}_${targetHandle}`,
    pipelineId: pipeline.id,
    sourceNodeId,
    targetNodeId,
    sourceHandle,
    targetHandle,
    createdAt: 0,
  };
}

function workflow(nodes: DataWorkflowNode[], edges: DataWorkflowEdge[]): DataPipelineWorkflow {
  return { pipeline, nodes, edges };
}

function edgeExists(wf: DataPipelineWorkflow, source: string, target: string): boolean {
  return wf.edges.some((e) => e.sourceNodeId === source && e.targetNodeId === target);
}

describe('removeWorkflowNode', () => {
  it('reconnects the predecessor to the successor (A→B→C becomes A→C)', () => {
    const wf = workflow(
      [node('src', 'input'), node('a'), node('b'), node('out', 'output')],
      [edge('src', 'a'), edge('a', 'b'), edge('b', 'out')]
    );
    const next = removeWorkflowNode(wf, 'b');
    expect(next.nodes.map((n) => n.id)).toEqual(['src', 'a', 'out']);
    expect(edgeExists(next, 'a', 'out')).toBe(true);
    expect(edgeExists(next, 'a', 'b')).toBe(false);
    expect(edgeExists(next, 'b', 'out')).toBe(false);
  });

  it('does not fabricate edges for head or tail deletions', () => {
    const wf = workflow(
      [node('src', 'input'), node('a'), node('out', 'output')],
      [edge('src', 'a'), edge('a', 'out')]
    );
    const headRemoved = removeWorkflowNode(wf, 'src');
    expect(headRemoved.edges).toHaveLength(1);
    expect(edgeExists(headRemoved, 'a', 'out')).toBe(true);
    const tailRemoved = removeWorkflowNode(wf, 'out');
    expect(tailRemoved.edges).toHaveLength(1);
    expect(edgeExists(tailRemoved, 'src', 'a')).toBe(true);
  });

  it('supports chained multi-delete (X→A→B→C deleting A and B yields X→C)', () => {
    const wf = workflow(
      [node('x', 'input'), node('a'), node('b'), node('c'), node('out', 'output')],
      [edge('x', 'a'), edge('a', 'b'), edge('b', 'c'), edge('c', 'out')]
    );
    const next = removeWorkflowNode(removeWorkflowNode(wf, 'a'), 'b');
    expect(edgeExists(next, 'x', 'c')).toBe(true);
    expect(edgeExists(next, 'c', 'out')).toBe(true);
  });

  it('does not bypass reject-stream edges or right-side inputs', () => {
    const wf = workflow(
      [
        node('src', 'input'),
        node('expect_1', 'expect'),
        node('reject_sink'),
        node('out', 'output'),
      ],
      [
        edge('src', 'expect_1'),
        edge('expect_1', 'reject_sink', 'reject', 'input'),
        edge('expect_1', 'out'),
      ]
    );
    const next = removeWorkflowNode(wf, 'expect_1');
    // Reject stream is not rewired into the main path.
    expect(edgeExists(next, 'src', 'reject_sink')).toBe(false);
    expect(edgeExists(next, 'src', 'out')).toBe(true);
  });

  it('preserves handles when bypassing into a join right input', () => {
    const wf = workflow(
      [node('l', 'input'), node('b'), node('j', 'join'), node('out', 'output')],
      [edge('l', 'b'), edge('b', 'j', 'output', 'right'), edge('j', 'out')]
    );
    const next = removeWorkflowNode(wf, 'b');
    const bypass = next.edges.find((e) => e.sourceNodeId === 'l' && e.targetNodeId === 'j');
    expect(bypass?.targetHandle).toBe('right');
  });

  it('avoids duplicate edges when bypassing', () => {
    const wf = workflow(
      [node('a'), node('b'), node('c'), node('out', 'output')],
      [edge('a', 'b'), edge('b', 'c'), edge('a', 'c', 'output', 'input'), edge('c', 'out')]
    );
    const next = removeWorkflowNode(wf, 'b');
    expect(next.edges.filter((e) => e.sourceNodeId === 'a' && e.targetNodeId === 'c')).toHaveLength(
      1
    );
  });
});
