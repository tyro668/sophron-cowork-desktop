import { describe, expect, it } from 'vitest';
import {
  buildWorkflowPlan,
  validateWorkflowPlanGraph,
  validateWorkflowPlanSchemas,
  WORKFLOW_PLAN_VERSION,
  type PlanColumn,
  type WorkflowPlan,
} from '../src/shared/workflow-plan';

const COLUMNS: PlanColumn[] = [
  { name: 'id', type: 'integer' },
  { name: 'name', type: 'text' },
  { name: 'amount', type: 'float' },
  { name: 'created', type: 'date' },
];

function node(id: string, type: string, config: Record<string, unknown> = {}) {
  return { id, type, label: type, x: 0, y: 0, config };
}

function edge(id: string, source: string, target: string, targetHandle = 'input') {
  return { id, sourceNodeId: source, targetNodeId: target, sourceHandle: 'output', targetHandle };
}

function linearPlan(operatorConfig: Record<string, unknown>, operatorType = 'sort') {
  return buildWorkflowPlan({
    nodes: [
      node('src', 'input', { source: 'pipeline' }),
      node('op', operatorType, operatorConfig),
      node('out', 'output', { table: 'result', mode: 'replace' }),
    ],
    edges: [edge('e1', 'src', 'op'), edge('e2', 'op', 'out')],
  }).plan;
}

function schemaDiagnostics(plan: WorkflowPlan, inputColumns: PlanColumn[] = COLUMNS) {
  return validateWorkflowPlanSchemas(plan, () => inputColumns);
}

describe('buildWorkflowPlan', () => {
  it('produces a versioned plan with typed configs', () => {
    const { plan, diagnostics } = buildWorkflowPlan({
      nodes: [
        node('src', 'input', { source: 'pipeline' }),
        node('op', 'sort', { orderBy: [{ field: 'id', direction: 'asc' }] }),
      ],
      edges: [edge('e1', 'src', 'op')],
    });
    expect(diagnostics).toHaveLength(0);
    expect(plan.version).toBe(WORKFLOW_PLAN_VERSION);
    const sort = plan.nodes.find((item) => item.id === 'op');
    expect(sort?.config).toMatchObject({ orderBy: [{ field: 'id', direction: 'asc' }] });
  });

  it('reports invalid operator configs and keeps the raw config', () => {
    const { plan, diagnostics } = buildWorkflowPlan({
      nodes: [node('op', 'sort', { keys: 'not-an-array' })],
      edges: [],
    });
    expect(diagnostics.some((item) => item.code === 'invalidConfig')).toBe(true);
    expect(plan.nodes[0].config).toEqual({ keys: 'not-an-array' });
  });
});

