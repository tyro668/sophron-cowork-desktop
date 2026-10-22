import { describe, expect, it } from 'vitest';
import { compileWorkflowJflow } from '../../src/shared/jflow';
import { collapseWorkflowComposites } from '../../src/renderer/components/data-view/data-pipelines/workflow/workflow-composites';
import type { DataWorkflowEdge, DataWorkflowNode } from '../../src/shared/contracts/data';

const catalog = {
  tables: [
    {
      id: 'r1',
      name: '销售',
      kind: 'raw' as const,
      columns: [
        { name: '门店', type: 'VARCHAR' },
        { name: '销售额', type: 'DOUBLE' },
      ],
    },
    {
      id: 'r2',
      name: '门店',
      kind: 'raw' as const,
      columns: [
        { name: '门店', type: 'VARCHAR' },
        { name: '区域', type: 'VARCHAR' },
      ],
    },
  ],
};
const TEXT = `pipeline t
source s = @id('local:raw/r1')
source d = @id('local:raw/r2')
#! label: 取区域
let x = s
  | lookup d on [门店] get [区域]
  | where [销售额] > 0
x | write @new('out')
`;

function toWorkflow(text: string) {
  const compiled = compileWorkflowJflow(text, catalog, 'p__');
  expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  const nodes = compiled.nodes.map(
    (n, i) =>
      ({
        id: n.id,
        pipelineId: 'p',
        type: n.type,
        label: n.label,
        x: i * 200,
        y: 0,
        config: n.config,
      }) as unknown as DataWorkflowNode
  );
  const edges = compiled.edges.map(
    (e, i) =>
      ({
        id: `e${i}`,
        pipelineId: 'p',
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
        sourceHandle: e.sourceHandle ?? null,
        targetHandle: e.targetHandle ?? null,
        createdAt: 0,
      }) as DataWorkflowEdge
  );
  return { nodes, edges };
}

describe('jflow composite display', () => {
  it('persists group/label/role into config.layout and collapses to one node', () => {
    const { nodes, edges } = toWorkflow(TEXT);
    const members = nodes.filter((n) => (n.config.layout as { composite?: string })?.composite);
    expect(members.length).toBeGreaterThanOrEqual(2);
    const layout = members[0].config.layout as Record<string, unknown>;
    expect(layout.label).toBe('取区域');
    const main = layout.composite as string;
    expect(members.find((n) => n.id === main)?.config.layout).toMatchObject({ role: 'main' });

    const view = collapseWorkflowComposites(nodes, edges, new Set());
    expect(view.nodes.length).toBe(nodes.length - members.length + 1);
    const info = view.composites.get(main)!;
    expect(info.inputs).toEqual(['left', 'right']);
    const into = view.edges.filter((e) => e.targetNodeId === main);
    expect(into.map((e) => e.targetHandle).sort()).toEqual(['left', 'right']);
    // every remaining edge references a visible node
    const visible = new Set(view.nodes.map((n) => n.id));
    for (const e of view.edges) {
      expect(visible.has(e.sourceNodeId) && visible.has(e.targetNodeId)).toBe(true);
    }

    const expanded = collapseWorkflowComposites(nodes, edges, new Set([main]));
    expect(expanded.nodes.length).toBe(nodes.length);
    expect(expanded.edges.length).toBe(edges.length);
    expect(expanded.memberOf.get(main)?.expanded).toBe(true);
  });
});
