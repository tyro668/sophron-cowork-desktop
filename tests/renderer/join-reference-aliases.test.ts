import { describe, expect, it } from 'vitest';
import {
  collectUpstreamInputAliases,
  resolveJoinReferenceAliases,
} from '../../src/renderer/components/workflow-forms/join/joinReferenceAliases';
import { patchRowAt } from '../../src/renderer/components/workflow-forms/shared/rowListOperations';

// orders -> dedupe -> type_convert -> join(left); products -> join(right)
const nodes = [
  { id: 'orders', type: 'input_source', config: { alias: 'orders' } },
  { id: 'products', type: 'input_source', config: { alias: 'products' } },
  { id: 'dedupe', type: 'deduplicate', config: {} },
  { id: 'convert', type: 'type_convert', config: {} },
  { id: 'join', type: 'join', config: { rightAlias: 'products' } },
];
const edges = [
  { sourceNodeId: 'orders', targetNodeId: 'dedupe', targetHandle: 'input' },
  { sourceNodeId: 'dedupe', targetNodeId: 'convert', targetHandle: 'input' },
  { sourceNodeId: 'convert', targetNodeId: 'join', targetHandle: 'left' },
  { sourceNodeId: 'products', targetNodeId: 'join', targetHandle: 'right' },
];

describe('join reference aliases', () => {
  it('walks upstream to input_source aliases instead of using display labels', () => {
    expect(collectUpstreamInputAliases('convert', nodes, edges)).toEqual(['orders']);
    expect(collectUpstreamInputAliases('products', nodes, edges)).toEqual(['products']);
  });

  it('resolves saved [orders]/[products] conditions regardless of node labels', () => {
    const result = resolveJoinReferenceAliases({
      leftSourceId: 'convert',
      rightSourceId: 'products',
      nodes,
      edges,
      configRightAlias: 'products',
      savedLeftRefs: ['[orders].[商品ID]'],
    });
    expect(result).toMatchObject({ leftAlias: 'orders', rightAlias: 'products' });
  });

  it('prefers the saved qualifier when several inputs are upstream', () => {
    const multi = [...nodes, { id: 'j0', type: 'join', config: {} }];
    const multiEdges = [
      { sourceNodeId: 'orders', targetNodeId: 'j0', targetHandle: 'left' },
      { sourceNodeId: 'products', targetNodeId: 'j0', targetHandle: 'right' },
    ];
    const result = resolveJoinReferenceAliases({
      leftSourceId: 'j0',
      nodes: multi,
      edges: multiEdges,
      savedLeftRefs: ['[products].[品类]'],
    });
    expect(result.leftAliases).toEqual(['orders', 'products']);
    expect(result.leftAlias).toBe('products');
  });

  it('falls back to the right source alias when rightAlias is not configured', () => {
    const result = resolveJoinReferenceAliases({ rightSourceId: 'products', nodes, edges });
    expect(result.rightAlias).toBe('products');
  });
});

describe('patchRowAt', () => {
  it('patches the latest rows, not a stale snapshot', () => {
    const stale = [
      { id: 'a', alias: '' },
      { id: 'b', alias: '' },
    ];
    const latest = [
      { id: 'a', alias: 'ab' },
      { id: 'b', alias: '' },
    ];
    expect(patchRowAt(latest, stale, 1, { alias: 'x' })).toEqual([
      { id: 'a', alias: 'ab' },
      { id: 'b', alias: 'x' },
    ]);
  });

  it('reuses rendered ids for id-less persisted rows and placeholders', () => {
    expect(patchRowAt([{ alias: 'q' }], [{ id: 'r1', alias: 'q' }], 0, { alias: 'qq' })).toEqual([
      { id: 'r1', alias: 'qq' },
    ]);
    expect(patchRowAt([], [{ id: 'p', alias: '' }], 0, { alias: 'z' })).toEqual([
      { id: 'p', alias: 'z' },
    ]);
  });
});