describe('validateWorkflowPlanGraph', () => {
  it('accepts multi-source pipeline workflows', () => {
    const { plan } = buildWorkflowPlan({
      nodes: [
        node('a', 'input', { source: 'pipeline' }),
        node('b', 'input', { source: 'rawTable', rawTableId: 'd1' }),
        node('j', 'join', { type: 'inner', conditions: [{ left: 'id', right: 'id' }] }),
        node('out', 'output'),
      ],
      edges: [edge('e1', 'a', 'j', 'left'), edge('e2', 'b', 'j', 'right'), edge('e3', 'j', 'out')],
    });
    const diagnostics = validateWorkflowPlanGraph(plan, { profile: 'pipeline' });
    expect(diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
  });

  it('flags dangling edges, self cycles and cycles', () => {
    const { plan } = buildWorkflowPlan({
      nodes: [
        node('src', 'input'),
        node('op', 'sort', { orderBy: [{ field: 'id' }] }),
        node('out', 'output'),
      ],
      edges: [
        edge('e1', 'src', 'op'),
        edge('e2', 'op', 'out'),
        edge('bad', 'op', 'ghost'),
        edge('self', 'op', 'op'),
      ],
    });
    const codes = validateWorkflowPlanGraph(plan, { profile: 'pipeline' }).map((item) => item.code);
    expect(codes).toContain('NODE_GRAPH_DANGLING_EDGE');
    expect(codes).toContain('NODE_GRAPH_SELF_CYCLE');
  });

  it('reports orphan nodes as warnings, not errors, in the pipeline profile', () => {
    const { plan } = buildWorkflowPlan({
      nodes: [
        node('src', 'input'),
        node('out', 'output'),
        node('orphan', 'sort', { orderBy: [{ field: 'id' }] }),
      ],
      edges: [edge('e1', 'src', 'out')],
    });
    const diagnostics = validateWorkflowPlanGraph(plan, { profile: 'pipeline' });
    const orphan = diagnostics.filter((item) => item.nodeId === 'orphan');
    expect(orphan.length).toBeGreaterThan(0);
    expect(orphan.every((item) => item.severity === 'warning')).toBe(true);
  });

  it('enforces generated profile constraints', () => {
    const { plan } = buildWorkflowPlan({
      nodes: [
        node('a', 'input'),
        node('b', 'input'),
        node('out', 'output'),
        node('x', 'unknown_type'),
      ],
      edges: [edge('e1', 'a', 'out')],
    });
    const diagnostics = validateWorkflowPlanGraph(plan, {
      profile: 'generated',
      allowedNodeTypes: new Set(['input', 'output']),
    });
    const codes = diagnostics.map((item) => item.code);
    expect(codes).toContain('NODE_GRAPH_INPUT_COUNT');
    expect(codes).toContain('NODE_TYPE_UNSUPPORTED');
    expect(codes).toContain('NODE_GRAPH_UNREACHABLE');
  });

  it('requires binary operators to have both inputs wired', () => {
    const { plan } = buildWorkflowPlan({
      nodes: [node('a', 'input'), node('j', 'join', {}), node('out', 'output')],
      edges: [edge('e1', 'a', 'j', 'left'), edge('e2', 'j', 'out')],
    });
    const diagnostics = validateWorkflowPlanGraph(plan, { profile: 'pipeline' });
    expect(
      diagnostics.some(
        (item) => item.code === 'NODE_GRAPH_BINARY_INPUT_INVALID' && item.severity === 'error'
      )
    ).toBe(true);
  });
});

describe('validateWorkflowPlanSchemas', () => {
  it('passes when referenced fields exist', () => {
    const diagnostics = schemaDiagnostics(
      linearPlan({ orderBy: [{ field: 'id', direction: 'asc' }] }, 'sort')
    );
    expect(diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
  });

  it('reports missing fields on sort keys', () => {
    const diagnostics = schemaDiagnostics(
      linearPlan({ orderBy: [{ field: 'missing', direction: 'asc' }] }, 'sort')
    );
    expect(
      diagnostics.some(
        (item) => item.code === 'planFieldNotFound' && item.params?.field === 'missing'
      )
    ).toBe(true);
  });

  it('checks fields referenced by filter conditions', () => {
    const diagnostics = schemaDiagnostics(linearPlan({ condition: '[ghost] > 10' }, 'filter'));
    expect(diagnostics.some((item) => item.code === 'planFieldNotFound')).toBe(true);
  });

  it('reports unparseable filter conditions', () => {
    const diagnostics = schemaDiagnostics(linearPlan({ condition: '([amount] >' }, 'filter'));
    expect(diagnostics.some((item) => item.code === 'filterConditionInvalid')).toBe(true);
  });

  it('checks expression field references in derive', () => {
    const diagnostics = schemaDiagnostics(
      linearPlan(
        { calculations: [{ field: 'total', expression: '[amount] * [ghost]', action: 'add' }] },
        'derive'
      )
    );
    expect(
      diagnostics.some(
        (item) => item.code === 'planFieldNotFound' && item.params?.field === 'ghost'
      )
    ).toBe(true);
  });

  it('propagates calculated fields to downstream operators', () => {
    const { plan } = buildWorkflowPlan({
      nodes: [
        node('src', 'input', { source: 'pipeline' }),
        node('calc', 'derive', {
          calculations: [{ field: 'total', expression: '[amount] * 2', action: 'add' }],
        }),
        node('op', 'sort', { orderBy: [{ field: 'total', direction: 'desc' }] }),
        node('out', 'output', { table: 'result' }),
      ],
      edges: [edge('e1', 'src', 'calc'), edge('e2', 'calc', 'op'), edge('e3', 'op', 'out')],
    });
    const diagnostics = schemaDiagnostics(plan);
    expect(diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
  });

  it('validates fields against projected schemas after select', () => {
    const { plan } = buildWorkflowPlan({
      nodes: [
        node('src', 'input', { source: 'pipeline' }),
        node('sel', 'select', { selection: 'include', fields: ['id'] }),
        node('op', 'sort', { orderBy: [{ field: 'amount', direction: 'desc' }] }),
        node('out', 'output'),
      ],
      edges: [edge('e1', 'src', 'sel'), edge('e2', 'sel', 'op'), edge('e3', 'op', 'out')],
    });
    const diagnostics = schemaDiagnostics(plan);
    expect(
      diagnostics.some(
        (item) => item.code === 'planFieldNotFound' && item.params?.field === 'amount'
      )
    ).toBe(true);
  });

  it('renames fields through rename', () => {
    const { plan } = buildWorkflowPlan({
      nodes: [
        node('src', 'input', { source: 'pipeline' }),
        node('map', 'rename', {
          mappings: [{ source: 'amount', targetMode: 'rename', targetValue: 'total' }],
        }),
        node('op', 'sort', { orderBy: [{ field: 'total', direction: 'desc' }] }),
        node('out', 'output'),
      ],
      edges: [edge('e1', 'src', 'map'), edge('e2', 'map', 'op'), edge('e3', 'op', 'out')],
    });
    expect(schemaDiagnostics(plan).filter((item) => item.severity === 'error')).toHaveLength(0);
  });

  it('warns on nondeterministic limit without order by', () => {
    const diagnostics = schemaDiagnostics(linearPlan({ mode: 'first', count: 10 }, 'limit'));
    expect(diagnostics.some((item) => item.code === 'limitNondeterministic')).toBe(true);
  });

  it('warns on random sampling without seed', () => {
    const diagnostics = schemaDiagnostics(linearPlan({ sampling: 'random', count: 10 }, 'limit'));
    expect(diagnostics.some((item) => item.code === 'limitSampleWithoutSeed')).toBe(true);
  });

  it('warns on nondeterministic deduplicate', () => {
    const diagnostics = schemaDiagnostics(
      linearPlan({ fields: ['id'], keep: 'first', orderBy: [] }, 'deduplicate')
    );
    expect(diagnostics.some((item) => item.code === 'deduplicateNondeterministic')).toBe(true);
  });

  it('validates aggregate group fields and grain fields', () => {
    const diagnostics = schemaDiagnostics(
      linearPlan(
        {
          groupBy: ['name'],
          metrics: [{ function: 'sum', expression: '[amount]', alias: 'total' }],
          dateGranularity: { ghost: 'month' },
        },
        'aggregate'
      )
    );
    const codes = diagnostics.map((item) => item.code);
    expect(codes).toContain('aggregateGrainNotInGroup');
  });

  it('validates join condition fields on both sides', () => {
    const { plan } = buildWorkflowPlan({
      nodes: [
        node('a', 'input', { source: 'pipeline' }),
        node('b', 'input', { source: 'rawTable', rawTableId: 'd' }),
        node('j', 'join', {
          type: 'inner',
          conditions: [{ left: '[a].[id]', right: '[b].[missing]', operator: '=' }],
        }),
        node('out', 'output'),
      ],
      edges: [edge('e1', 'a', 'j', 'left'), edge('e2', 'b', 'j', 'right'), edge('e3', 'j', 'out')],
    });
    const diagnostics = validateWorkflowPlanSchemas(plan, (n) =>
      n.id === 'b' ? COLUMNS : COLUMNS
    );
    // 'missing' does not exist on the right side
    expect(
      diagnostics.some(
        (item) => item.code === 'planFieldNotFound' && item.params?.field === 'missing'
      )
    ).toBe(true);
  });

  it('warns when join condition types are incompatible', () => {
    const { plan } = buildWorkflowPlan({
      nodes: [
        node('a', 'input', { source: 'pipeline' }),
        node('b', 'input', { source: 'rawTable', rawTableId: 'd' }),
        node('j', 'join', {
          type: 'inner',
          conditions: [{ left: '[a].[id]', right: '[b].[name]', operator: '=' }],
        }),
        node('out', 'output'),
      ],
      edges: [edge('e1', 'a', 'j', 'left'), edge('e2', 'b', 'j', 'right'), edge('e3', 'j', 'out')],
    });
    const diagnostics = validateWorkflowPlanSchemas(plan, () => COLUMNS);
    expect(diagnostics.some((item) => item.code === 'joinConditionTypeMismatch')).toBe(true);
  });

  it('propagates join output columns downstream', () => {
    const rightColumns: PlanColumn[] = [
      { name: 'id', type: 'integer' },
      { name: 'segment', type: 'text' },
    ];
    const { plan } = buildWorkflowPlan({
      nodes: [
        node('a', 'input', { source: 'pipeline' }),
        node('b', 'input', { source: 'rawTable', rawTableId: 'd' }),
        node('j', 'join', {
          type: 'left',
          conditions: [{ left: '[a].[id]', right: '[b].[id]', operator: '=' }],
        }),
        node('op', 'sort', { orderBy: [{ field: 'segment', direction: 'asc' }] }),
        node('out', 'output'),
      ],
      edges: [
        edge('e1', 'a', 'j', 'left'),
        edge('e2', 'b', 'j', 'right'),
        edge('e3', 'j', 'op'),
        edge('e4', 'op', 'out'),
      ],
    });
    const diagnostics = validateWorkflowPlanSchemas(plan, (n) =>
      n.id === 'b' ? rightColumns : COLUMNS
    );
    expect(diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
  });

  it('join keep wildcards project only their side, matching the runtime projection', () => {
    const rightColumns: PlanColumn[] = [
      { name: 'id', type: 'integer' },
      { name: 'segment', type: 'text' },
    ];
    const { plan } = buildWorkflowPlan({
      nodes: [
        node('a', 'input', { source: 'pipeline' }),
        node('b', 'input', { source: 'rawTable', rawTableId: 'd' }),
        node('j', 'join', {
          type: 'left',
          conditions: [{ left: '[a].[id]', right: '[b].[id]', operator: '=' }],
          // keep one left field + all right columns: left 'name' is dropped
          keep: [{ source: '[a].[id]' }, { side: 'right', wildcard: true }],
        }),
        node('ok', 'sort', { orderBy: [{ field: 'segment', direction: 'asc' }] }),
        node('bad', 'sort', { orderBy: [{ field: 'name', direction: 'asc' }] }),
        node('out', 'output'),
      ],
      edges: [
        edge('e1', 'a', 'j', 'left'),
        edge('e2', 'b', 'j', 'right'),
        edge('e3', 'j', 'ok'),
        edge('e4', 'ok', 'bad'),
        edge('e5', 'bad', 'out'),
      ],
    });
    const diagnostics = validateWorkflowPlanSchemas(plan, (n) =>
      n.id === 'b' ? rightColumns : COLUMNS
    );
    // right-side 'segment' resolves; dropped left 'name' is flagged
    expect(
      diagnostics.some(
        (item) =>
          item.code === 'planFieldNotFound' &&
          item.params?.field === 'name' &&
          item.nodeId === 'bad'
      )
    ).toBe(true);
    expect(
      diagnostics.some(
        (item) => item.code === 'planFieldNotFound' && item.params?.field === 'segment'
      )
    ).toBe(false);
  });

  it('checks set_op column alignment by name', () => {
    const { plan } = buildWorkflowPlan({
      nodes: [
        node('a', 'input', { source: 'pipeline' }),
        node('b', 'input', { source: 'rawTable', rawTableId: 'd' }),
        node('u', 'set_op', { operation: 'union', match: 'by_name' }),
        node('out', 'output'),
      ],
      edges: [edge('e1', 'a', 'u', 'left'), edge('e2', 'b', 'u', 'right'), edge('e3', 'u', 'out')],
    });
    const diagnostics = validateWorkflowPlanSchemas(plan, (n) =>
      n.id === 'a' ? COLUMNS : [{ name: 'id', type: 'integer' }]
    );
    expect(diagnostics.some((item) => item.code === 'setOpColumnMissing')).toBe(true);
  });

  it('propagates right-only columns through union by name to downstream operators', () => {
    const { plan } = buildWorkflowPlan({
      nodes: [
        node('a', 'input', { source: 'pipeline' }),
        node('b', 'input', { source: 'rawTable', rawTableId: 'd' }),
        node('u', 'set_op', { operation: 'union', match: 'by_name', rightInput: 'b' }),
        node('s', 'sort', { orderBy: [{ field: '区域', direction: 'asc' }] }),
        node('out', 'output'),
      ],
      edges: [
        edge('e1', 'a', 'u', 'left'),
        edge('e2', 'b', 'u', 'right'),
        edge('e3', 'u', 's'),
        edge('e4', 's', 'out'),
      ],
    });
    const diagnostics = validateWorkflowPlanSchemas(plan, (n) =>
      n.id === 'a'
        ? COLUMNS
        : [
            { name: 'id', type: 'integer' },
            { name: '区域', type: 'text' },
          ]
    );
    expect(
      diagnostics.some((item) => item.code === 'planFieldNotFound' && item.params?.field === '区域')
    ).toBe(false);
  });

  it('keeps left columns only for union by position', () => {
    const { plan } = buildWorkflowPlan({
      nodes: [
        node('a', 'input', { source: 'pipeline' }),
        node('b', 'input', { source: 'rawTable', rawTableId: 'd' }),
        node('u', 'set_op', { operation: 'union', match: 'by_position', rightInput: 'b' }),
        node('s', 'sort', { orderBy: [{ field: 'other', direction: 'asc' }] }),
        node('out', 'output'),
      ],
      edges: [
        edge('e1', 'a', 'u', 'left'),
        edge('e2', 'b', 'u', 'right'),
        edge('e3', 'u', 's'),
        edge('e4', 's', 'out'),
      ],
    });
    const diagnostics = validateWorkflowPlanSchemas(plan, (n) =>
      n.id === 'a' ? COLUMNS : [...COLUMNS.slice(0, 3), { name: 'other', type: 'text' }]
    );
    expect(
      diagnostics.some(
        (item) => item.code === 'planFieldNotFound' && item.params?.field === 'other'
      )
    ).toBe(true);
  });

  it('errors when set_op by_position column counts differ', () => {
    const { plan } = buildWorkflowPlan({
      nodes: [
        node('a', 'input', { source: 'pipeline' }),
        node('b', 'input', { source: 'rawTable', rawTableId: 'd' }),
        node('u', 'set_op', { operation: 'union', match: 'by_position' }),
        node('out', 'output'),
      ],
      edges: [edge('e1', 'a', 'u', 'left'), edge('e2', 'b', 'u', 'right'), edge('e3', 'u', 'out')],
    });
    const diagnostics = validateWorkflowPlanSchemas(plan, (n) =>
      n.id === 'a' ? COLUMNS : [{ name: 'id', type: 'integer' }]
    );
    expect(
      diagnostics.some(
        (item) => item.code === 'setOpColumnCountMismatch' && item.severity === 'error'
      )
    ).toBe(true);
  });

  it('skips field checks when the input schema is unknown', () => {
    const diagnostics = validateWorkflowPlanSchemas(
      linearPlan({ orderBy: [{ field: 'anything', direction: 'asc' }] }, 'sort'),
      () => null
    );
    expect(diagnostics).toHaveLength(0);
  });
});

describe('ETL runtime contract validation', () => {
  it('requires merge keys for mode merge and checks them against upstream schema', () => {
    const plan = buildWorkflowPlan({
      nodes: [
        node('src', 'input', { source: 'pipeline' }),
        node('out', 'output', { table: 't', mode: 'merge', mergeKeys: ['id', 'missing_key'] }),
      ],
      edges: [edge('e1', 'src', 'out')],
    }).plan;
    const diagnostics = schemaDiagnostics(plan);
    expect(diagnostics.some((item) => item.code === 'planFieldNotFound')).toBe(true);
  });

  it('rejects mode merge without keys', () => {
    const plan = buildWorkflowPlan({
      nodes: [
        node('src', 'input', { source: 'pipeline' }),
        node('out', 'output', { table: 't', mode: 'merge' }),
      ],
      edges: [edge('e1', 'src', 'out')],
    }).plan;
    const diagnostics = schemaDiagnostics(plan);
    expect(diagnostics.some((item) => item.code === 'outputMergeKeysMissing')).toBe(true);
  });

  it('checks incrementalBy against the source schema', () => {
    const plan = buildWorkflowPlan({
      nodes: [
        node('src', 'input', { source: 'pipeline', incrementalBy: 'updated_at' }),
        node('out', 'output', { table: 't', mode: 'append' }),
      ],
      edges: [edge('e1', 'src', 'out')],
    }).plan;
    const diagnostics = schemaDiagnostics(plan);
    expect(diagnostics.some((item) => item.code === 'planFieldNotFound')).toBe(true);

    const ok = buildWorkflowPlan({
      nodes: [
        node('src', 'input', { source: 'pipeline', incrementalBy: 'created' }),
        node('out', 'output', { table: 't', mode: 'append' }),
      ],
      edges: [edge('e1', 'src', 'out')],
    }).plan;
    expect(schemaDiagnostics(ok).filter((item) => item.severity === 'error')).toHaveLength(0);
  });

  it('does not require a legacy incremental field on a bound input table', () => {
    const plan = buildWorkflowPlan({
      nodes: [
        node('src', 'input', {
          source: 'rawTable',
          rawTableId: 'table-id',
          incrementalBy: 'removed_column',
        }),
        node('out', 'output', { table: 't' }),
      ],
      edges: [edge('e1', 'src', 'out')],
    }).plan;
    expect(schemaDiagnostics(plan).filter((item) => item.severity === 'error')).toHaveLength(0);
  });

  it('validates expect expression fields and unique columns', () => {
    const plan = buildWorkflowPlan({
      nodes: [
        node('src', 'input', { source: 'pipeline' }),
        node('ex', 'expect', { kind: 'expression', expression: '[bogus] > 0' }),
        node('out', 'output', { table: 't' }),
      ],
      edges: [edge('e1', 'src', 'ex'), edge('e2', 'ex', 'out')],
    }).plan;
    const diagnostics = schemaDiagnostics(plan);
    expect(diagnostics.some((item) => item.code === 'planFieldNotFound')).toBe(true);

    const uniquePlan = buildWorkflowPlan({
      nodes: [
        node('src', 'input', { source: 'pipeline' }),
        node('ex', 'expect', { kind: 'unique', fields: ['id'] }),
        node('out', 'output', { table: 't' }),
      ],
      edges: [edge('e1', 'src', 'ex'), edge('e2', 'ex', 'out')],
    }).plan;
    expect(schemaDiagnostics(uniquePlan).filter((item) => item.severity === 'error')).toHaveLength(
      0
    );
  });

  it('rejects a reject edge from a non-expect node and a missing reject stream', () => {
    const badSource = buildWorkflowPlan({
      nodes: [
        node('src', 'input', { source: 'pipeline' }),
        node('f', 'filter', { condition: '[amount] > 0' }),
        node('out', 'output', { table: 't' }),
      ],
      edges: [
        edge('e1', 'src', 'f'),
        {
          id: 'e2',
          sourceNodeId: 'f',
          targetNodeId: 'out',
          sourceHandle: 'reject',
          targetHandle: 'input',
        },
      ],
    }).plan;
    const graphDiags = validateWorkflowPlanGraph(badSource, { profile: 'pipeline' });
    expect(
      graphDiags.some(
        (item) => item.code === 'NODE_GRAPH_SOURCE_HANDLE_INVALID' && item.severity === 'error'
      )
    ).toBe(true);

    const missingStream = buildWorkflowPlan({
      nodes: [
        node('src', 'input', { source: 'pipeline' }),
        node('ex', 'expect', { kind: 'expression', expression: '[amount] > 0' }),
        node('out', 'output', { table: 't' }),
      ],
      edges: [
        edge('e1', 'src', 'ex'),
        {
          id: 'e2',
          sourceNodeId: 'ex',
          targetNodeId: 'out',
          sourceHandle: 'reject',
          targetHandle: 'input',
        },
      ],
    }).plan;
    const missingDiags = validateWorkflowPlanGraph(missingStream, { profile: 'pipeline' });
    expect(missingDiags.some((item) => item.code === 'NODE_GRAPH_REJECT_STREAM_MISSING')).toBe(
      true
    );
  });

  it('warns when a declared reject stream has no consuming edge', () => {
    const plan = buildWorkflowPlan({
      nodes: [
        node('src', 'input', { source: 'pipeline' }),
        node('ex', 'expect', {
          kind: 'expression',
          expression: '[amount] > 0',
          rejectStream: 'bad_rows',
        }),
        node('out', 'output', { table: 't' }),
      ],
      edges: [edge('e1', 'src', 'ex'), edge('e2', 'ex', 'out')],
    }).plan;
    const diagnostics = validateWorkflowPlanGraph(plan, { profile: 'pipeline' });
    expect(
      diagnostics.some(
        (item) => item.code === 'NODE_GRAPH_REJECT_STREAM_UNCONSUMED' && item.severity === 'warning'
      )
    ).toBe(true);
  });
});

describe('schema validation follows the executor grammar', () => {
  it('accepts full scalar-expression filter conditions (boolean column, cast, nested calls)', () => {
    for (const condition of [
      '[flag]',
      'cast([amount] as decimal(18,2)) > 0',
      "[name] is not null and abs(date_diff('day', [created], [created])) > 3",
    ]) {
      const columns = [...COLUMNS, { name: 'flag', type: 'boolean' }];
      const diagnostics = schemaDiagnostics(linearPlan({ condition }, 'filter'), columns);
      expect(diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    }
  });

  it('still rejects unparseable filter conditions and unknown fields', () => {
    const bad = schemaDiagnostics(linearPlan({ condition: '[amount] >' }, 'filter'));
    expect(bad.map((item) => item.code)).toContain('filterConditionInvalid');
    const unknown = schemaDiagnostics(linearPlan({ condition: 'abs([missing]) > 1' }, 'filter'));
    expect(unknown.some((item) => item.severity === 'error')).toBe(true);
  });

  it('gives semi/anti joins exactly the left schema', () => {
    const plan = buildWorkflowPlan({
      nodes: [
        node('a', 'input', { source: 'pipeline' }),
        node('b', 'input', { source: 'pipeline' }),
        node('j', 'join', {
          joinType: 'anti',
          conditions: [{ left: 'id', operator: '=', right: 'id' }],
        }),
        node('s', 'select', { fields: ['id', 'name', 'amount', 'created'], selection: 'include' }),
        node('out', 'output', { table: 'result', mode: 'replace' }),
      ],
      edges: [
        edge('e1', 'a', 'j', 'left'),
        edge('e2', 'b', 'j', 'right'),
        edge('e3', 'j', 's'),
        edge('e4', 's', 'out'),
      ],
    }).plan;
    const diagnostics = schemaDiagnostics(plan);
    expect(diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
  });
});
