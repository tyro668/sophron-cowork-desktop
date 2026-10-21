import { describe, expect, it, vi } from 'vitest';
import { createDataCustomTools } from '../../main/data/data-tool-definitions';
import { DATA_TOOL_PACKS } from '../../main/data/data-tool-packs';
import { reviewAutoPermission } from '../../main/config/permission-auto-review';

describe('data_create_pipeline tool', () => {
  const createPipeline = vi.fn(async (input: unknown) => ({
    content: [{ type: 'text', text: 'Created data pipeline' }],
    details: { pipeline: { id: 'p1', ...(input as object) } },
  }));
  const service = { createPipeline, rememberResolvedResources: vi.fn() } as never;

  it('is defined, routes to the service layer and is part of the authoring pack', async () => {
    const tool = createDataCustomTools(service).find((t) => t.name === 'data_create_pipeline');
    expect(tool).toBeDefined();
    expect(tool!.description).toMatch(/data_apply_workflow_plan/);
    await tool!.execute(
      'call-1',
      { name: '场景_银企对账加工', resultTableId: 'r1' },
      undefined,
      undefined,
      undefined as never
    );
    expect(createPipeline).toHaveBeenCalledWith({ name: '场景_银企对账加工', resultTableId: 'r1' });
    expect(DATA_TOOL_PACKS['data.authoring'].tools).toContain('data_create_pipeline');
  });

  it('rejects unknown parameters such as sourcePath', () => {
    const tool = createDataCustomTools(service).find((t) => t.name === 'data_create_pipeline')!;
    const schema = tool.parameters as { additionalProperties?: boolean; required?: string[] };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['name']);
  });

  it('is auto-approved as a local data change', () => {
    expect(reviewAutoPermission('data_create_pipeline', { name: 'x' }).decision).toBe('allow');
  });
});
