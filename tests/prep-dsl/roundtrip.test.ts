import { describe, expect, it } from 'vitest';
import {
  compilePrepWorkflowToFlow,
  exportPrepWorkflowDsl,
  parsePrepDsl,
  type PrepWorkflowCompileResult,
} from '../../src/shared/prep-dsl';

function compile(dsl: string): PrepWorkflowCompileResult {
  const parsed = parsePrepDsl(dsl);
  expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  const compiled = compilePrepWorkflowToFlow(parsed.ast!);
  expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return compiled;
}

/** Semantic graph signature: node types+configs (sans ids) and the edge multiset. */
function graphSignature(result: PrepWorkflowCompileResult) {
  const typeById = new Map(result.nodes.map((n) => [n.id, n]));
  const strip = (config: Record<string, unknown> | undefined) => {
    const rest = { ...(config ?? {}) };
    delete rest.dsl;
    delete rest.stepName;
    return rest;
  };
  const nodeSig = result.nodes.map((n) => `${n.type}::${JSON.stringify(strip(n.config))}`).sort();
  const edgeSig = result.edges
    .map((e) => {
      const s = typeById.get(e.sourceNodeId)!;
      const t = typeById.get(e.targetNodeId)!;
      const srcKey = `${s.type}::${JSON.stringify(strip(s.config))}`;
      const tgtKey = `${t.type}::${JSON.stringify(strip(t.config))}`;
      return `${srcKey}:${e.sourceHandle ?? 'output'}->${tgtKey}:${e.targetHandle ?? 'input'}`;
    })
    .sort();
  return { nodeSig, edgeSig };
}

function expectRoundTrip(dsl: string) {
  const first = compile(dsl);
  const exported = exportPrepWorkflowDsl(first.nodes, first.edges);
  const second = compile(exported);
  expect(graphSignature(second)).toEqual(graphSignature(first));
  // Third round-trip must be textually stable too.
  expect(exportPrepWorkflowDsl(second.nodes, second.edges)).toBe(exported);
}

