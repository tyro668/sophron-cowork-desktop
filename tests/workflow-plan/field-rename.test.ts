import { describe, expect, it } from 'vitest';
import {
  detectFieldRenames,
  propagateFieldRenames,
  renameFieldReferences,
} from '../../src/shared/workflow-plan/field-rename';
import { OPERATOR_NAMING } from '../../src/shared/operators/naming';
import { OPERATOR_TYPES, OPERATOR_GROUPS } from '../../src/shared/operators';

describe('field rename propagation', () => {
  it('detects rename targets edited in rename and derive', () => {
    expect(
      detectFieldRenames(
        'rename',
        { mappings: [{ id: 'm', source: 'a', targetMode: 'rename', targetValue: 'b' }] },
        { mappings: [{ id: 'm', source: 'a', targetMode: 'rename', targetValue: 'c' }] }
      )
    ).toEqual([['b', 'c']]);
    expect(
      detectFieldRenames(
        'derive',
        { calculations: [{ id: 'x', field: '利润', expression: '1', action: 'add' }] },
        { calculations: [{ id: 'x', field: '毛利', expression: '1', action: 'add' }] }
      )
    ).toEqual([['利润', '毛利']]);
  });

  it('rewrites field refs, field lists and bracket expressions only', () => {
    expect(
      renameFieldReferences(
        {
          condition: '[利润] > 0 and [利润率] < 1',
          orderBy: [{ field: '利润', direction: 'desc' }],
          fields: ['利润', '其他'],
          label: '利润',
        },
        '利润',
        '毛利'
      )
    ).toEqual({
      condition: '[毛利] > 0 and [利润率] < 1',
      orderBy: [{ field: '毛利', direction: 'desc' }],
      fields: ['毛利', '其他'],
      label: '利润',
    });
    expect(renameFieldReferences({ fields: ['x'] }, '利润', '毛利')).toBeNull();
  });

  it('propagates only downstream', () => {
    const graph = {
      nodes: [
        { id: 'up', type: 'filter', config: { condition: '[a] > 1' } },
        { id: 'n', type: 'rename', config: {} },
        { id: 'down', type: 'sort', config: { orderBy: [{ field: 'a' }] } },
      ],
      edges: [
        { sourceNodeId: 'up', targetNodeId: 'n' },
        { sourceNodeId: 'n', targetNodeId: 'down' },
      ],
    };
    const next = propagateFieldRenames(graph, 'n', [['a', 'b']]);
    expect(next.nodes[0].config).toEqual({ condition: '[a] > 1' });
    expect(next.nodes[2].config).toEqual({ orderBy: [{ field: 'b' }] });
  });
});

describe('operator naming table', () => {
  it('covers every operator type and the cleaning group', () => {
    expect(Object.keys(OPERATOR_NAMING).sort()).toEqual([...OPERATOR_TYPES].sort());
    expect(OPERATOR_GROUPS.find((g) => g.category === 'cleaning')?.operatorTypes).toEqual(
      expect.arrayContaining(['deduplicate', 'missing_value', 'cast', 'rename'])
    );
  });
});

describe('AST / origin-based rename propagation', () => {
  it('rewrites only field tokens, leaving strings and other tables alone', async () => {
    const { renameExpressionField } = await import('../../src/shared/workflow-plan/field-rename');
    expect(renameExpressionField(`[利润] > 0 and [备注] = '[利润]'`, '利润', '毛利')).toBe(
      `[毛利] > 0 and [备注] = '[利润]'`
    );
    expect(renameExpressionField(`"利润" + 1`, '利润', '毛利')).toBe(`"毛利" + 1`);
    expect(
      renameExpressionField(
        '[orders].[amount] + [customers].[amount]',
        'amount',
        'net',
        (q) => q === 'orders'
      )
    ).toBe('[orders].[net] + [customers].[amount]');
  });

  it('only rewrites the join side the renamed field flows into', () => {
    const graph = {
      nodes: [
        { id: 'a', type: 'input', config: { alias: 'orders' } },
        { id: 'r', type: 'rename', config: {} },
        { id: 'b', type: 'input', config: { alias: 'customers' } },
        {
          id: 'j',
          type: 'join',
          config: {
            conditions: [{ left: 'id', operator: '=', right: 'id' }],
            keep: [
              { side: 'left', source: 'id' },
              { side: 'right', source: 'id', alias: 'cid' },
            ],
          },
        },
      ],
      edges: [
        { sourceNodeId: 'a', targetNodeId: 'r' },
        { sourceNodeId: 'r', targetNodeId: 'j', targetHandle: 'left' },
        { sourceNodeId: 'b', targetNodeId: 'j', targetHandle: 'right' },
      ],
    };
    const next = propagateFieldRenames(graph, 'r', [['id', 'order_id']]);
    expect(next.nodes[3].config).toEqual({
      conditions: [{ left: 'order_id', operator: '=', right: 'id' }],
      keep: [
        { side: 'left', source: 'order_id' },
        { side: 'right', source: 'id', alias: 'cid' },
      ],
    });
  });

  it('stops when a downstream node re-defines the old name and never renames outputs', () => {
    const graph = {
      nodes: [
        { id: 'r', type: 'rename', config: {} },
        {
          id: 'd',
          type: 'derive',
          config: { calculations: [{ field: 'x', expression: '[x] * 2' }] },
        },
        { id: 'f', type: 'filter', config: { condition: '[x] > 1' } },
      ],
      edges: [
        { sourceNodeId: 'r', targetNodeId: 'd' },
        { sourceNodeId: 'd', targetNodeId: 'f' },
      ],
    };
    const next = propagateFieldRenames(graph, 'r', [['x', 'y']]);
    expect(next.nodes[1].config).toEqual({
      calculations: [{ field: 'x', expression: '[y] * 2' }],
    });
    expect(next.nodes[2].config).toEqual({ condition: '[x] > 1' });
  });
});
