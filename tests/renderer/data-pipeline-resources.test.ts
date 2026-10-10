// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { loadDataPipelineResources } from '../../src/renderer/features/data/api/data-pipeline-resources';
import { EMPTY_DASHBOARD } from '../../src/renderer/features/data/model/types';

describe('saved pipeline choices', () => {
  it('loads independent pages without dropping older pipelines or duplicating input/output choices', async () => {
    const pipelines = Array.from({ length: 200 }, (_, index) => ({ id: `pipeline-${index}` }));
    const getDashboard = vi
      .fn()
      .mockResolvedValueOnce({
        ...EMPTY_DASHBOARD,
        pipelines,
        rawTables: [{ id: 'input' }],
        resultTables: [{ id: 'output' }],
      })
      .mockResolvedValueOnce({ ...EMPTY_DASHBOARD, pipelines: [{ id: 'older-pipeline' }] });
    (window as { electronAPI?: unknown }).electronAPI = { data: { getDashboard } };
    const resources = await loadDataPipelineResources();
    expect(resources.pipelines).toHaveLength(201);
    expect(resources.pipelines.at(-1)?.id).toBe('older-pipeline');
    expect(resources.rawTables).toEqual([{ id: 'input' }]);
    expect(resources.resultTables).toEqual([{ id: 'output' }]);
    expect(getDashboard.mock.calls[1][0]).toMatchObject({
      pipelineOffset: 200,
      includePipelines: true,
      includeRawTables: false,
      includeResultTables: false,
    });
  });
});