describe('workflow DSL round-trip', () => {
  it('keeps a linear pipeline byte-stable', () => {
    const dsl =
      'input source pipeline as src\n  | filter [amount] > 0\n  | output table "t" mode replace';
    expect(exportPrepWorkflowDsl(compile(dsl).nodes, compile(dsl).edges)).toBe(dsl);
  });

  it('round-trips a branching named-step workflow', () => {
    expectRoundTrip(
      [
        'input source pipeline as src',
        'input source rawTable "dim" as dim',
        '',
        'step base = src',
        '  | filter [amount] > 0',
        '  | sort by [id]',
        'step joined = base',
        '  | join left dim on [base].[k] = [dim].[k]',
        '  | output table "result" mode replace',
        'step sample = base',
        '  | limit 10',
        '  | output table "sample" mode append',
      ].join('\n')
    );
  });

  it('round-trips a fan-out without joins', () => {
    expectRoundTrip(
      [
        'input source pipeline as src',
        'step clean = src',
        '  | filter [amount] > 0',
        'step totals = clean',
        '  | aggregate by [region] metrics sum([amount]) as [total]',
        '  | output table "totals" mode replace',
        'step recent = clean',
        '  | limit 5',
        '  | output table "recent" mode replace',
      ].join('\n')
    );
  });

  it('round-trips join on a named step right input', () => {
    expectRoundTrip(
      [
        'input source pipeline as orders',
        'input source rawTable "cust" as customers',
        '',
        'step keep = orders',
        '  | select [id], [cid], [amount]',
        'step dim = customers',
        '  | deduplicate by [cid]',
        'step joined = keep',
        '  | join left dim on [keep].[cid] = [dim].[cid]',
        '  | output table "joined" mode replace',
      ].join('\n')
    );
  });

  it('round-trips an expect reject stream feeding a sink', () => {
    expectRoundTrip(
      [
        'input source pipeline as src',
        '',
        'step checked = src',
        '  | expect [amount] > 0 reject to bad_rows',
        '  | output table "clean" mode replace',
        'step rejects = bad_rows',
        '  | output table "rejects" mode append',
      ].join('\n')
    );
  });

  it('round-trips merge output and incremental input', () => {
    const dsl =
      'input source pipeline incremental by [updated_at] as src\n' +
      '  | expect unique [id]\n' +
      '  | output table "t" mode merge by [id] schema strict';
    expect(exportPrepWorkflowDsl(compile(dsl).nodes, compile(dsl).edges)).toBe(dsl);
  });

  it('preserves multiple output sinks', () => {
    const compiled = compile(
      [
        'input source pipeline as src',
        'step a = src',
        '  | sort by [id]',
        '  | output table "one" mode replace',
        'step b = a',
        '  | output table "two" mode append',
      ].join('\n')
    );
    expect(compiled.nodes.filter((n) => n.type === 'output')).toHaveLength(2);
  });

  it('rejects forward step references', () => {
    const compiled = compilePrepWorkflowToFlow(
      parsePrepDsl(
        'input source pipeline as s\nstep a = later\n  | sort by [x]\nstep later = s\n  | filter [y] > 0\nstep out = a\n  | output table "t" mode replace'
      ).ast!
    );
    expect(compiled.diagnostics.map((d) => d.code)).toContain('stepInputNotFound');
  });

  it('rejects duplicate step names', () => {
    const compiled = compilePrepWorkflowToFlow(
      parsePrepDsl(
        'input source pipeline as s\nstep a = s\n  | sort by [x]\nstep a = s\n  | filter [y] > 0'
      ).ast!
    );
    expect(compiled.diagnostics.map((d) => d.code)).toContain('duplicateStepName');
  });

  it('rejects operators after an output sink in one step', () => {
    const compiled = compilePrepWorkflowToFlow(
      parsePrepDsl(
        'input source pipeline as s\nstep a = s\n  | output table "t" mode replace\n  | sort by [x]'
      ).ast!
    );
    expect(compiled.diagnostics.map((d) => d.code)).toContain('outputNotTerminal');
  });

  it('rejects step names colliding with source aliases', () => {
    const compiled = compilePrepWorkflowToFlow(
      parsePrepDsl('input source pipeline as s\nstep s = s\n  | sort by [x]').ast!
    );
    expect(compiled.diagnostics.map((d) => d.code)).toContain('duplicateStepName');
  });

  it('assigns unique aliases to input sources without explicit aliases', () => {
    const nodes = [
      {
        id: 'a',
        type: 'input_source' as const,
        config: { source: 'rawTable', rawTableId: 'orders' },
      },
      {
        id: 'b',
        type: 'input_source' as const,
        config: { source: 'rawTable', rawTableId: 'customers' },
      },
      {
        id: 'j',
        type: 'join' as const,
        config: {
          joinType: 'left',
          conditions: [{ left: 'a.id', right: 'b.id', operator: '=' }],
        },
      },
      { id: 'o', type: 'output' as const, config: { table: 't', mode: 'replace' } },
    ];
    const edges = [
      { sourceNodeId: 'a', targetNodeId: 'j', targetHandle: 'left' },
      { sourceNodeId: 'b', targetNodeId: 'j', targetHandle: 'right' },
      { sourceNodeId: 'j', targetNodeId: 'o', targetHandle: 'input' },
    ];
    const dsl = exportPrepWorkflowDsl(nodes, edges);
    expect(dsl).toContain('input source rawTable "orders" as src');
    expect(dsl).toContain('input source rawTable "customers" as src_2');
    expect(dsl).toContain('join left src_2 on [src].[id] = [src_2].[id]');
    // The exported DSL parses cleanly and re-exports byte-stably: imported
    // sources carry the generated aliases explicitly.
    const reparsed = compile(dsl);
    expect(exportPrepWorkflowDsl(reparsed.nodes, reparsed.edges)).toBe(dsl);
  });

  it('deduplicates colliding explicit source aliases deterministically', () => {
    const nodes = [
      {
        id: 'a',
        type: 'input_source' as const,
        config: { source: 'rawTable', rawTableId: 'orders', alias: 'shared' },
      },
      {
        id: 'b',
        type: 'input_source' as const,
        config: { source: 'rawTable', rawTableId: 'customers', alias: 'shared' },
      },
      {
        id: 'j',
        type: 'join' as const,
        config: {
          joinType: 'inner',
          conditions: [{ left: 'x.k', right: 'y.k', operator: '=' }],
        },
      },
      { id: 'o', type: 'output' as const, config: { table: 't', mode: 'replace' } },
    ];
    const edges = [
      { sourceNodeId: 'a', targetNodeId: 'j', targetHandle: 'left' },
      { sourceNodeId: 'b', targetNodeId: 'j', targetHandle: 'right' },
      { sourceNodeId: 'j', targetNodeId: 'o', targetHandle: 'input' },
    ];
    const dsl = exportPrepWorkflowDsl(nodes, edges);
    expect(dsl).toContain('input source rawTable "orders" as shared');
    expect(dsl).toContain('input source rawTable "customers" as shared_2');
    expect(dsl).toContain('join inner shared_2 on [shared].[k] = [shared_2].[k]');
    const reparsed = compile(dsl);
    expect(exportPrepWorkflowDsl(reparsed.nodes, reparsed.edges)).toBe(dsl);
  });
});

