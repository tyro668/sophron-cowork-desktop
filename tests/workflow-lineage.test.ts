import { describe, expect, it } from 'vitest';
import { compileWorkflowJflow } from '../src/shared/jflow';
import { deriveWorkflowLineage } from '../src/main/data/workflow/workflow-lineage';

const SALES = [
  { name: '门店', type: 'text' },
  { name: '品类', type: 'text' },
  { name: '销售额', type: 'decimal' },
  { name: '数量', type: 'text' },
  { name: 'Adj Close', type: 'text' },
];
const STORES = [
  { name: '门店', type: 'text' },
  { name: '区域', type: 'text' },
];
const catalog = {
  tables: [
    {
      id: 'r1',
      name: 's',
      kind: 'raw' as const,
      columns: SALES.map((c) => ({ ...c, type: 'VARCHAR' })),
    },
    {
      id: 'r2',
      name: 'd',
      kind: 'raw' as const,
      columns: STORES.map((c) => ({ ...c, type: 'VARCHAR' })),
    },
  ],
};

function lineage(body: string, output: Array<{ name: string; type?: string }>) {
  const text = `source s = @id('local:raw/r1')\nsource d = @id('local:raw/r2')\ns\n${body}\n  | write @new('o')`;
  const compiled = compileWorkflowJflow(text, catalog, 'p__');
  expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return deriveWorkflowLineage({ nodes: compiled.nodes, edges: compiled.edges }, output, (node) =>
    node.config?.rawTableId === 'r1' ? SALES : node.config?.rawTableId === 'r2' ? STORES : []
  );
}

const src = (name: string) =>
  SALES.find((c) => c.name === name) ?? STORES.find((c) => c.name === name);

describe('deriveWorkflowLineage', () => {
  it('follows renames, casts and derived / replaced columns', () => {
    const result = lineage(
      [
        '  | rename [Adj Close] as [adj]',
        "  | derive replace [adj] = replace([adj], '$', '')",
        '  | cast [adj] as decimal(18,2) on_error: null',
        '  | derive [double] = [adj] * 2',
        '  | derive [单价] = [销售额] / nullif([数量], 0)',
      ].join('\n'),
      [{ name: 'adj' }, { name: 'double' }, { name: '单价' }, { name: '门店' }]
    );
    expect(result[0]).toEqual({
      name: 'adj',
      sourceColumns: [src('Adj Close')],
      expression: "cast(replace([adj], '$', '') as decimal(18,2))",
    });
    expect(result[1]).toEqual({
      name: 'double',
      sourceColumns: [src('Adj Close')],
      expression: '[adj] * 2',
    });
    expect(result[2].sourceColumns).toEqual([src('销售额'), src('数量')]);
    expect(result[3]).toEqual({ name: '门店', sourceColumns: [src('门店')] });
  });

  it('tracks aggregates (incl. conditional), projections and join keep lists', () => {
    const result = lineage(
      [
        '  | join left d on [门店] keep: [left].*, [地区] = [d].[区域]',
        "  | group [地区] (agg [总] = sum([销售额]), [饮] = sumif([销售额], [品类] = '饮料'), [n] = count(*))",
        '  | select [地区], [总], [饮料额] = [饮], [n]',
      ].join('\n'),
      [{ name: '地区' }, { name: '总' }, { name: '饮料额' }, { name: 'n' }]
    );
    expect(result[0]).toEqual({ name: '地区', sourceColumns: [src('区域')] });
    expect(result[1]).toEqual({
      name: '总',
      sourceColumns: [src('销售额')],
      expression: 'sum([销售额])',
    });
    expect(result[2].sourceColumns.map((c) => c.name).sort()).toEqual(['品类', '销售额'].sort());
    expect(result[2].expression).toBe('[饮]');
    expect(result[3]).toEqual({ name: 'n', sourceColumns: [], expression: 'count(*)' });
  });

  it('attributes pivoted value columns to the pivot axis and measure', () => {
    const result = lineage(
      ['  | select [门店], [品类], [销售额]', '  | pivot [品类] values: sum([销售额])'].join('\n'),
      [{ name: '门店' }, { name: '饮料' }]
    );
    expect(result[0].sourceColumns).toEqual([src('门店')]);
    expect(result[1].sourceColumns.map((c) => c.name).sort()).toEqual(['品类', '销售额'].sort());
  });
});
