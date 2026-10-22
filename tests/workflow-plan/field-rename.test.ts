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
