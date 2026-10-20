import { describe, expect, it, vi } from 'vitest';
import { WorkflowBindingResolver } from '../src/main/data/store/services/workflow-binding-resolver';

function makeResolver() {
  const rawTables = {
    createResultTableMetadata: vi.fn(async (name: string) => ({
      id: 'rt-1',
      name,
      tableName: 'result_rt_1',
    })),
    updateAutoResultTableMetadata: vi.fn(),
    requireResultTable: vi.fn(),
  };
  return { resolver: new WorkflowBindingResolver(rawTables as never), rawTables };
}

const output = (config: Record<string, unknown>) =>
  ({ id: 'o', type: 'output', label: '输出', x: 0, y: 0, config }) as never;

describe('WorkflowBindingResolver — unsaved output strategy defaults to auto', () => {
  it('creates the auto result table when only a result name is set (UI shows 「自动」)', async () => {
    const { resolver, rawTables } = makeResolver();
    const [node] = await resolver.prepareWorkflowOutputNodesForSave(
      [output({ resultTableName: '销售结果' })],
      1
    );
    expect(rawTables.createResultTableMetadata).toHaveBeenCalledWith('销售结果', 1);
    expect((node as { config: Record<string, unknown> }).config).toMatchObject({
      outputStrategy: 'auto',
      outputResultTableId: 'rt-1',
      table: 'result_rt_1',
    });
  });

  it('keeps legacy nodes that only carry a physical table untouched', async () => {
    const { resolver, rawTables } = makeResolver();
    const input = output({ table: 'legacy_table', mode: 'append' });
    const [node] = await resolver.prepareWorkflowOutputNodesForSave([input], 1);
    expect(rawTables.createResultTableMetadata).not.toHaveBeenCalled();
    expect(node).toBe(input);
  });
});