describe('export rejects inexpressible graphs', () => {
  const src = {
    id: 's',
    type: 'input_source' as const,
    config: { alias: 's', source: 'pipeline' },
  };
  const filt = (id: string) => ({
    id,
    type: 'filter' as const,
    config: { expression: '[x] > 0' },
  });

  it('errors on disconnected operator nodes', () => {
    expect(() => exportPrepWorkflowDsl([src, filt('orphan')], [])).toThrow(
      /not connected|unreachable/
    );
  });

  it('errors on cyclic graphs', () => {
    expect(() =>
      exportPrepWorkflowDsl(
        [src, filt('a'), filt('b')],
        [
          { sourceNodeId: 's', targetNodeId: 'a', targetHandle: 'input' },
          { sourceNodeId: 'a', targetNodeId: 'b', targetHandle: 'input' },
          { sourceNodeId: 'b', targetNodeId: 'a', targetHandle: 'input' },
        ]
      )
    ).toThrow();
  });

  it('errors on dangling edges', () => {
    expect(() =>
      exportPrepWorkflowDsl(
        [src, filt('a')],
        [
          { sourceNodeId: 's', targetNodeId: 'a', targetHandle: 'input' },
          { sourceNodeId: 'a', targetNodeId: 'ghost', targetHandle: 'input' },
        ]
      )
    ).toThrow(/unknown node/);
  });

  it('errors on a missing join right input', () => {
    const join = { id: 'j', type: 'join' as const, config: { joinType: 'left' } };
    expect(() =>
      exportPrepWorkflowDsl(
        [src, join],
        [{ sourceNodeId: 's', targetNodeId: 'j', targetHandle: 'left' }]
      )
    ).toThrow(/right/);
  });

  it('errors on an output node with outgoing edges', () => {
    const out = { id: 'o', type: 'output' as const, config: { table: 't' } };
    expect(() =>
      exportPrepWorkflowDsl(
        [src, out, filt('a')],
        [
          { sourceNodeId: 's', targetNodeId: 'o', targetHandle: 'input' },
          { sourceNodeId: 'o', targetNodeId: 'a', targetHandle: 'input' },
        ]
      )
    ).toThrow(/outgoing/);
  });

  it('errors on an incomplete operator instead of guessing', () => {
    const incomplete = { id: 'j', type: 'join' as const, config: { joinType: 'left' } };
    expect(() =>
      exportPrepWorkflowDsl(
        [src, incomplete],
        [
          { sourceNodeId: 's', targetNodeId: 'j', targetHandle: 'left' },
          { sourceNodeId: 's', targetNodeId: 'j', targetHandle: 'right' },
        ]
      )
    ).toThrow();
  });
});
