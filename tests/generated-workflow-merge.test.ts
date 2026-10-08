import { describe, expect, it } from 'vitest';
import { mergeGeneratedChainAfterAnchor } from '../src/main/data/workflow/generated-workflow-merge';
import type { DataWorkflowEdgeInput, DataWorkflowNodeInput } from '../src/shared/contracts';

function node(
  id: string,
  type: DataWorkflowNodeInput['type'],
  x = 0,
  y = 0
): DataWorkflowNodeInput {
  return { id, type, label: id, x, y, config: {} };
}

function edge(
  sourceNodeId: string,
  targetNodeId: string,
  sourceHandle: string | null = 'output',
  targetHandle: string | null = 'input'
): DataWorkflowEdgeInput {
  return {
    id: `edge_${sourceNodeId}_${targetNodeId}`,
    sourceNodeId,
    targetNodeId,
    sourceHandle,
    targetHandle,
  };
}

function generatedChain(opIds: string[] = ['filter_1']) {
  const nodes = [
    node('source_src', 'input_source'),
    ...opIds.map((id) => node(id, 'filter', 0, 0)),
    node('output_result', 'output'),
  ];
  const edges = nodes.slice(1).map((target, index) => edge(nodes[index].id, target.id));
  return { nodes, edges };
}

function edgeExists(
  edges: DataWorkflowEdgeInput[],
  sourceNodeId: string,
  targetNodeId: string
): boolean {
  return edges.some((e) => e.sourceNodeId === sourceNodeId && e.targetNodeId === targetNodeId);
}

describe('mergeGeneratedChainAfterAnchor', () => {
  it('inserts the generated chain between the anchor and its successors', () => {
    const base = {
      nodes: [
        node('source_1', 'input_source', 0, 0),
        node('filter_1', 'filter', 300, 0),
        node('out_1', 'output', 600, 0),
      ],
      edges: [edge('source_1', 'filter_1'), edge('filter_1', 'out_1')],
    };
    const merged = mergeGeneratedChainAfterAnchor(
      base,
      'filter_1',
      generatedChain(['aggregate_1', 'filter_2'])
    );

    // Generated input/output boundary nodes are dropped; the operators splice in.
    expect(merged.nodes.map((n) => n.id).sort()).toEqual(
      ['source_1', 'filter_1', 'out_1', 'aggregate_1', 'filter_2'].sort()
    );
    expect(edgeExists(merged.edges, 'filter_1', 'aggregate_1')).toBe(true);
    // Internal chain edges must be carried over — the head operator may not dead-end.
    expect(edgeExists(merged.edges, 'aggregate_1', 'filter_2')).toBe(true);
    expect(edgeExists(merged.edges, 'filter_2', 'out_1')).toBe(true);
    // The old anchor→output edge is gone (rewired through the tail).
    expect(edgeExists(merged.edges, 'filter_1', 'out_1')).toBe(false);
    expect(edgeExists(merged.edges, 'source_1', 'filter_1')).toBe(true);
    expect(merged.terminalOutputNodeId).toBe('out_1');
    // Successor shifted right to make room for the inserted nodes.
    expect(merged.nodes.find((n) => n.id === 'out_1')?.x).toBe(600 + 2 * 260);
  });

  it('keeps the generated output node when the anchor tail is open', () => {
    const base = {
      nodes: [node('source_1', 'input_source'), node('sort_1', 'sort', 300, 0)],
      edges: [edge('source_1', 'sort_1')],
    };
    const merged = mergeGeneratedChainAfterAnchor(base, 'sort_1', generatedChain(['limit_1']));

    expect(edgeExists(merged.edges, 'sort_1', 'limit_1')).toBe(true);
    const keptOutput = merged.nodes.find((n) => n.type === 'output');
    expect(keptOutput).toBeTruthy();
    expect(edgeExists(merged.edges, 'limit_1', keptOutput!.id)).toBe(true);
    expect(merged.terminalOutputNodeId).toBe(keptOutput!.id);
  });

  it('inserts before the sink when the anchor is an output node', () => {
    const base = {
      nodes: [node('source_1', 'input_source', 0, 0), node('out_1', 'output', 300, 0)],
      edges: [edge('source_1', 'out_1')],
    };
    const merged = mergeGeneratedChainAfterAnchor(base, 'out_1', generatedChain(['filter_2']));

    expect(edgeExists(merged.edges, 'source_1', 'filter_2')).toBe(true);
    expect(edgeExists(merged.edges, 'filter_2', 'out_1')).toBe(true);
    expect(edgeExists(merged.edges, 'source_1', 'out_1')).toBe(false);
    // No extra output node was added.
    expect(merged.nodes.filter((n) => n.type === 'output')).toHaveLength(1);
    expect(merged.terminalOutputNodeId).toBe('out_1');
  });

  it('deduplicates generated node ids against the base graph and remaps origins', () => {
    const base = {
      nodes: [node('source_1', 'input_source'), node('filter_1', 'filter', 300, 0)],
      edges: [edge('source_1', 'filter_1')],
    };
    const generated = generatedChain(['filter_1']);
    generated.nodes[1].config = { generatedOrigin: { nodeId: 'filter_1', operatorIndex: 0 } };
    const merged = mergeGeneratedChainAfterAnchor(base, 'filter_1', generated);

    const inserted = merged.nodes.find((n) => n.id !== 'filter_1' && n.type === 'filter');
    expect(inserted?.id).toBe('filter_2');
    expect(inserted?.config?.generatedOrigin).toMatchObject({ nodeId: 'filter_2' });
    expect(merged.nodeIdMap.get('filter_1')).toBe('filter_2');
  });

  it('keeps reject-handle edges on the anchor untouched', () => {
    const base = {
      nodes: [
        node('source_1', 'input_source'),
        node('expect_1', 'expect', 300, 0),
        node('dead', 'output', 600, 0),
      ],
      edges: [
        edge('source_1', 'expect_1'),
        { ...edge('expect_1', 'dead'), id: 'edge_expect_reject', sourceHandle: 'reject' },
        { ...edge('expect_1', 'dead', 'output'), id: 'edge_expect_out' },
      ],
    };
    const merged = mergeGeneratedChainAfterAnchor(base, 'expect_1', generatedChain(['sort_1']));

    // Reject edge stays on the anchor; the output edge rewires to the tail.
    const reject = merged.edges.find((e) => e.sourceHandle === 'reject');
    expect(reject?.sourceNodeId).toBe('expect_1');
    expect(edgeExists(merged.edges, 'expect_1', 'sort_1')).toBe(true);
    expect(edgeExists(merged.edges, 'sort_1', 'dead')).toBe(true);
  });

  it('throws when the anchor node does not exist', () => {
    const base = { nodes: [node('source_1', 'input_source')], edges: [] };
    expect(() => mergeGeneratedChainAfterAnchor(base, 'missing', generatedChain())).toThrow();
  });
});
