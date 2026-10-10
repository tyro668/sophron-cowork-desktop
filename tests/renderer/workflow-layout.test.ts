import { describe, expect, it } from 'vitest';
import { layoutWorkflowNodes } from '../../src/renderer/components/data-view/data-pipelines/workflow/workflow-layout';
import type { DataPipeline, DataWorkflowEdge, DataWorkflowNode } from '../../src/shared/contracts';

const pipeline = { id: 'pipeline-1' } as DataPipeline;

function node(id: string, type: DataWorkflowNode['type'] = 'filter'): DataWorkflowNode {
  return {
    id,
    pipelineId: pipeline.id,
    type,
    label: id,
    x: 999,
    y: 999,
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
    id: `e_${sourceNodeId}_${targetNodeId}_${sourceHandle}`,
    pipelineId: pipeline.id,
    sourceNodeId,
    targetNodeId,
    sourceHandle,
    targetHandle,
    createdAt: 0,
  };
}

const byId = (nodes: DataWorkflowNode[]) => new Map(nodes.map((n) => [n.id, n]));

describe('layoutWorkflowNodes', () => {
  it('lays a linear chain out left to right on one row', () => {
    const nodes = layoutWorkflowNodes(
      [node('a', 'input_source'), node('b'), node('c'), node('out', 'output')],
      [edge('a', 'b'), edge('b', 'c'), edge('c', 'out')]
    );
    const map = byId(nodes);
    expect(map.get('a')!.x).toBeLessThan(map.get('b')!.x);
    expect(map.get('b')!.x).toBeLessThan(map.get('c')!.x);
    expect(map.get('c')!.x).toBeLessThan(map.get('out')!.x);
    // Single-member columns share the same y.
    expect(map.get('a')!.y).toBe(map.get('b')!.y);
    expect(map.get('b')!.y).toBe(map.get('c')!.y);
  });

  it('wraps wide chains into left-to-right rows so edges keep flowing forward', () => {
    // width 800 → 3 columns per row; a 6-node chain wraps after 3.
    const nodes = layoutWorkflowNodes(
      [
        node('a', 'input_source'),
        node('b'),
        node('c'),
        node('d'),
        node('e'),
        node('out', 'output'),
      ],
      [edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), edge('d', 'e'), edge('e', 'out')],
      800
    );
    const map = byId(nodes);
    // Row 1: a b c left-to-right.
    expect(map.get('a')!.x).toBeLessThan(map.get('c')!.x);
    expect(map.get('a')!.y).toBe(map.get('c')!.y);
    // Row 2 restarts at the left: d under a, e under b, out under c — every
    // intra-row edge stays forward; only the c→d wrap edge sweeps back.
    expect(map.get('d')!.x).toBe(map.get('a')!.x);
    expect(map.get('e')!.x).toBe(map.get('b')!.x);
    expect(map.get('out')!.x).toBe(map.get('c')!.x);
    expect(map.get('d')!.x).toBeLessThan(map.get('e')!.x);
    expect(map.get('e')!.x).toBeLessThan(map.get('out')!.x);
    expect(map.get('d')!.y).toBe(map.get('out')!.y);
    expect(map.get('d')!.y).toBeGreaterThan(map.get('c')!.y);
    // Everything fits within the 800px viewport at zoom 1.
    expect(Math.max(...nodes.map((n) => n.x + 116))).toBeLessThanOrEqual(800 - 48);
  });

  it('keeps a post-join tail chain forward-flowing on the wrapped row', () => {
    // in1 → filter → dedup → join → sql → out, plus in2 as the join's right
    // input: the tail chain lands on row 2 and must run left-to-right instead
    // of looping backward the way a fixed snake order would draw it.
    const nodes = layoutWorkflowNodes(
      [
        node('in1', 'input_source'),
        node('in2', 'input_source'),
        node('f'),
        node('dd', 'deduplicate'),
        node('j', 'join'),
        node('s', 'sql_query'),
        node('out', 'output'),
      ],
      [
        edge('in1', 'f'),
        edge('f', 'dd'),
        edge('dd', 'j', 'output', 'input'),
        edge('in2', 'j', 'output', 'right'),
        edge('j', 's'),
        edge('s', 'out'),
      ],
      800
    );
    const map = byId(nodes);
    // Row 2: join → sql → out all left-to-right (short forward edges).
    expect(map.get('j')!.y).toBeGreaterThan(map.get('dd')!.y);
    expect(map.get('j')!.x).toBeLessThan(map.get('s')!.x);
    expect(map.get('s')!.x).toBeLessThan(map.get('out')!.x);
    expect(map.get('j')!.y).toBe(map.get('out')!.y);
  });

  it('does not wrap when the chain fits the viewport', () => {
    const nodes = layoutWorkflowNodes(
      [node('a', 'input_source'), node('b'), node('out', 'output')],
      [edge('a', 'b'), edge('b', 'out')],
      1200
    );
    const map = byId(nodes);
    expect(map.get('a')!.y).toBe(map.get('b')!.y);
    expect(map.get('b')!.y).toBe(map.get('out')!.y);
  });

  it('puts branch siblings into the same column and the join downstream', () => {
    const nodes = layoutWorkflowNodes(
      [node('a', 'input_source'), node('b'), node('c'), node('j', 'join'), node('out', 'output')],
      [
        edge('a', 'b'),
        edge('a', 'c'),
        edge('b', 'j', 'output', 'input'),
        edge('c', 'j', 'output', 'right'),
        edge('j', 'out'),
      ]
    );
    const map = byId(nodes);
    expect(map.get('b')!.x).toBe(map.get('c')!.x);
    expect(map.get('b')!.x).toBeGreaterThan(map.get('a')!.x);
    expect(map.get('j')!.x).toBeGreaterThan(map.get('b')!.x);
    expect(map.get('out')!.x).toBeGreaterThan(map.get('j')!.x);
    // Siblings spread vertically and stay centered around the parent row.
    expect(map.get('b')!.y).not.toBe(map.get('c')!.y);
    const mid = (map.get('b')!.y + map.get('c')!.y) / 2;
    expect(mid).toBeCloseTo(map.get('a')!.y + 18 - 18, -1); // centered band
  });

  it('stacks disconnected components into separate bands without overlap', () => {
    const nodes = layoutWorkflowNodes(
      [node('a1', 'input_source'), node('a2'), node('b1', 'input_source'), node('b2')],
      [edge('a1', 'a2'), edge('b1', 'b2')]
    );
    const map = byId(nodes);
    const bandA = [map.get('a1')!.y, map.get('a2')!.y];
    const bandB = [map.get('b1')!.y, map.get('b2')!.y];
    expect(Math.min(...bandB)).toBeGreaterThan(Math.max(...bandA));
  });

  it('places isolated orphan nodes', () => {
    const nodes = layoutWorkflowNodes(
      [node('a', 'input_source'), node('b'), node('orphan')],
      [edge('a', 'b')]
    );
    const orphan = byId(nodes).get('orphan')!;
    expect(orphan.x).not.toBe(999);
    expect(orphan.y).toBeGreaterThan(byId(nodes).get('b')!.y);
  });

  it('survives cyclic graphs without hanging', () => {
    const nodes = layoutWorkflowNodes(
      [node('a'), node('b'), node('c')],
      [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')]
    );
    const xs = nodes.map((n) => n.x);
    expect(new Set(xs).size).toBeGreaterThanOrEqual(2);
    expect(nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
  });
});
